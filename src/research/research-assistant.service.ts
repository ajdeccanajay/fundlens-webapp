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
import { BedrockService } from '../rag/bedrock.service';
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
    instantRagSessionId?: string;
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
  type: 'token' | 'source' | 'done' | 'error' | 'citations' | 'peerComparison' | 'visualization';
  data: any;
}

/**
 * Peer identification result from LLM
 */
export interface PeerIdentificationResult {
  found: string[];      // Peers found in tenant's deals
  missing: string[];    // Suggested peers not in tenant's deals
  rationale: string;    // Brief explanation of peer selection
}

/**
 * Peer comparison metadata for response
 */
export interface PeerComparisonMetadata {
  primaryTicker: string;
  peersIncluded: string[];
  missingPeers: { ticker: string; reason: string }[];
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
    private readonly bedrockService: BedrockService,
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
   * Get messages for a conversation
   * SECURITY: Verifies tenant ownership
   */
  async getConversationMessages(conversationId: string): Promise<any[]> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    this.logger.log(`Fetching messages for conversation ${conversationId} for tenant ${tenantId}`);

    // Verify conversation exists and belongs to tenant
    const conversations = await this.prisma.$queryRaw<Conversation[]>`
      SELECT id
      FROM research_conversations
      WHERE id = ${conversationId}::uuid
        AND tenant_id = ${tenantId}::uuid
        AND user_id = ${userId}::uuid
    `;

    if (!conversations[0]) {
      throw new NotFoundException('Conversation not found');
    }

    // Get messages in chronological order
    // Note: citations are stored in separate 'citations' table, visualization/peerComparison are streamed only (not persisted)
    const messages = await this.prisma.$queryRaw<any[]>`
      SELECT
        id, conversation_id as "conversationId", role, content,
        sources, metadata,
        tokens_used as "tokensUsed", created_at as "createdAt"
      FROM research_messages
      WHERE conversation_id = ${conversationId}::uuid
      ORDER BY created_at ASC
    `;

    // Get citations for all messages in this conversation from the citations table
    const messageIds = messages.map(m => m.id);
    let citationsMap: Map<string, any[]> = new Map();
    
    if (messageIds.length > 0) {
      try {
        const allCitations = await this.prisma.$queryRaw<any[]>`
          SELECT 
            c.message_id as "messageId",
            c.document_id as "documentId",
            c.chunk_id as "chunkId",
            c.quote as "excerpt",
            c.page_number as "pageNumber",
            c.relevance_score as "relevanceScore",
            d.title as "filename",
            d.ticker
          FROM citations c
          LEFT JOIN documents d ON c.document_id = d.id
          WHERE c.message_id = ANY(${messageIds}::uuid[])
        `;
        
        // Group citations by message_id
        for (const citation of allCitations) {
          const msgId = citation.messageId;
          if (!citationsMap.has(msgId)) {
            citationsMap.set(msgId, []);
          }
          citationsMap.get(msgId)!.push({
            documentId: citation.documentId,
            chunkId: citation.chunkId,
            excerpt: citation.excerpt,
            pageNumber: citation.pageNumber,
            relevanceScore: citation.relevanceScore,
            filename: citation.filename,
            ticker: citation.ticker,
          });
        }
      } catch (error) {
        // Citations table might not exist or query failed - continue without citations
        this.logger.warn(`Failed to fetch citations: ${error.message}`);
      }
    }

    // Parse JSON fields with error handling
    return messages.map((msg) => {
      try {
        const sources = msg.sources ? (typeof msg.sources === 'string' ? JSON.parse(msg.sources) : msg.sources) : [];
        const metadata = msg.metadata ? (typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata) : {};
        
        return {
          ...msg,
          sources,
          // Citations come from the citations table
          citations: citationsMap.get(msg.id) || [],
          // visualization and peerComparison are streamed only, not persisted
          // They could be stored in metadata if needed in the future
          visualization: metadata.visualization || null,
          peerComparison: metadata.peerComparison || null,
        };
      } catch (error) {
        this.logger.error(`Failed to parse message ${msg.id} JSON fields:`, error);
        // Return message with empty arrays/null for failed JSON parsing
        return {
          ...msg,
          sources: [],
          citations: [],
          visualization: null,
          peerComparison: null,
        };
      }
    });
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
   * Supports PEER COMPARISON queries with multi-ticker RAG
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
      let tickers = this.extractTickers(dto.content, dto.context?.tickers);
      const primaryTicker = tickers[0] || undefined;
      
