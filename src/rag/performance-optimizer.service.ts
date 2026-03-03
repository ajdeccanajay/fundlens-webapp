import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Performance Optimizer Service
 * 
 * Optimizes RAG system performance through:
 * - Query result caching (Redis or in-memory)
 * - Parallel execution for hybrid retrieval
 * - Smart LLM usage (skip when unnecessary)
 * - Model tier selection (Haiku/Sonnet/Opus)
 * - Token budget management
 * 
 * Target: <5s latency for p95 of queries
 */

export interface CacheConfig {
  enabled: boolean;
  ttlLatest: number;      // TTL for "latest" queries (seconds)
  ttlHistorical: number;  // TTL for historical queries (seconds)
  ttlSemantic: number;    // TTL for semantic queries (seconds)
  maxSize: number;        // Max cache entries (for in-memory)
}

export interface CacheEntry<T> {
  data: T;
  timestamp: Date;
  ttl: number;
  hits: number;
  ticker?: string; // For ticker-based invalidation
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  evictions: number;
}

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface QueryComplexity {
  level: 'simple' | 'medium' | 'complex';
  factors: string[];
  estimatedTokens: number;
  score: number; // 0-100
}

export interface OptimizationDecisions {
  useCache: boolean;
  cacheKey?: string;
  useLLM: boolean;
  modelTier: ModelTier;
  maxTokens: number;
  parallelExecution: boolean;
  reasoning: string[];
}

@Injectable()
export class PerformanceOptimizerService {
  private readonly logger = new Logger(PerformanceOptimizerService.name);
  
  // In-memory cache (can be replaced with Redis)
  private cache = new Map<string, CacheEntry<any>>();
  
  // Cache metrics
  private cacheHits = 0;
  private cacheMisses = 0;
  private cacheEvictions = 0;
  
  // Default cache configuration
  private config: CacheConfig = {
    enabled: true,
    ttlLatest: 300,       // 5 minutes for latest queries (reduced from 1hr to prevent stale chart data)
    ttlHistorical: 3600,  // 1 hour for historical queries
    ttlSemantic: 1800,    // 30 minutes for semantic queries
    maxSize: 1000,        // Max 1000 entries in memory
  };
  
  // Token estimation (rough: 4 chars per token)
  private readonly CHARS_PER_TOKEN = 4;
  
  // Model token limits
  private readonly MODEL_LIMITS = {
    haiku: 200000,
    sonnet: 200000,
    opus: 200000,
  };
  
  /**
   * Configure cache settings
   */
  configure(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.log(`Cache configured: ${JSON.stringify(this.config)}`);
  }
  
  /**
   * Generate cache key from query and tenant
   */
  generateCacheKey(query: string, tenantId?: string): string {
    const normalized = query.toLowerCase().trim();
    const prefix = tenantId || 'global';
    const hash = createHash('sha256').update(normalized).digest('hex').substring(0, 16);
    return `rag:${prefix}:${hash}`;
  }
  
  /**
   * Get TTL based on query intent
   */
  getCacheTTL(intent: any): number {
    // Latest queries: 1 hour (data changes frequently)
    if (intent.periodType === 'latest' || intent.period === 'latest') {
      return this.config.ttlLatest;
    }
    
    // Historical queries: 24 hours (data stable)
    if (intent.period && intent.period !== 'latest') {
      return this.config.ttlHistorical;
    }
    
    // Semantic queries: 6 hours (narrative stable)
    if (intent.type === 'semantic') {
      return this.config.ttlSemantic;
    }
    
    // Default: 1 hour
    return this.config.ttlLatest;
  }
  
  /**
   * Cache a query result
   */
  cacheQuery<T>(key: string, data: T, ttl: number, ticker?: string): void {
    if (!this.config.enabled) {
      return;
    }
    
    // Don't evict if we're updating an existing key
    const isUpdate = this.cache.has(key);
    
    // Evict oldest entry if cache is full and this is a new key
    if (!isUpdate && this.cache.size >= this.config.maxSize) {
      const oldestKey = this.findOldestEntry();
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.cacheEvictions++;
        this.logger.log(`Cache eviction: removed ${oldestKey}`);
      }
    }
    
