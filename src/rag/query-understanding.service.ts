/**
 * Query Understanding Layer (QUL) Service
 * Spec: FundLens_QUL_Specification_v1.md, Section 6.1
 *
 * Replaces extractTickers() + enhancedQuery + IntentDetectorService
 * with a single Haiku call that provides semantic understanding
 * before any retrieval begins.
 *
 * Architecture:
 *   Tier 1: LRU Cache (< 1ms for repeated queries)
 *   Tier 2: Haiku LLM disambiguation (50-150ms)
 *   Fallback: Conservative pass-through on Haiku failure
 */
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  QueryUnderstanding,
  WorkspaceContext,
  UploadedDocumentMeta,
  ConversationMessage,
  ResolvedEntity,
  RetrievalPath,
} from './types/query-understanding.types';
import { validateAndEnrich, parseHaikuJSON } from './qul-validator';
import { BedrockService } from './bedrock.service';
import { QULObservabilityService } from './qul-observability.service';

// Simple LRU cache implementation
interface CacheEntry {
  value: QueryUnderstanding;
  timestamp: number;
}

@Injectable()
export class QueryUnderstandingService implements OnModuleInit {
  private readonly logger = new Logger(QueryUnderstandingService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly CACHE_MAX_SIZE = 200;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (matches performance optimizer cache TTL)

  // Circuit breaker state
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 3;
  private readonly CIRCUIT_BREAKER_RESET_MS = 30_000; // 30 seconds

  // Externalized prompts
  private systemPrompt = '';
  private fewShotExamples: any[] = [];

  constructor(
    private readonly bedrock: BedrockService,
    @Optional() private readonly observability?: QULObservabilityService,
  ) {}

  onModuleInit() {
    this.loadPrompts();
  }

  private loadPrompts(): void {
    try {
      const promptPath = path.join(process.cwd(), 'src', 'prompts', 'qul-system-prompt.txt');
      this.systemPrompt = fs.readFileSync(promptPath, 'utf-8');
      this.logger.log('✅ QUL system prompt loaded');
    } catch (e) {
      this.logger.warn(`⚠️ Could not load QUL system prompt from file: ${e.message}`);
      this.systemPrompt = 'You are a financial query disambiguation engine. Output JSON only.';
    }

    try {
      const examplesPath = path.join(process.cwd(), 'src', 'prompts', 'qul-examples.json');
      this.fewShotExamples = JSON.parse(fs.readFileSync(examplesPath, 'utf-8'));
      this.logger.log(`✅ QUL few-shot examples loaded (${this.fewShotExamples.length} examples)`);
    } catch (e) {
      this.logger.warn(`⚠️ Could not load QUL examples: ${e.message}`);
      this.fewShotExamples = [];
    }
  }

  /**
   * Main entry point. Every query goes through here.
   * Returns a fully validated QueryUnderstanding object.
   */
  async understand(
    query: string,
    workspace: WorkspaceContext,
    uploadedDocs: UploadedDocumentMeta[] = [],
    conversationHistory: ConversationMessage[] = [],
  ): Promise<QueryUnderstanding> {
    const startTime = Date.now();

    // Tier 1: Cache check
    const cacheKey = this.buildCacheKey(query, workspace, uploadedDocs);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      const latency = Date.now() - startTime;
      const result = { ...cached, resolvedBy: 'tier2_cache' as const };
      this.logger.log(`⚡ QUL cache hit (${latency}ms)`);
      this.observability?.recordResolution(result, latency);
      return result;
    }

    // Circuit breaker: if Haiku has been failing, skip to Sonnet fallback
    if (this.isCircuitOpen()) {
      this.logger.warn('⚠️ QUL circuit breaker OPEN — skipping Haiku, trying Sonnet fallback');
      this.observability?.recordCircuitBreakerTrip();
      const sonnetResult = await this.callSonnetFallback(query, workspace, uploadedDocs, conversationHistory);
      if (sonnetResult) {
        this.setCache(cacheKey, sonnetResult);
        const latency = Date.now() - startTime;
        this.observability?.recordResolution(sonnetResult, latency, { wasFallback: true });
        return sonnetResult;
      }
      // Sonnet also failed — tier 3 regex fallback
      const fallback = this.buildFallbackUnderstanding(query, workspace, uploadedDocs);
      this.observability?.recordResolution(fallback, Date.now() - startTime, { wasFallback: true });
      return fallback;
    }

    // Tier 2: Haiku LLM disambiguation (primary)
    try {
      const understanding = await this.callHaiku(
        query, workspace, uploadedDocs, conversationHistory,
      );
      this.failureCount = 0; // Reset circuit breaker on success
      this.setCache(cacheKey, understanding);
      const latency = Date.now() - startTime;
      this.logger.log(
        `🧠 QUL resolved: intent=${understanding.intent}, ` +
        `entity=${understanding.primaryEntity?.ticker || understanding.primaryEntity?.name || 'none'}, ` +
        `confidence=${understanding.confidence.toFixed(2)} (${latency}ms)`,
      );
      this.observability?.recordResolution(understanding, latency);
      return understanding;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      const isTimeout = error.message?.includes('timeout');
      const isParseFailure = error.message?.includes('parse') || error.message?.includes('JSON');
      this.logger.error(`❌ QUL Haiku call failed (${this.failureCount}x): ${error.message}`);

      // Tier 2b: Sonnet 3.5 fallback — same prompt, bigger model
      this.logger.log('🔄 Attempting Sonnet 3.5 fallback for QUL...');
      const sonnetResult = await this.callSonnetFallback(query, workspace, uploadedDocs, conversationHistory);
      if (sonnetResult) {
        this.setCache(cacheKey, sonnetResult);
        const latency = Date.now() - startTime;
        this.logger.log(
          `🧠 QUL Sonnet fallback resolved: intent=${sonnetResult.intent}, ` +
          `entity=${sonnetResult.primaryEntity?.ticker || sonnetResult.primaryEntity?.name || 'none'}, ` +
          `confidence=${sonnetResult.confidence.toFixed(2)} (${latency}ms)`,
        );
        this.observability?.recordResolution(sonnetResult, latency, {
          wasFallback: true,
          wasTimeout: isTimeout,
          wasParseFailure: isParseFailure,
        });
        return sonnetResult;
      }

      // Tier 3: Conservative regex pass-through (last resort)
      this.logger.warn('❌ Both Haiku and Sonnet failed — using tier 3 regex fallback');
      const fallback = this.buildFallbackUnderstanding(query, workspace, uploadedDocs);
      this.observability?.recordResolution(fallback, Date.now() - startTime, {
        wasFallback: true,
        wasTimeout: isTimeout,
        wasParseFailure: isParseFailure,
      });
      return fallback;
    }
  }

