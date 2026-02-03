/**
 * Research Assistant Service
 * 
 * Provides tenant-wide research conversations with:
 * - Cross-company query capabilities
 * - Streaming AI responses
 * - Context management
 * - Tenant isolation
 * 
 * SECURITY: All operations verify tenant ownership.
 * Conversations are scoped to tenant, not individual deals.
 */

import {
  Injectable,
  Scope,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { RAGService } from '../rag/rag.service';
import { CitationService } from '../rag/citation.service';
import { TenantContext, TENANT_CONTEXT_KEY } from '../tenant/tenant-context';

export interface CreateConversationDto {
  title?: string;
}

export interface SendMessageDto {
  content: string;
  systemPrompt?: string; // Custom system prompt from user settings
  context?: {
    tickers?: string[];
    sectors?: string[];
    fiscalPeriod?: string;
  };
}

export interface Conversation {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date | null;
  isPinned: boolean;
  isArchived: boolean;
  messageCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: any[];
  metadata?: any;
  tokensUsed: number;
  createdAt: Date;
}

export interface StreamChunk {
  type: 'token' | 'source' | 'done' | 'error' | 'citations';
  data: any;
}

/**
 * Request-scoped Research Assistant Service
 * Ensures tenant context is properly isolated per request
 */
@Injectable({ scope: Scope.REQUEST })
export class ResearchAssistantService {
  private readonly logger = new Logger(ResearchAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RAGService,
    private readonly citationService: CitationService,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  /**
   * Get tenant context from request
   */
  private getTenantContext(): TenantContext {
    const context = (this.request as any)?.[TENANT_CONTEXT_KEY] as TenantContext;
    if (!context) {
      throw new Error('Tenant context not found');
    }
    return context;
  }

  /**
   * Get tenant ID from context
   */
  private getTenantId(): string {
    return this.getTenantContext().tenantId;
  }

  /**
   * Get user ID from context
   */
  private getUserId(): string {
    return this.getTenantContext().userId;
  }

  /**
   * Create a new research conversation
   * SECURITY: Conversation is automatically associated with current tenant
   */
  async createConversation(dto: CreateConversationDto): Promise<Conversation> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();
    const title = dto.title || `Research ${new Date().toLocaleDateString()}`;

    this.logger.log(`Creating conversation for tenant ${tenantId}: ${title}`);

    const result = await this.prisma.$queryRaw<Conversation[]>`
      INSERT INTO research_conversations (tenant_id, user_id, title)
      VALUES (${tenantId}::uuid, ${userId}::uuid, ${title})
      RETURNING 
        id, tenant_id as "tenantId", user_id as "userId", title,
        created_at as "createdAt", updated_at as "updatedAt",
        last_message_at as "lastMessageAt", is_pinned as "isPinned",
        is_archived as "isArchived", message_count as "messageCount"
    `;

    return result[0];
  }

  /**
   * Get all conversations for current tenant/user
   * SECURITY: Filters by tenant_id and user_id
   */
  async getConversations(options?: {
    archived?: boolean;
    pinned?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ conversations: Conversation[]; total: number; hasMore: boolean }> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    this.logger.log(`Fetching conversations for tenant ${tenantId}, user ${userId}`);

    // Build WHERE clause
    let whereClause = `WHERE tenant_id = '${tenantId}'::uuid AND user_id = '${userId}'::uuid`;
    
    if (options?.archived !== undefined) {
      whereClause += ` AND is_archived = ${options.archived}`;
    }
    
    if (options?.pinned !== undefined) {
      whereClause += ` AND is_pinned = ${options.pinned}`;
    }

    // Get conversations
    const conversations = await this.prisma.$queryRawUnsafe<Conversation[]>(`
      SELECT 
        id, tenant_id as "tenantId", user_id as "userId", title,
        created_at as "createdAt", updated_at as "updatedAt",
        last_message_at as "lastMessageAt", is_pinned as "isPinned",
        is_archived as "isArchived", message_count as "messageCount"
      FROM research_conversations
      ${whereClause}
      ORDER BY 
        is_pinned DESC,
        COALESCE(last_message_at, updated_at) DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    // Get total count
    const countResult = await this.prisma.$queryRawUnsafe<{ count: number }[]>(`
      SELECT COUNT(*)::int as count
      FROM research_conversations
      ${whereClause}
    `);

    const total = countResult[0]?.count || 0;
    const hasMore = offset + conversations.length < total;

    return { conversations, total, hasMore };
  }

  /**
   * Get conversation by ID with messages
   * SECURITY: Verifies tenant ownership
   */
  async getConversation(conversationId: string): Promise<{
    conversation: Conversation;
    messages: Message[];
  }> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    this.logger.log(`Fetching conversation ${conversationId} for tenant ${tenantId}`);

    // Get conversation with tenant verification
    const conversations = await this.prisma.$queryRaw<Conversation[]>`
      SELECT 
        id, tenant_id as "tenantId", user_id as "userId", title,
        created_at as "createdAt", updated_at as "updatedAt",
        last_message_at as "lastMessageAt", is_pinned as "isPinned",
        is_archived as "isArchived", message_count as "messageCount"
      FROM research_conversations
      WHERE id = ${conversationId}::uuid 
        AND tenant_id = ${tenantId}::uuid
        AND user_id = ${userId}::uuid
    `;

    if (!conversations[0]) {
      throw new NotFoundException('Conversation not found');
    }

    // Get messages
    const messages = await this.prisma.$queryRaw<Message[]>`
      SELECT 
        id, conversation_id as "conversationId", role, content,
        sources, metadata, tokens_used as "tokensUsed",
        created_at as "createdAt"
      FROM research_messages
      WHERE conversation_id = ${conversationId}::uuid
      ORDER BY created_at ASC
    `;

    return {
      conversation: conversations[0],
      messages,
    };
  }

  /**
   * Update conversation
   * SECURITY: Verifies tenant ownership
   */
  async updateConversation(
    conversationId: string,
    updates: {
      title?: string;
      isPinned?: boolean;
      isArchived?: boolean;
    },
  ): Promise<Conversation> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    // Verify ownership
    await this.verifyConversationOwnership(conversationId);

    // Build update fields
    const updateFields: string[] = [];
    if (updates.title !== undefined) {
      updateFields.push(`title = '${updates.title}'`);
    }
    if (updates.isPinned !== undefined) {
      updateFields.push(`is_pinned = ${updates.isPinned}`);
    }
    if (updates.isArchived !== undefined) {
      updateFields.push(`is_archived = ${updates.isArchived}`);
    }

    if (updateFields.length === 0) {
      const { conversation } = await this.getConversation(conversationId);
      return conversation;
    }

    updateFields.push(`updated_at = NOW()`);

    await this.prisma.$queryRawUnsafe(`
      UPDATE research_conversations
      SET ${updateFields.join(', ')}
      WHERE id = '${conversationId}'::uuid 
        AND tenant_id = '${tenantId}'::uuid
        AND user_id = '${userId}'::uuid
    `);

    const { conversation } = await this.getConversation(conversationId);
    return conversation;
  }

  /**
   * Delete conversation
   * SECURITY: Verifies tenant ownership
   */
  async deleteConversation(conversationId: string): Promise<void> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    // Verify ownership
    await this.verifyConversationOwnership(conversationId);

    // Delete conversation (messages cascade)
    const result = await this.prisma.$executeRaw`
      DELETE FROM research_conversations
      WHERE id = ${conversationId}::uuid 
        AND tenant_id = ${tenantId}::uuid
        AND user_id = ${userId}::uuid
    `;

    if (result === 0) {
      throw new NotFoundException('Conversation not found');
    }

    this.logger.log(`Deleted conversation ${conversationId} for tenant ${tenantId}`);
  }

  /**
   * Send message and get streaming response
   * SECURITY: Verifies conversation ownership
   * Uses FULL HYBRID RAG SYSTEM with intent detection and query routing
   * Stores citations for user-uploaded documents
   */
  async *sendMessage(
    conversationId: string,
    dto: SendMessageDto,
  ): AsyncGenerator<StreamChunk> {
    const tenantId = this.getTenantId();

    this.logger.log(`Processing message for conversation ${conversationId}`);

    try {
      // Verify conversation ownership
      await this.verifyConversationOwnership(conversationId);

      // Save user message
      const userMessage = await this.saveMessage(conversationId, 'user', dto.content, {
        sources: [],
        metadata: dto.context || {},
        tokensUsed: 0,
      });

      // Extract tickers from context or query
      const tickers = this.extractTickers(dto.content, dto.context?.tickers);
      
      this.logger.log(`🔍 Query: "${dto.content}"`);
      this.logger.log(`📊 Tickers: ${tickers.join(', ') || 'auto-detect'}`);

      // Enhance query with ticker context if provided
      let enhancedQuery = dto.content;
      if (tickers.length > 0 && !dto.content.match(/\b(AAPL|MSFT|GOOGL|GOOG|AMZN|TSLA|META|NVDA|JPM|BAC|WFC|V|MA|DIS|NFLX|INTC|AMD|ORCL|CRM|ADBE|PYPL|CSCO|PFE|MRK|JNJ|UNH|CVS|WMT|TGT|HD|LOW|NKE|SBUX|MCD|KO|PEP|RH)\b/i)) {
        // Query doesn't contain ticker, prepend it for intent detection
        enhancedQuery = `${tickers.join(' and ')} ${dto.content}`;
        this.logger.log(`🔧 Enhanced query with ticker context: "${enhancedQuery}"`);
      }

      // Use FULL HYBRID RAG SYSTEM with intent detection, query routing, and user documents
      const ragResult = await this.ragService.query(enhancedQuery, {
        includeNarrative: true,
        includeCitations: true,
        systemPrompt: dto.systemPrompt, // Pass custom system prompt from user
        tenantId, // Enable user document search
        ticker: tickers[0] || undefined, // Scope to first ticker if provided
      });

      this.logger.log(`✅ RAG Result: ${ragResult.intent.type} query`);
      this.logger.log(`   - Structured metrics: ${ragResult.metrics?.length || 0}`);
      this.logger.log(`   - Semantic narratives: ${ragResult.narratives?.length || 0}`);
      this.logger.log(`   - User document citations: ${ragResult.citations?.length || 0}`);
      this.logger.log(`   - Intent: ${JSON.stringify(ragResult.intent)}`);

      // Stream the response
      let fullResponse = ragResult.answer;
      const sources: any[] = ragResult.sources || [];
      const citations: any[] = ragResult.citations || [];

      // Yield sources first
      for (const source of sources) {
        yield {
          type: 'source',
          data: {
            title: `${source.ticker} ${source.filingType}`,
            type: source.type,
            metadata: source,
          },
        };
      }

      // Yield citations (NEW)
      if (citations.length > 0) {
        yield {
          type: 'citations',
          data: {
            citations: citations.map((c) => ({
              citationNumber: c.citationNumber,
              documentId: c.documentId,
              chunkId: c.chunkId,
              filename: c.filename,
              ticker: c.ticker,
              pageNumber: c.pageNumber,
              snippet: c.snippet,
              score: c.score,
            })),
          },
        };
      }

      // Stream tokens (simulate streaming for now - can be enhanced with real streaming)
      const words = fullResponse.split(' ');
      for (const word of words) {
        yield {
          type: 'token',
          data: { text: word + ' ' },
        };
      }

      // Save assistant message with full context
      const assistantMessage = await this.saveMessage(conversationId, 'assistant', fullResponse, {
        sources,
        metadata: {
          tickers,
          intent: ragResult.intent,
          processingInfo: ragResult.processingInfo,
          latency: ragResult.latency,
          cost: ragResult.cost,
        },
        tokensUsed: (ragResult.usage?.inputTokens || 0) + (ragResult.usage?.outputTokens || 0),
      });

      // Store citations for user documents
      if (citations.length > 0) {
        this.logger.log(`📎 Storing ${citations.length} citations for message ${assistantMessage.id}`);
        
        const citationDtos = citations.map((citation) => ({
          tenantId,
          messageId: assistantMessage.id,
          documentId: citation.documentId,
          chunkId: citation.chunkId,
          quote: citation.snippet,
          pageNumber: citation.pageNumber,
          relevanceScore: citation.score,
        }));

        await this.citationService.createCitations(citationDtos);
        this.logger.log(`✅ Stored ${citations.length} citations successfully`);
      }

      // Done
      yield {
        type: 'done',
        data: { complete: true },
      };

    } catch (error) {
      this.logger.error(`Error processing message: ${error.message}`);
      yield {
        type: 'error',
        data: { message: error.message },
      };
    }
  }

  /**
   * Verify conversation belongs to current tenant/user
   */
  private async verifyConversationOwnership(conversationId: string): Promise<void> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    const result = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int as count
      FROM research_conversations
      WHERE id = ${conversationId}::uuid 
        AND tenant_id = ${tenantId}::uuid
        AND user_id = ${userId}::uuid
    `;

    if (result[0]?.count === 0) {
      throw new NotFoundException('Conversation not found');
    }
  }

  /**
   * Save message to database
   */
  private async saveMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    options: {
      sources: any[];
      metadata: any;
      tokensUsed: number;
    },
  ): Promise<Message> {
    const sourcesJson = JSON.stringify(options.sources);
    const metadataJson = JSON.stringify(options.metadata);

    const result = await this.prisma.$queryRaw<Message[]>`
      INSERT INTO research_messages (conversation_id, role, content, sources, metadata, tokens_used)
      VALUES (
        ${conversationId}::uuid,
        ${role},
        ${content},
        ${sourcesJson}::jsonb,
        ${metadataJson}::jsonb,
        ${options.tokensUsed}
      )
      RETURNING 
        id, conversation_id as "conversationId", role, content,
        sources, metadata, tokens_used as "tokensUsed",
        created_at as "createdAt"
    `;

    return result[0];
  }

  /**
   * Build query context from message and options
   */
  private async buildQueryContext(
    query: string,
    context?: {
      tickers?: string[];
      sectors?: string[];
      fiscalPeriod?: string;
    },
  ): Promise<any> {
    const tickers = this.extractTickers(query, context?.tickers);

    return {
      tickers,
      sectors: context?.sectors || [],
      fiscalPeriod: context?.fiscalPeriod,
      queryType: this.detectQueryType(query),
    };
  }

  /**
   * Extract ticker symbols from query
   */
  extractTickers(query: string, providedTickers?: string[]): string[] {
    const tickers = new Set<string>(providedTickers || []);

    // Common ticker pattern: 1-5 uppercase letters
    const tickerPattern = /\b[A-Z]{1,5}\b/g;
    const matches = query.match(tickerPattern) || [];

    for (const match of matches) {
      // Filter out common words that look like tickers
      if (!['I', 'A', 'US', 'CEO', 'CFO', 'SEC', 'GAAP', 'Q', 'FY'].includes(match)) {
        tickers.add(match);
      }
    }

    return Array.from(tickers);
  }

  /**
   * Detect query type
   */
  private detectQueryType(query: string): string {
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('compare') || lowerQuery.includes('vs') || lowerQuery.includes('versus')) {
      return 'comparison';
    }

    if (lowerQuery.includes('trend') || lowerQuery.includes('over time') || lowerQuery.includes('history')) {
      return 'time_series';
    }

    if (lowerQuery.includes('why') || lowerQuery.includes('explain') || lowerQuery.includes('reason')) {
      return 'explanation';
    }

    if (lowerQuery.includes('risk') || lowerQuery.includes('concern') || lowerQuery.includes('challenge')) {
      return 'risk_analysis';
    }

    return 'general';
  }

  /**
   * Build fallback response when Claude is unavailable
   */
  private buildFallbackResponse(ragResult: any): string {
    const lines: string[] = [];

    if (ragResult.metrics.length > 0) {
      lines.push('Financial Metrics:');
      for (const metric of ragResult.metrics.slice(0, 10)) {
        lines.push(`- ${metric.ticker} ${metric.normalizedMetric}: ${metric.value}`);
      }
    }

    if (ragResult.narratives.length > 0) {
      lines.push('\nRelevant Sections:');
      for (const narrative of ragResult.narratives.slice(0, 3)) {
        lines.push(`- ${narrative.metadata.ticker} ${narrative.metadata.sectionType}`);
      }
    }

    if (lines.length === 0) {
      return 'No data found for your query. Please try a different question or check if the company data is available.';
    }

    return lines.join('\n');
  }
}