    this.cache.set(key, {
      data,
      timestamp: new Date(),
      ttl,
      hits: 0,
      ticker: ticker?.toUpperCase(),
    });
  }
  
  /**
   * Get cached query result
   */
  getCachedQuery<T>(key: string): T | null {
    if (!this.config.enabled) {
      this.cacheMisses++;
      return null;
    }
    
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.cacheMisses++;
      return null;
    }
    
    // Check if entry has expired
    const age = Date.now() - entry.timestamp.getTime();
    if (age > entry.ttl * 1000) {
      this.cache.delete(key);
      this.cacheMisses++;
      return null;
    }
    
    // Update hit count
    entry.hits++;
    this.cacheHits++;
    
    return entry.data as T;
  }
  
  /**
   * Find oldest cache entry for eviction
   */
  private findOldestEntry(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      const time = entry.timestamp.getTime();
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }
    
    return oldestKey;
  }
  
  /**
   * Get cache metrics
   */
  getCacheMetrics(): CacheMetrics {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
      size: this.cache.size,
      evictions: this.cacheEvictions,
    };
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Cache cleared');
  }
  
  /**
   * Invalidate all cache entries for a given ticker.
   * Called when new SEC filings are ingested.
   * Returns the number of entries removed.
   */
  invalidateByTicker(ticker: string): number {
    const upperTicker = ticker.toUpperCase();
    let removed = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.ticker === upperTicker) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    this.cacheEvictions += removed;
    
    if (removed > 0) {
      this.logger.log(`🗑️ Invalidated ${removed} cache entries for ticker ${upperTicker}`);
    }
    
    return removed;
  }
  
  /**
   * Assess query complexity
   */
  assessComplexity(intent: any): QueryComplexity {
    const factors: string[] = [];
    let score = 0;
    
    // Multiple tickers = complex
    if (Array.isArray(intent.ticker) && intent.ticker.length > 1) {
      factors.push('Multi-company comparison');
      score += 30;
    }
    
    // Multiple metrics = medium complexity
    if (intent.metrics && intent.metrics.length > 2) {
      factors.push(`Multiple metrics (${intent.metrics.length})`);
      score += 15;
    }
    
    // Computation needed = complex
    if (intent.needsComputation) {
      factors.push('Requires computation');
      score += 25;
    }
    
    // Trend analysis = complex
    if (intent.needsTrend) {
      factors.push('Trend analysis');
      score += 20;
    }
    
    // Comparison = complex
    if (intent.needsComparison) {
      factors.push('Comparison analysis');
      score += 20;
    }
    
    // Multiple sections = medium complexity
    if (intent.sectionTypes && intent.sectionTypes.length > 1) {
      factors.push(`Multiple sections (${intent.sectionTypes.length})`);
      score += 10;
    }
    
    // Hybrid query = medium complexity
    if (intent.type === 'hybrid') {
      factors.push('Hybrid query (metrics + narrative)');
      score += 15;
    }
    
    // Estimate tokens (rough)
    const estimatedTokens = this.estimateTokens(intent);
    
    // Determine level
    let level: 'simple' | 'medium' | 'complex';
    if (score >= 50) {
      level = 'complex';
    } else if (score >= 20) {
      level = 'medium';
    } else {
      level = 'simple';
    }
    
    return {
      level,
      factors,
      estimatedTokens,
      score,
    };
  }
  
  /**
   * Estimate token count for query
   */
  private estimateTokens(intent: any): number {
    let tokens = 0;
    
    // Base query tokens
    tokens += 100; // System prompt
    tokens += Math.ceil((intent.originalQuery?.length || 0) / this.CHARS_PER_TOKEN);
    
    // Metrics tokens (rough estimate)
    if (intent.metrics) {
      tokens += intent.metrics.length * 50; // ~50 tokens per metric
    }
    
    // Narrative tokens (rough estimate)
    if (intent.sectionTypes) {
      tokens += intent.sectionTypes.length * 500; // ~500 tokens per section
    }
    
    return tokens;
  }
  
  /**
   * Determine if LLM should be used
   */
  shouldUseLLM(intent: any, metrics: any[], narratives: any[]): boolean {
    this.logger.log(`🔍 DEBUG shouldUseLLM evaluation:`);
    this.logger.log(`   intent.type: ${intent.type}`);
    this.logger.log(`   intent.needsNarrative: ${intent.needsNarrative}`);
    this.logger.log(`   metrics.length: ${metrics.length}`);
    this.logger.log(`   narratives.length: ${narratives.length}`);
    
    // Don't use LLM if no data found
    if (metrics.length === 0 && narratives.length === 0) {
      this.logger.log(`   ❌ Skipping LLM: no data found`);
      return false;
    }
    
    // Always use LLM when we have data — equity analysts expect analytical
    // commentary, not just raw tables. The synthesis prompt handles brevity
    // for simple queries via the 400-word limit.
    this.logger.log(`   ✅ Using LLM: data available (${metrics.length} metrics, ${narratives.length} narratives)`);
    return true;
  }
  
  /**
   * Select appropriate model tier
   */
  selectModelTier(complexity: QueryComplexity): ModelTier {
      // Opus for complex analysis
      if (complexity.level === 'complex') {
        return 'opus';
      }

      // Sonnet minimum for all synthesis — Haiku produces thin responses
      return 'sonnet';
    }
  
  /**
   * Get model ID for tier
   */
  getModelId(tier: ModelTier): string {
    const models = {
      haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      sonnet: 'us.anthropic.claude-sonnet-4-6',
      opus: 'us.anthropic.claude-opus-4-6-v1',
    };
    return models[tier];
  }
  
  /**
   * Enforce token budget on chunks
   */
  enforceTokenBudget<T extends { content: string; score?: number }>(
    chunks: T[],
    maxTokens: number,
  ): T[] {
    let totalTokens = 0;
    const selected: T[] = [];
    
    // Sort by relevance score (descending) if available
    const sorted = [...chunks].sort((a, b) => {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      return scoreB - scoreA;
    });
    
    for (const chunk of sorted) {
      const chunkTokens = Math.ceil(chunk.content.length / this.CHARS_PER_TOKEN);
      
      if (totalTokens + chunkTokens <= maxTokens) {
        selected.push(chunk);
        totalTokens += chunkTokens;
      } else {
        break;
      }
    }
    
    if (selected.length < chunks.length) {
      this.logger.log(
        `Token budget enforced: ${selected.length}/${chunks.length} chunks selected (${totalTokens}/${maxTokens} tokens)`,
      );
    }
    
    return selected;
  }
  
  /**
   * Make optimization decisions for a query
   */
  makeOptimizationDecisions(
    query: string,
    intent: any,
    tenantId?: string,
  ): OptimizationDecisions {
    const reasoning: string[] = [];
    
    // Check cache
    const cacheKey = this.generateCacheKey(query, tenantId);
    const useCache = this.config.enabled;
    if (useCache) {
      reasoning.push('Cache enabled');
    }
    
    // Assess complexity
    const complexity = this.assessComplexity(intent);
    reasoning.push(`Complexity: ${complexity.level} (score: ${complexity.score})`);
    
    // Select model tier
    const modelTier = this.selectModelTier(complexity);
    reasoning.push(`Model tier: ${modelTier}`);
    
    // Determine if LLM needed (will be checked again with actual data)
    const useLLM = intent.type !== 'structured' || intent.needsNarrative;
    if (useLLM) {
      reasoning.push('LLM generation enabled');
    } else {
      reasoning.push('LLM generation may be skipped for simple lookups');
    }
    
    // Set token budget based on model
    const maxTokens = Math.floor(this.MODEL_LIMITS[modelTier] * 0.4); // 40% of limit for context
    reasoning.push(`Token budget: ${maxTokens}`);
    
    // Parallel execution for hybrid queries
    const parallelExecution = intent.type === 'hybrid';
    if (parallelExecution) {
      reasoning.push('Parallel execution enabled for hybrid query');
    }
    
    return {
      useCache,
      cacheKey,
      useLLM,
      modelTier,
      maxTokens,
      parallelExecution,
      reasoning,
    };
  }
  
  /**
   * Execute tasks in parallel
   */
  async executeParallel<T>(tasks: Promise<T>[]): Promise<T[]> {
    const startTime = Date.now();
    const results = await Promise.all(tasks);
    const duration = Date.now() - startTime;
    
    this.logger.log(
      `Parallel execution completed: ${tasks.length} tasks in ${duration}ms`,
    );
    
    return results;
  }
  
  /**
   * Execute tasks in parallel with error handling
   */
  async executeParallelSafe<T>(
    tasks: Promise<T>[],
  ): Promise<Array<T | null>> {
    const startTime = Date.now();
    
    const results = await Promise.allSettled(tasks);
    
    const duration = Date.now() - startTime;
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    this.logger.log(
      `Parallel execution completed: ${successful}/${tasks.length} successful, ${failed} failed in ${duration}ms`,
    );
    
    return results.map(r => (r.status === 'fulfilled' ? r.value : null));
  }
  
  /**
   * Get optimization summary
   */
  getSummary(): string {
    const cacheMetrics = this.getCacheMetrics();
    
    return `
Performance Optimizer Summary:
  Cache Status: ${this.config.enabled ? 'Enabled' : 'Disabled'}
  Cache Hit Rate: ${(cacheMetrics.hitRate * 100).toFixed(1)}%
  Cache Size: ${cacheMetrics.size}/${this.config.maxSize}
  Cache Hits: ${cacheMetrics.hits}
  Cache Misses: ${cacheMetrics.misses}
  Cache Evictions: ${cacheMetrics.evictions}
  
  TTL Configuration:
    Latest queries: ${this.config.ttlLatest}s
    Historical queries: ${this.config.ttlHistorical}s
    Semantic queries: ${this.config.ttlSemantic}s
    `.trim();
  }
}