  /**
   * Call Haiku with the full workspace context.
   */
  private async callHaiku(
    query: string,
    workspace: WorkspaceContext,
    uploadedDocs: UploadedDocumentMeta[],
    conversationHistory: ConversationMessage[],
  ): Promise<QueryUnderstanding> {
    const userMessage = this.buildUserMessage(query, workspace, uploadedDocs, conversationHistory);

    // Build few-shot prompt section
    let fewShotSection = '';
    if (this.fewShotExamples.length > 0) {
      // Pick 3 most relevant examples based on query + context heuristics
      const selected = this.selectRelevantExamples(query, workspace, conversationHistory);
      fewShotSection = '\n\nHere are examples of correct outputs:\n\n' +
        selected.map((ex, i) =>
          `Example ${i + 1} (${ex.description}):\nInput: ${JSON.stringify(ex.input)}\nOutput: ${JSON.stringify(ex.output)}`
        ).join('\n\n');
    }

    const fullPrompt = userMessage + fewShotSection;

    const response = await Promise.race([
      this.bedrock.invokeClaude({
        prompt: fullPrompt,
        systemPrompt: this.systemPrompt,
        modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
        max_tokens: 1024,
        temperature: 0,
      }),
      this.timeout(15000), // 15-second hard timeout
    ]);

    if (typeof response !== 'string' || response.length === 0) {
      throw new Error('Empty response from Haiku');
    }

    const parsed = parseHaikuJSON(response);
    if (!parsed) {
      throw new Error('Failed to parse Haiku JSON output');
    }

    return validateAndEnrich(parsed, query, workspace);
  }