      this.logger.log(`🔍 Query: "${dto.content}"`);
      this.logger.log(`📊 Primary Ticker: ${primaryTicker || 'auto-detect'}`);

      // Check for peer comparison intent
      let peerComparisonMetadata: PeerComparisonMetadata | undefined;
      const isPeerComparisonQuery = this.detectPeerComparisonIntent(dto.content);
      
      if (isPeerComparisonQuery && primaryTicker) {
        this.logger.log(`🔄 Peer comparison detected, identifying peers for ${primaryTicker}`);
        
        try {
          const peerResult = await this.identifyPeersFromDeals(primaryTicker);
          
          // Expand tickers with found peers (max 5 total)
          const peerTickers = peerResult.found.slice(0, 4); // Leave room for primary
          tickers = [primaryTicker, ...peerTickers].slice(0, 5);
          
          this.logger.log(`📊 Expanded tickers for peer comparison: ${tickers.join(', ')}`);
          
          // Build peer comparison metadata for response
          peerComparisonMetadata = {
            primaryTicker,
            peersIncluded: peerTickers,
            missingPeers: peerResult.missing.map(ticker => ({
              ticker,
              reason: peerResult.rationale,
            })),
          };
          
          this.logger.log(`✅ Peer comparison metadata: ${JSON.stringify(peerComparisonMetadata)}`);
        } catch (error) {
          this.logger.error(`❌ Peer identification failed: ${error.message}`);
          // Continue with single ticker if peer identification fails
        }
      }

      // Enhance query with ticker context if provided
      let enhancedQuery = dto.content;
      if (tickers.length > 0 && !dto.content.match(/\b(AAPL|MSFT|GOOGL|GOOG|AMZN|TSLA|META|NVDA|JPM|BAC|WFC|V|MA|DIS|NFLX|INTC|AMD|ORCL|CRM|ADBE|PYPL|CSCO|PFE|MRK|JNJ|UNH|CVS|WMT|TGT|HD|LOW|NKE|SBUX|MCD|KO|PEP|RH)\b/i)) {
        // Query doesn't contain ticker, prepend it for intent detection
        enhancedQuery = `${tickers.join(' and ')} ${dto.content}`;
        this.logger.log(`🔧 Enhanced query with ticker context: "${enhancedQuery}"`);
      }

      // Resolve dealId from primaryTicker so uploaded document Sources 1+2 activate
      const dealId = primaryTicker ? await this.getDealIdForTicker(primaryTicker) : undefined;

      // Use FULL HYBRID RAG SYSTEM with intent detection, query routing, and user documents
      // Pass all tickers (including peers) for multi-ticker retrieval
      const ragResult = await this.ragService.query(enhancedQuery, {
        includeNarrative: true,
        includeCitations: true,
        systemPrompt: dto.systemPrompt, // Pass custom system prompt from user
        tenantId, // Enable user document search
        ticker: primaryTicker, // Primary ticker for scoping
        tickers: tickers.length > 1 ? tickers : undefined, // Pass peer tickers for multi-ticker retrieval
        instantRagSessionId: dto.context?.instantRagSessionId, // Cross-source retrieval from Instant RAG session
        dealId, // Spec §7.1: enables Sources 1+2 (uploaded doc extractions + vector chunks)
      });

      this.logger.log(`✅ RAG Result: ${ragResult.intent.type} query`);
      this.logger.log(`   - Structured metrics: ${ragResult.metrics?.length || 0}`);
      this.logger.log(`   - Semantic narratives: ${ragResult.narratives?.length || 0}`);
      this.logger.log(`   - Citations: ${ragResult.citations?.length || 0}`);
      if (ragResult.citations && ragResult.citations.length > 0) {
        this.logger.log(`   - Citation details: ${JSON.stringify(ragResult.citations.slice(0, 2))}`);
      }
      this.logger.log(`   - Intent: ${JSON.stringify(ragResult.intent)}`);
      this.logger.log(`   - Visualization: ${ragResult.visualization ? 'present' : 'none'}`);
      if (ragResult.visualization) {
        this.logger.log(`   - Visualization type: ${ragResult.visualization.chartType}, title: ${ragResult.visualization.title}`);
      }
      // Stream the response
      let fullResponse = ragResult.answer;
      const sources: any[] = ragResult.sources || [];
      const citations: any[] = ragResult.citations || [];

      // Yield sources first - only yield valid sources with proper data
      const validSources = sources.filter(s => s.ticker && s.filingType);
      for (const source of validSources) {
        const title = `${source.ticker} ${source.filingType}`;
        
        yield {
          type: 'source',
          data: {
            title,
            type: source.type,
            ticker: source.ticker,
            filingType: source.filingType,
            fiscalPeriod: source.fiscalPeriod,
            metadata: source,
          },
        };
      }

