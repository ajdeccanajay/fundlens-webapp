/**
 * QULObservabilityService — QUL Phase 5 (Spec §10)
 *
 * Tracks QUL resolution metrics for monitoring and prompt improvement.
 * Logs tier distribution, latency, accuracy signals, and error rates.
 *
 * MVP: In-memory counters with periodic log output.
 * Future: CloudWatch metrics, DynamoDB persistence.
 */
import { Injectable, Logger } from '@nestjs/common';
import { QueryUnderstanding, QueryIntent } from './types/query-understanding.types';

interface QULMetrics {
  // Resolution tier distribution
  tier1HaikuCount: number;
  tier2CacheCount: number;
  fallbackCount: number;

  // Latency tracking (milliseconds)
  latencies: number[];

  // Intent distribution
  intentCounts: Record<string, number>;

  // Domain distribution
  domainCounts: Record<string, number>;

  // Error tracking
  parseFailures: number;
  timeouts: number;
  circuitBreakerTrips: number;

  // Quality signals
  invalidQueryCount: number;
  lowConfidenceCount: number; // confidence < 0.5
  workspaceOverrideCount: number; // entity != workspace ticker

  // Phase 4: Document extraction
  docExtractionCount: number;
  docExtractionSuccessCount: number;
  docExtractionCacheHits: number;

  // Window tracking
  windowStart: Date;
  totalQueries: number;
}

@Injectable()
export class QULObservabilityService {
  private readonly logger = new Logger(QULObservabilityService.name);
  private metrics: QULMetrics;
  private readonly LOG_INTERVAL_MS = 5 * 60 * 1000; // Log every 5 minutes
  private logTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.metrics = this.createEmptyMetrics();
    this.startPeriodicLogging();
  }

  /**
   * Record a QUL resolution event.
   */
  recordResolution(
    understanding: QueryUnderstanding,
    latencyMs: number,
    options?: { wasFallback?: boolean; wasTimeout?: boolean; wasParseFailure?: boolean },
  ): void {
    this.metrics.totalQueries++;

    // Tier distribution
    if (options?.wasFallback) {
      this.metrics.fallbackCount++;
    } else if (understanding.resolvedBy === 'tier2_cache') {
      this.metrics.tier2CacheCount++;
    } else {
      this.metrics.tier1HaikuCount++;
    }

    // Latency
    this.metrics.latencies.push(latencyMs);

    // Intent distribution
    this.metrics.intentCounts[understanding.intent] =
      (this.metrics.intentCounts[understanding.intent] || 0) + 1;

    // Domain distribution
    this.metrics.domainCounts[understanding.domain] =
      (this.metrics.domainCounts[understanding.domain] || 0) + 1;

    // Error tracking
    if (options?.wasParseFailure) this.metrics.parseFailures++;
    if (options?.wasTimeout) this.metrics.timeouts++;

    // Quality signals
    if (!understanding.isValidQuery) this.metrics.invalidQueryCount++;
    if (understanding.confidence < 0.5) this.metrics.lowConfidenceCount++;
    if (!understanding.useWorkspaceContext && understanding.entities.length > 0) {
      this.metrics.workspaceOverrideCount++;
    }
  }

  /**
   * Record a circuit breaker trip.
   */
  recordCircuitBreakerTrip(): void {
    this.metrics.circuitBreakerTrips++;
  }

  /**
   * Record a document metric extraction event (Phase 4).
   */
  recordDocExtraction(success: boolean, cacheHit: boolean): void {
    this.metrics.docExtractionCount++;
    if (success) this.metrics.docExtractionSuccessCount++;
    if (cacheHit) this.metrics.docExtractionCacheHits++;
  }

  /**
   * Get current metrics snapshot.
   */
  getMetrics(): QULMetrics & { computed: Record<string, number | string> } {
    const latencies = this.metrics.latencies;
    const sorted = [...latencies].sort((a, b) => a - b);

    return {
      ...this.metrics,
      computed: {
        p50Latency: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : 0,
        p99Latency: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0,
        avgLatency: latencies.length > 0
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : 0,
        cacheHitRate: this.metrics.totalQueries > 0
          ? `${((this.metrics.tier2CacheCount / this.metrics.totalQueries) * 100).toFixed(1)}%`
          : '0%',
        invalidRate: this.metrics.totalQueries > 0
          ? `${((this.metrics.invalidQueryCount / this.metrics.totalQueries) * 100).toFixed(1)}%`
          : '0%',
        fallbackRate: this.metrics.totalQueries > 0
          ? `${((this.metrics.fallbackCount / this.metrics.totalQueries) * 100).toFixed(1)}%`
          : '0%',
        docExtractionSuccessRate: this.metrics.docExtractionCount > 0
          ? `${((this.metrics.docExtractionSuccessCount / this.metrics.docExtractionCount) * 100).toFixed(1)}%`
          : 'N/A',
      },
    };
  }

  /**
   * Reset metrics (e.g., at the start of a new monitoring window).
   */
  resetMetrics(): void {
    this.metrics = this.createEmptyMetrics();
  }

  private createEmptyMetrics(): QULMetrics {
    return {
      tier1HaikuCount: 0,
      tier2CacheCount: 0,
      fallbackCount: 0,
      latencies: [],
      intentCounts: {},
      domainCounts: {},
      parseFailures: 0,
      timeouts: 0,
      circuitBreakerTrips: 0,
      invalidQueryCount: 0,
      lowConfidenceCount: 0,
      workspaceOverrideCount: 0,
      docExtractionCount: 0,
      docExtractionSuccessCount: 0,
      docExtractionCacheHits: 0,
      windowStart: new Date(),
      totalQueries: 0,
    };
  }

  private startPeriodicLogging(): void {
    this.logTimer = setInterval(() => {
      if (this.metrics.totalQueries === 0) return;

      const m = this.getMetrics();
      this.logger.log(
        `📊 QUL Metrics (${m.totalQueries} queries): ` +
        `haiku=${m.tier1HaikuCount} cache=${m.tier2CacheCount} fallback=${m.fallbackCount} | ` +
        `p50=${m.computed.p50Latency}ms p99=${m.computed.p99Latency}ms | ` +
        `cacheHit=${m.computed.cacheHitRate} invalid=${m.computed.invalidRate} | ` +
        `parseErr=${m.parseFailures} timeouts=${m.timeouts} cbTrips=${m.circuitBreakerTrips}`,
      );

      // Log intent distribution
      const topIntents = Object.entries(m.intentCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');
      if (topIntents) {
        this.logger.log(`📊 QUL Top Intents: ${topIntents}`);
      }

      // Reset window
      this.resetMetrics();
    }, this.LOG_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.logTimer) clearInterval(this.logTimer);
  }
}