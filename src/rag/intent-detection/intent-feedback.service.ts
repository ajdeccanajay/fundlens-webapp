import { Injectable, Logger } from '@nestjs/common';
import { IntentAnalyticsService } from '../intent-analytics.service';
import { MetricLearningService } from '../metric-learning.service';
import { FastPathCache } from './fast-path-cache';
import { QueryIntent } from '../types/query-intent';

/**
 * IntentFeedbackService — Closed feedback loop for the intent detection system.
 *
 * Logs low-confidence detections, user corrections, metric suggestion selections,
 * and unresolved metrics. Automatically invalidates cache entries when corrections
 * occur, so the system learns from mistakes.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */
@Injectable()
export class IntentFeedbackService {
  private readonly logger = new Logger(IntentFeedbackService.name);

  constructor(
    private readonly analytics: IntentAnalyticsService,
    private readonly metricLearning: MetricLearningService,
    private readonly fastPathCache: FastPathCache,
  ) {}

  /**
   * Log a low-confidence detection for review.
   * Called when the intent detector produces a result with confidence < 0.7.
   *
   * Requirement 7.1: Log query, detected intent, confidence, and detection method
   */
  async logLowConfidence(params: {
    query: string;
    intent: QueryIntent;
    confidence: number;
    method: string;
    tenantId: string;
  }): Promise<void> {
    try {
      await this.analytics.logDetection({
        tenantId: params.tenantId,
        query: params.query,
        detectedIntent: params.intent,
        detectionMethod: params.method as any,
        confidence: params.confidence,
        success: false,
        errorMessage: `Low confidence detection: ${params.confidence}`,
        latencyMs: 0,
      });

      this.logger.warn(
        `Low confidence detection (${params.confidence}) for query: "${params.query}" via ${params.method}`,
      );
    } catch (error) {
      this.logger.error(`Failed to log low confidence detection: ${error.message}`);
    }
  }

  /**
   * Log a correction pair when a user re-asks a query with different phrasing.
   * Invalidates the cache entry for the original query so the incorrect pattern
   * is not reused.
   *
   * Requirement 7.2: Log original and corrected query as a correction pair
   * Requirement 7.4: Invalidate cache entry for the original query
   */
  async logCorrection(params: {
    originalQuery: string;
    correctedQuery: string;
    sessionId: string;
    tenantId: string;
  }): Promise<void> {
    try {
      // Invalidate the old cache entry
      this.fastPathCache.invalidate(params.originalQuery);

      // Log the correction pair for analysis
      await this.analytics.logDetection({
        tenantId: params.tenantId,
        query: params.originalQuery,
        detectedIntent: {
          type: 'semantic',
          needsNarrative: false,
          needsComparison: false,
          needsComputation: false,
          needsTrend: false,
          confidence: 0,
          originalQuery: params.originalQuery,
        },
        detectionMethod: 'generic',
        confidence: 0,
        success: false,
        errorMessage: `Correction: user re-asked as "${params.correctedQuery}" (session: ${params.sessionId})`,
        latencyMs: 0,
      });

      this.logger.log(
        `Logged correction: "${params.originalQuery}" → "${params.correctedQuery}"`,
      );
    } catch (error) {
      this.logger.error(`Failed to log correction: ${error.message}`);
    }
  }

  /**
   * Log when a user selects a metric suggestion from MetricRegistryService's
   * unresolved suggestions. Invalidates the cache entry and logs to
   * MetricLearningService for the learning loop.
   *
   * Requirement 7.3: Log mapping from original query to selected metric
   * Requirement 7.4: Update cache with corrected result
   * Requirement 7.5: Integrate with MetricLearningService
   */
  async logMetricSuggestionSelected(params: {
    originalQuery: string;
    selectedMetric: string;
    tenantId: string;
  }): Promise<void> {
    try {
      // Log to MetricLearningService for the learning loop
      await this.metricLearning.logUnrecognizedMetric({
        tenantId: params.tenantId,
        ticker: '',
        query: params.originalQuery,
        requestedMetric: params.selectedMetric,
        failureReason: 'User selected metric suggestion — logging for learning loop',
        userMessage: '',
      });

      // Invalidate cache for this pattern
      this.fastPathCache.invalidate(params.originalQuery);

      this.logger.log(
        `Metric suggestion selected: "${params.selectedMetric}" for query "${params.originalQuery}"`,
      );
    } catch (error) {
      this.logger.error(`Failed to log metric suggestion selection: ${error.message}`);
    }
  }

  /**
   * Forward an unresolved metric to MetricLearningService.
   * Called when the LLM detects a metric phrase that MetricRegistryService
   * cannot resolve.
   *
   * Requirement 7.5: Integrate with MetricLearningService for unrecognized metrics
   */
  async logUnresolvedMetric(params: {
    rawPhrase: string;
    query: string;
    tenantId: string;
    ticker: string;
  }): Promise<void> {
    try {
      await this.metricLearning.logUnrecognizedMetric({
        tenantId: params.tenantId,
        ticker: params.ticker,
        query: params.query,
        requestedMetric: params.rawPhrase,
        failureReason: 'LLM detected metric phrase not in MetricRegistryService',
        userMessage: '',
      });

      this.logger.log(
        `Logged unresolved metric: "${params.rawPhrase}" for ticker ${params.ticker}`,
      );
    } catch (error) {
      this.logger.error(`Failed to log unresolved metric: ${error.message}`);
    }
  }
}