      // Yield citations (NEW)
      if (citations.length > 0) {
        this.logger.log(`📤 Yielding ${citations.length} citations`);
        const mappedCitations = citations.map((c) => ({
          // Support both formats: Bedrock citations (number) and user doc citations (citationNumber)
          number: c.number || c.citationNumber,
          citationNumber: c.citationNumber || c.number,
          // SEC filing metadata (from Bedrock)
          ticker: c.ticker,
          filingType: c.filingType,
          fiscalPeriod: c.fiscalPeriod,
          section: c.section,
          excerpt: c.excerpt,
          relevanceScore: c.relevanceScore || c.score,
          // User document metadata
          documentId: c.documentId,
          chunkId: c.chunkId,
          filename: c.filename,
          pageNumber: c.pageNumber,
          snippet: c.snippet,
          score: c.score,
        }));
        this.logger.log(`📤 Mapped citations: ${JSON.stringify(mappedCitations.slice(0, 2))}`);
        yield {
          type: 'citations',
          data: {
            citations: mappedCitations,
          },
        };
      }

      // Yield visualization chunk before tokens (if present)
      if (ragResult.visualization) {
        this.logger.log(`📤 Yielding visualization: ${ragResult.visualization.chartType}`);
        yield {
          type: 'visualization' as const,
          data: ragResult.visualization,
        };
      }