  /**
   * Tier 2b: Sonnet 3.5 fallback when Haiku fails.
   * Same prompt, bigger model — handles edge cases Haiku can't parse.
   * Returns null if Sonnet also fails (caller falls through to tier 3).
   */
  private async callSonnetFallback(
    query: string,
    workspace: WorkspaceContext,
    uploadedDocs: UploadedDocumentMeta[],
    conversationHistory: ConversationMessage[],
  ): Promise<QueryUnderstanding | null> {
    try {
      const userMessage = this.buildUserMessage(query, workspace, uploadedDocs, conversationHistory);

      let fewShotSection = '';
      if (this.fewShotExamples.length > 0) {
        const selected = this.selectRelevantExamples(query, workspace, conversationHistory);
        fewShotSection = '\n\nHere are examples of correct outputs:\n\n' +
          selected.map((ex, i) =>
            `Example ${i + 1} (${ex.description}):\nInput: ${JSON.stringify(ex.input)}\nOutput: ${JSON.stringify(ex.output)}`
          ).join('\n\n');
      }

      const fullPrompt = userMessage + fewShotSection;

      const response = await Promise.race([
        this.bedrock.invokeClaude({
          prompt: fullPrompt,
          systemPrompt: this.systemPrompt,
          modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
          max_tokens: 1024,
          temperature: 0,
        }),
        this.timeout(20000), // 20-second timeout (Sonnet is slower)
      ]);

      if (typeof response !== 'string' || response.length === 0) {
        this.logger.warn('❌ Sonnet fallback returned empty response');
        return null;
      }

      const parsed = parseHaikuJSON(response);
      if (!parsed) {
        this.logger.warn('❌ Sonnet fallback JSON parse failed');
        return null;
      }

      const result = validateAndEnrich(parsed, query, workspace);
      result.resolvedBy = 'tier2b_sonnet_fallback' as any;
      return result;
    } catch (error) {
      this.logger.error(`❌ Sonnet fallback failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Build the user message with full workspace context.
   * Spec Section 4.2.
   */
  private buildUserMessage(
    query: string,
    workspace: WorkspaceContext,
    uploadedDocs: UploadedDocumentMeta[],
    conversationHistory: ConversationMessage[],
  ): string {
    const message: any = {
      query,
      workspace: {
        ticker: workspace.ticker || null,
        company_name: workspace.companyName || null,
        domain: workspace.domain,
        deal_name: workspace.dealName || null,
      },
      uploaded_documents: uploadedDocs.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type || null,
        entity: d.entity || null,
        ticker: d.ticker || null,
      })),
      conversation_history: conversationHistory.slice(-3).map(m => ({
        role: m.role,
        content: m.content || undefined,
        summary: m.summary || undefined,
      })),
    };

    // For PE workspaces with uploaded docs but no ticker, help Haiku
    // understand that uploaded entities are the primary context
    if (workspace.domain === 'private_equity' && !workspace.ticker && uploadedDocs.length > 0) {
      message.context_hint = 'This is a private equity workspace. Uploaded documents contain the primary deal entity. Use uploaded_entity entityType for references to the target company.';
    }

    // DEFAULT ENTITY HINT: When there's no conversation history, remind Haiku
    // that workspace_ticker is the default for unscoped queries.
    // We do NOT try to detect explicit companies via regex — that's Haiku's job.
    // The hint simply tells Haiku: "if the query doesn't name anyone, use workspace."
    // Haiku's system prompt already has the entity resolution rules to override this
    // when the query explicitly names a different company.
    if (workspace.ticker && conversationHistory.length === 0) {
      message.default_entity_hint = `If the query does not name a specific company or ticker, the analyst is working in the ${workspace.ticker} workspace — default to workspace_ticker=${workspace.ticker}. If the query DOES name a specific company or ticker, use that instead. Do NOT pick a ticker from uploaded_documents unless the query explicitly references "the uploaded document", "the report", or "the analyst report".`;
    }

    // COREFERENCE HINT: When conversation_history is non-empty and the query
    // looks like a follow-up, add an explicit hint so Haiku doesn't default
    // to workspace_ticker. This is the #1 source of entity resolution bugs.
    if (conversationHistory.length > 0) {
      const lq = query.toLowerCase();
      const isFollowUp = /\b(it|its|their|them|the company|that)\b/.test(lq) ||
        /^(how|what|why|can you|show me|and |also |now )/.test(lq) ||
        lq.includes('compare') || lq.includes('peers') || lq.includes('break') ||
        lq.includes('about') || lq.includes('go wrong');
      if (isFollowUp) {
        // Extract the entity from the most recent conversation turn
        const lastUserMsg = [...conversationHistory].reverse().find(m => m.role === 'user');
        const lastAssistantMsg = [...conversationHistory].reverse().find(m => m.role === 'assistant');
        const historyText = (lastUserMsg?.content || '') + ' ' + (lastAssistantMsg?.summary || lastAssistantMsg?.content || '');
        // Try to find a ticker in the history
        const tickerMatch = historyText.match(/\b([A-Z]{2,5})\b/);
        const companyMatch = historyText.match(/\b(Apple|Microsoft|Tesla|Google|Alphabet|Amazon|NVIDIA|Netflix|Meta|Salesforce|JPMorgan|Broadcom|Costco|UnitedHealth|Eli Lilly)\b/i);
        message.coreference_hint = `CRITICAL: This query is a follow-up. The user is referring to the entity from conversation_history, NOT the workspace ticker. The previous conversation discussed: "${historyText.trim().substring(0, 200)}". Resolve the entity from this history. Do NOT use workspace_ticker=${workspace.ticker || 'null'} unless the history contains no identifiable entity.`;
      }
    }

    return JSON.stringify(message);
  }

  /**
   * Select the most relevant few-shot examples for this query.
   */
  private selectRelevantExamples(query: string, workspace: WorkspaceContext, conversationHistory: ConversationMessage[] = []): any[] {
    const lowerQuery = query.toLowerCase();

    // CRITICAL: If conversation_history is non-empty, always include a coreference example
    // This is the #1 disambiguation signal for follow-up queries
    const hasConversationHistory = conversationHistory.length > 0;

    const scored = this.fewShotExamples.map(ex => {
      let score = 0;
      const desc = (ex.description || '').toLowerCase();
      // Boost examples that match query characteristics
      if (lowerQuery.includes('compare') && desc.includes('comparison')) score += 3;
      if (lowerQuery.includes('cim') && (desc.includes('pe') || desc.includes('deal'))) score += 3;
      if (!workspace.ticker && desc.includes('gibberish')) score += 1;
      if (workspace.domain === 'private_equity' && (desc.includes('pe') || desc.includes('deal') || desc.includes('management'))) score += 2;
      // Cross-domain: PE workspace + public company mention
      if (workspace.domain === 'private_equity' && /\b[A-Z]{2,5}\b/.test(query) && desc.includes('cross-domain')) score += 3;
      // PE-specific keywords
      if ((lowerQuery.includes('target') || lowerQuery.includes('portfolio')) && desc.includes('pe')) score += 2;
      if ((lowerQuery.includes('due diligence') || lowerQuery.includes('data room')) && desc.includes('deal')) score += 2;
      if ((lowerQuery.includes('key person') || lowerQuery.includes('management')) && desc.includes('management')) score += 3;
      // Coreference: when conversation_history exists, ALWAYS boost coreference examples
      if (hasConversationHistory && desc.includes('coreference')) score += 10;
      // Also boost on pronoun/follow-up patterns in query text
      if ((lowerQuery.includes(' it ') || lowerQuery.includes(' their ') || lowerQuery.includes('the company') ||
           lowerQuery.includes('what about') || lowerQuery.includes('how does that') || lowerQuery.includes('how has it') ||
           lowerQuery.includes('can you break') || lowerQuery.includes('why did it') || lowerQuery.includes('what could go wrong') ||
           lowerQuery.match(/^(and |also |what about |how about |show me the |now )/))
          && desc.includes('coreference')) score += 5;
      // Always include the "company name overrides workspace" example — it's the key fix
      if (desc.includes('overrides workspace')) score += 2;
      return { ex, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3).map(s => s.ex);
  }

  /**
   * Fallback when Haiku fails or circuit breaker is open.
   * Spec Appendix C.1: Conservative pass-through, NOT a full regex fallback.
   */
  private buildFallbackUnderstanding(
    query: string,
    workspace: WorkspaceContext,
    uploadedDocs: UploadedDocumentMeta[],
  ): QueryUnderstanding {
    this.logger.warn('🔄 QUL fallback mode — conservative pass-through');

    const isGibberish = query.trim().length < 3 || !/[a-zA-Z]/.test(query);
    if (isGibberish) {
      return {
        entities: [],
        useWorkspaceContext: false,
        intent: 'INVALID',
        domain: 'public_equity',
        complexity: 'simple',
        isValidQuery: false,
        queryQualityScore: 0.05,
        rejectionReason: 'Query too short or contains no meaningful text.',
        temporalScope: { type: 'latest' },
        suggestedRetrievalPaths: [],
        needsPeerComparison: false,
        resolvedBy: 'tier1_haiku',
        confidence: 0.3,
        rawQuery: query,
        normalizedQuery: '',
        _fallbackMode: true,
      };
    }

    // Determine domain from workspace
    const isPE = workspace.domain === 'private_equity';
    const hasUploadedDocs = uploadedDocs.length > 0;

    // For PE workspaces, resolve entity from uploaded docs
    let entities: ResolvedEntity[] = [];
    if (isPE && hasUploadedDocs) {
      // Use the first uploaded doc's entity as the primary entity
      const primaryDoc = uploadedDocs[0];
      entities = [{
        name: primaryDoc.entity || primaryDoc.name,
        ticker: primaryDoc.ticker,
        entityType: primaryDoc.ticker ? 'public_company' : 'uploaded_entity',
        source: 'uploaded_document' as const,
        documentId: primaryDoc.id,
      }];
    } else if (workspace.ticker) {
      entities = [{
        name: workspace.companyName || workspace.ticker,
        ticker: workspace.ticker,
        entityType: 'public_company' as const,
        source: 'workspace_context' as const,
      }];
    }

    // Build retrieval paths based on domain
    const paths: RetrievalPath[] = isPE
      ? ['uploaded_doc_rag', 'structured_db']
      : hasUploadedDocs
        ? ['structured_db', 'semantic_kb', 'uploaded_doc_rag']
        : ['structured_db', 'semantic_kb'];

    return {
      entities,
      primaryEntity: entities[0],
      useWorkspaceContext: !isPE || !hasUploadedDocs,
      intent: isPE ? 'DEAL_ANALYSIS' : 'HYBRID_ANALYSIS',
      domain: isPE ? 'private_equity' : 'public_equity',
      complexity: 'simple',
      isValidQuery: true,
      queryQualityScore: 0.5,
      temporalScope: { type: 'latest' },
      suggestedRetrievalPaths: paths,
      needsPeerComparison: false,
      resolvedBy: 'tier1_haiku',
      confidence: 0.3,
      rawQuery: query,
      normalizedQuery: query,
      _fallbackMode: true,
    };
  }

  // ── Cache management ───────────────────────────────────────────────

  private buildCacheKey(
    query: string,
    workspace: WorkspaceContext,
    docs: UploadedDocumentMeta[],
  ): string {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
    const docHash = docs.map(d => d.id).sort().join(',');
    return `${normalized}|${workspace.ticker || ''}|${workspace.domain}|${docHash}`;
  }

  private getFromCache(key: string): QueryUnderstanding | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setCache(key: string, value: QueryUnderstanding): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.CACHE_MAX_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Clear all cache entries. Called on workspace switch or document upload.
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('🗑️ QUL cache cleared');
  }

  // ── Circuit breaker ────────────────────────────────────────────────

  private isCircuitOpen(): boolean {
    if (this.failureCount < this.CIRCUIT_BREAKER_THRESHOLD) return false;
    // Auto-reset after CIRCUIT_BREAKER_RESET_MS
    if (Date.now() - this.lastFailureTime > this.CIRCUIT_BREAKER_RESET_MS) {
      this.failureCount = 0;
      this.logger.log('🔄 QUL circuit breaker reset');
      return false;
    }
    return true;
  }

  // ── Utilities ──────────────────────────────────────────────────────

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`QUL Haiku timeout after ${ms}ms`)), ms),
    );
  }
}
