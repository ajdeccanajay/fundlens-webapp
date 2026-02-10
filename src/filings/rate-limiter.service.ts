import { Injectable, Logger } from '@nestjs/common';

/**
 * Rate Limiter Service
 * Ensures compliance with SEC EDGAR API rate limits (10 requests per second)
 * 
 * Features:
 * - Token bucket algorithm for smooth rate limiting
 * - Request tracking and metrics
 * - Configurable rate limits
 * - Monitoring and logging
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  // SEC EDGAR API rate limit: 10 requests per second
  private readonly maxRequestsPerSecond: number;
  private readonly minDelayMs: number;

  // Token bucket for rate limiting
  private tokens: number;
  private lastRefillTime: number;

  // Mutex for concurrent request handling
  private requestQueue: Promise<void> = Promise.resolve();

  // Metrics
  private totalRequests = 0;
  private totalDelays = 0;
  private totalDelayTime = 0;
  private requestTimestamps: number[] = [];

  constructor() {
    // Default to 9 req/sec for safety margin (SEC limit is 10)
    this.maxRequestsPerSecond = Number(process.env.SEC_MAX_REQUESTS_PER_SECOND || 9);
    this.minDelayMs = 1000 / this.maxRequestsPerSecond;

    // Initialize token bucket
    this.tokens = this.maxRequestsPerSecond;
    this.lastRefillTime = Date.now();

    this.logger.log(
      `Rate limiter initialized: ${this.maxRequestsPerSecond} req/sec (${this.minDelayMs}ms min delay)`,
    );
  }

  /**
   * Wait for rate limit compliance before making a request
   * Uses token bucket algorithm to smooth out bursts
   * Handles concurrent requests with a queue to prevent race conditions
   */
  async waitForRateLimit(): Promise<void> {
    // Queue this request to prevent race conditions with concurrent calls
    const previousRequest = this.requestQueue;
    let resolveThis: () => void;
    this.requestQueue = new Promise(resolve => {
      resolveThis = resolve;
    });

    // Wait for previous request to complete
    await previousRequest;

    try {
      const now = Date.now();

      // Refill tokens based on time elapsed
      const timeSinceLastRefill = now - this.lastRefillTime;
      const tokensToAdd = (timeSinceLastRefill / 1000) * this.maxRequestsPerSecond;
      this.tokens = Math.min(this.maxRequestsPerSecond, this.tokens + tokensToAdd);
      this.lastRefillTime = now;

      // If no tokens available, wait until we have one
      if (this.tokens < 1) {
        const waitTime = ((1 - this.tokens) / this.maxRequestsPerSecond) * 1000;
        this.logger.debug(`Rate limit reached, waiting ${Math.ceil(waitTime)}ms`);
        
        this.totalDelays++;
        this.totalDelayTime += waitTime;

        await this.sleep(waitTime);

        // Refill after waiting
        const afterWait = Date.now();
        const additionalTime = afterWait - this.lastRefillTime;
        const additionalTokens = (additionalTime / 1000) * this.maxRequestsPerSecond;
        this.tokens = Math.min(this.maxRequestsPerSecond, this.tokens + additionalTokens);
        this.lastRefillTime = afterWait;
      }

      // Consume one token
      this.tokens -= 1;

      // Track request
      this.totalRequests++;
      this.requestTimestamps.push(Date.now());

      // Keep only last 60 seconds of timestamps for metrics
      const oneMinuteAgo = Date.now() - 60000;
      this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
    } finally {
      // Release the next request in queue
      resolveThis!();
    }
  }

  /**
   * Get current rate limit metrics
   */
  getMetrics(): RateLimitMetrics {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    const oneMinuteAgo = now - 60000;

    const requestsLastSecond = this.requestTimestamps.filter(ts => ts > oneSecondAgo).length;
    const requestsLastMinute = this.requestTimestamps.filter(ts => ts > oneMinuteAgo).length;

    return {
      totalRequests: this.totalRequests,
      totalDelays: this.totalDelays,
      totalDelayTime: this.totalDelayTime,
      averageDelayTime: this.totalDelays > 0 ? this.totalDelayTime / this.totalDelays : 0,
      requestsLastSecond,
      requestsLastMinute,
      currentTokens: this.tokens,
      maxRequestsPerSecond: this.maxRequestsPerSecond,
      minDelayMs: this.minDelayMs,
      isCompliant: requestsLastSecond <= this.maxRequestsPerSecond,
    };
  }

  /**
   * Log current metrics
   */
  logMetrics(): void {
    const metrics = this.getMetrics();
    
    this.logger.log(
      `Rate limit metrics: ${metrics.requestsLastSecond} req/sec (last 1s), ` +
      `${metrics.requestsLastMinute} req/min (last 60s), ` +
      `${metrics.totalRequests} total requests, ` +
      `${metrics.totalDelays} delays (avg ${Math.ceil(metrics.averageDelayTime)}ms), ` +
      `${metrics.currentTokens.toFixed(2)} tokens available`,
    );

    if (!metrics.isCompliant) {
      this.logger.warn(
        `⚠️  Rate limit compliance warning: ${metrics.requestsLastSecond} req/sec exceeds limit of ${metrics.maxRequestsPerSecond}`,
      );
    }
  }

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics(): void {
    this.totalRequests = 0;
    this.totalDelays = 0;
    this.totalDelayTime = 0;
    this.requestTimestamps = [];
    this.tokens = this.maxRequestsPerSecond;
    this.lastRefillTime = Date.now();
    this.requestQueue = Promise.resolve();
    
    this.logger.log('Rate limiter metrics reset');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface RateLimitMetrics {
  totalRequests: number;
  totalDelays: number;
  totalDelayTime: number;
  averageDelayTime: number;
  requestsLastSecond: number;
  requestsLastMinute: number;
  currentTokens: number;
  maxRequestsPerSecond: number;
  minDelayMs: number;
  isCompliant: boolean;
}