      // Stream tokens with sentence-boundary awareness
      // This prevents cutting off mid-sentence and breaking markdown formatting
      const sentences = this.splitIntoSentences(fullResponse);
      for (const sentence of sentences) {
        yield {
          type: 'token',
          data: { text: sentence },
        };
        // Small delay to simulate streaming (can be removed for instant display)
        await new Promise(resolve => setTimeout(resolve, 50));
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
          visualization: ragResult.visualization || undefined,
        },
        tokensUsed: (ragResult.usage?.inputTokens || 0) + (ragResult.usage?.outputTokens || 0),
      });

      // Store citations for user documents ONLY
      // SEC filing citations (from Bedrock) don't have documentId/chunkId in our DB
      // They are passed to frontend for display but not stored
      if (citations.length > 0) {
        // Filter to only user document citations (have valid documentId and chunkId UUIDs)
        const userDocCitations = citations.filter(c => 
          c.documentId && 
          c.chunkId && 
          // Check if it looks like a UUID (not "chunk-0" or similar)
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.chunkId)
        );
        
        if (userDocCitations.length > 0) {
          this.logger.log(`📎 Storing ${userDocCitations.length} user document citations for message ${assistantMessage.id}`);
          
          const citationDtos = userDocCitations.map((citation) => ({
            tenantId,
            messageId: assistantMessage.id,
            documentId: citation.documentId,
            chunkId: citation.chunkId,
            quote: citation.excerpt || citation.snippet || '', // Handle both excerpt and snippet
            pageNumber: citation.pageNumber,
            relevanceScore: citation.relevanceScore || citation.score,
          }));

          await this.citationService.createCitations(citationDtos);
          this.logger.log(`✅ Stored ${userDocCitations.length} user document citations successfully`);
        }
        
        const secFilingCitations = citations.length - userDocCitations.length;
        if (secFilingCitations > 0) {
          this.logger.log(`ℹ️ Skipped storing ${secFilingCitations} SEC filing citations (passed to frontend only)`);
        }
      }

      // Yield peer comparison metadata if available
      if (peerComparisonMetadata) {
        this.logger.log(`📤 Yielding peer comparison metadata`);
        yield {
          type: 'peerComparison',
          data: peerComparisonMetadata,
        };
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
   * Look up the deal ID for a given ticker within the current tenant.
   * Returns undefined if no deal found (non-fatal).
   */
  private async getDealIdForTicker(ticker: string): Promise<string | undefined> {
    if (!ticker) return undefined;
    const tenantId = this.getTenantId();
    try {
      const deals = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM deals WHERE UPPER(ticker) = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`,
        ticker.toUpperCase(),
        tenantId,
      );
      if (deals.length > 0) {
        this.logger.log(`📎 Resolved dealId for ${ticker}: ${deals[0].id}`);
        return deals[0].id;
      }
      this.logger.log(`📎 No deal found for ticker ${ticker} in tenant ${tenantId}`);
      return undefined;
    } catch (err) {
      this.logger.warn(`⚠️ getDealIdForTicker failed (non-fatal): ${err.message}`);
      return undefined;
    }
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
   * Detect if query is asking for peer comparison
   * Checks for keywords indicating peer/competitor comparison intent
   */
  private detectPeerComparisonIntent(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    
    const peerKeywords = [
      'peers',
      'peer group',
      'peer companies',
      'competitors',
      'competitor',
      'competition',
      'comparable',
      'comparables',
      'comps',
      'industry peers',
      'similar companies',
      'compare to peers',
      'compare with peers',
      'vs peers',
      'versus peers',
      'against peers',
      'relative to peers',
      'benchmark',
      'benchmarking',
    ];

    // Check for exact keyword matches
    const hasKeyword = peerKeywords.some(kw => lowerQuery.includes(kw));
    
    // Also check for pattern "how does X compare"
    const hasComparePattern = /how does.*compare/i.test(query);

    if (hasKeyword || hasComparePattern) {
      this.logger.log(`🔍 Peer comparison intent detected in query: "${query}"`);
      return true;
    }

    return false;
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

  /**
   * Split text into sentences while preserving markdown formatting
   * This prevents cutting off mid-sentence and breaking markdown syntax
   */
  private splitIntoSentences(text: string): string[] {
      const chunks: string[] = [];
      let currentChunk = '';
      let inCodeBlock = false;
      let inList = false;
      let inTable = false;

      const lines = text.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect code blocks
        if (line.trim().startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          currentChunk += line + '\n';
          continue;
        }

        // If in code block, don't split
        if (inCodeBlock) {
          currentChunk += line + '\n';
          continue;
        }

        // Detect markdown tables (lines starting with |)
        const isTableRow = line.trim().startsWith('|') || /^\|[\s\-:|]+\|$/.test(line.trim());
        if (isTableRow) {
          if (!inTable) {
            // Flush any pending chunk before starting table
            if (currentChunk.trim()) {
              chunks.push(currentChunk);
              currentChunk = '';
            }
            inTable = true;
          }
          currentChunk += line + '\n';
          continue;
        }

        // If we were in a table and hit a non-table line, flush the table
        if (inTable) {
          inTable = false;
          if (currentChunk.trim()) {
            chunks.push(currentChunk);
            currentChunk = '';
          }
        }

        // Detect lists
        if (line.trim().match(/^[-*+]\s/) || line.trim().match(/^\d+\.\s/)) {
          inList = true;
          currentChunk += line + '\n';
          continue;
        }

        // If in list and line is empty, end list
        if (inList && line.trim() === '') {
          inList = false;
          if (currentChunk.trim()) {
            chunks.push(currentChunk);
            currentChunk = '';
          }
          continue;
        }

        // If in list, continue adding
        if (inList) {
          currentChunk += line + '\n';
          continue;
        }

        // Regular text - split by sentences
        if (line.trim()) {
          // Split by sentence boundaries (. ! ?)
          const sentences = line.split(/([.!?]+\s+)/);
          for (const sentence of sentences) {
            if (sentence.trim()) {
              currentChunk += sentence;
              // If sentence ends with punctuation, yield chunk
              if (sentence.match(/[.!?]+\s*$/)) {
                if (currentChunk.trim()) {
                  chunks.push(currentChunk);
                  currentChunk = '';
                }
              }
            }
          }
        } else {
          // Empty line - yield current chunk and add newline
          if (currentChunk.trim()) {
            chunks.push(currentChunk);
            currentChunk = '';
          }
          chunks.push('\n');
        }
      }

      // Add remaining chunk
      if (currentChunk.trim()) {
        chunks.push(currentChunk);
      }

      return chunks.filter(c => c.trim() || c === '\n');
    }

  /**
   * Get available tickers from tenant's deals
   * Returns list of tickers that have data available for comparison
   */
  async getAvailableTickers(): Promise<string[]> {
    const tenantId = this.getTenantId();
    
    this.logger.log(`📊 Fetching available tickers for tenant ${tenantId}`);
    
    // Use Prisma's typed query - tenant_id is a text column, not UUID
    const deals = await this.prisma.$queryRawUnsafe<{ ticker: string; status: string }[]>(`
      SELECT DISTINCT ticker, status
      FROM deals
      WHERE tenant_id = $1
        AND ticker IS NOT NULL
        AND ticker != ''
        AND status NOT IN ('error', 'processing')
      ORDER BY ticker
    `, tenantId);
    
    const tickers = deals.map(d => d.ticker.toUpperCase());
    this.logger.log(`📊 Found ${tickers.length} available tickers: ${tickers.join(', ')}`);
    
    return tickers;
  }

  /**
   * Identify relevant peers for a company from tenant's available deals
   * Uses LLM to determine which tickers are relevant peers
   * 
   * @param primaryTicker The main company ticker to find peers for
   * @returns Object with found peers (in tenant deals), missing peers (suggested), and rationale
   */
  async identifyPeersFromDeals(primaryTicker: string): Promise<PeerIdentificationResult> {
    const tenantId = this.getTenantId();
    
    this.logger.log(`🔍 Identifying peers for ${primaryTicker} from tenant ${tenantId} deals`);
    
    // Get available tickers from tenant's deals
    const availableTickers = await this.getAvailableTickers();
    
    // Filter out the primary ticker
    const otherTickers = availableTickers.filter(t => t !== primaryTicker.toUpperCase());
    
    if (otherTickers.length === 0) {
      this.logger.log(`⚠️ No other tickers available in tenant deals for peer comparison`);
      // Use LLM to suggest peers even when none are available
      return this.suggestPeersWithLLM(primaryTicker, []);
    }
    
    // Use LLM to identify which tickers are relevant peers
    const prompt = `You are a financial analyst. Given the company ${primaryTicker}, identify which of these tickers are relevant peer companies for comparison:

Available tickers in the user's portfolio: ${otherTickers.join(', ')}

Also suggest 2-3 additional peer companies that are NOT in the list above but would be valuable for comparison.

Consider:
- Same industry/sector
- Similar market cap
- Similar business model
- Direct competitors

Return ONLY valid JSON in this exact format:
{
  "found": ["TICKER1", "TICKER2"],
  "missing": ["TICKER3", "TICKER4"],
  "rationale": "Brief explanation of why these are relevant peers"
}

Rules:
- "found" must ONLY contain tickers from the available list: ${otherTickers.join(', ')}
- "missing" should contain 2-3 suggested tickers NOT in the available list
- Keep rationale under 100 words
- Return ONLY the JSON, no other text`;

    try {
      const response = await this.bedrockService.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
        max_tokens: 500,
      });

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate that "found" only contains tickers from available list
      const validFound = (parsed.found || []).filter((t: string) => 
        otherTickers.includes(t.toUpperCase())
      ).map((t: string) => t.toUpperCase());
      
      // Validate that "missing" doesn't contain tickers from available list
      const validMissing = (parsed.missing || []).filter((t: string) => 
        !availableTickers.includes(t.toUpperCase())
      ).map((t: string) => t.toUpperCase());

      const result: PeerIdentificationResult = {
        found: validFound,
        missing: validMissing.slice(0, 3), // Limit to 3 suggestions
        rationale: parsed.rationale || 'Peers identified based on industry and business model similarity.',
      };

      this.logger.log(`✅ Peer identification complete:`);
      this.logger.log(`   - Found in deals: ${result.found.join(', ') || 'none'}`);
      this.logger.log(`   - Suggested to add: ${result.missing.join(', ') || 'none'}`);
      this.logger.log(`   - Rationale: ${result.rationale}`);

      return result;
    } catch (error) {
      this.logger.error(`❌ Peer identification failed: ${error.message}`);
      // Fallback: return empty found and suggest common peers
      return this.suggestPeersWithLLM(primaryTicker, otherTickers);
    }
  }

  /**
   * Suggest peers using LLM when no peers are available in tenant deals
   */
  private async suggestPeersWithLLM(primaryTicker: string, availableTickers: string[]): Promise<PeerIdentificationResult> {
    const prompt = `You are a financial analyst. Suggest 3 peer companies for ${primaryTicker} that would be valuable for comparison.

Consider:
- Same industry/sector
- Similar market cap
- Similar business model
- Direct competitors

Return ONLY valid JSON:
{
  "found": [],
  "missing": ["TICKER1", "TICKER2", "TICKER3"],
  "rationale": "Brief explanation"
}`;

    try {
      const response = await this.bedrockService.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
        max_tokens: 300,
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          found: [],
          missing: (parsed.missing || []).slice(0, 3).map((t: string) => t.toUpperCase()),
          rationale: parsed.rationale || 'Suggested peers based on industry analysis.',
        };
      }
    } catch (error) {
      this.logger.error(`LLM peer suggestion failed: ${error.message}`);
    }

    // Ultimate fallback
    return {
      found: [],
      missing: [],
      rationale: 'Unable to identify peers. Please add competitor deals manually.',
    };
  }
}
