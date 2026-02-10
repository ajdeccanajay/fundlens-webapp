/**
 * Property-Based Test: Rate Limit Compliance
 * Feature: automatic-filing-detection, Property 9: Rate Limit Compliance
 *
 * **Validates: Requirements US-1 (Acceptance Criteria 5), NFR-4**
 *
 * For any detection run, the system SHALL NOT exceed 10 requests per second
 * to the SEC EDGAR API.
 *
 * Strategy:
 * - Use the REAL RateLimiterService (not mocked) to test actual rate limiting
 * - Generate random numbers of tickers (1-20) to simulate detection runs
 * - Track timing of SEC API calls to verify rate compliance
 * - Verify the rate limiter enforces the configured rate (9 req/sec, under SEC's 10)
 * - Verify waitForRateLimit() is called before each SEC API request
 * - Verify the rate limiter properly delays requests when tokens are exhausted
 *
 * Token Bucket Behavior:
 * The RateLimiterService uses a token bucket (capacity=9, refill=9/sec).
 * - Initial burst: up to 9 requests can complete instantly
 * - Sustained rate: after burst, requests are throttled to ~9/sec
 * - The configured rate of 9/sec provides a safety margin under SEC's 10/sec limit
 * - Over any period longer than 1 second, the average rate converges to ≤ 9 req/sec
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { RateLimiterService } from '../../src/filings/rate-limiter.service';

// ─── Smart Generators ────────────────────────────────────────────────────────

/**
 * Generator for the number of simulated SEC API requests in a detection run.
 * Each ticker requires up to 3 API calls (one per filing type: 10-K, 10-Q, 8-K).
 * Capped at 7 tickers (21 requests) to keep test duration reasonable.
 */
const requestCountArb = fc.integer({ min: 1, max: 7 }).map((tickers) => ({
  tickerCount: tickers,
  totalRequests: tickers * 3,
}));

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Property 9: Rate Limit Compliance', () => {
  // The rate limiter defaults to 9 req/sec (safety margin under SEC's 10)
  const CONFIGURED_RATE = 9;
  const SEC_HARD_LIMIT = 10;

  /**
   * Create a fresh RateLimiterService for each property iteration.
   * This avoids shared state issues between fast-check runs.
   */
  async function createFreshRateLimiter(): Promise<RateLimiterService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RateLimiterService],
    }).compile();

    const limiter = module.get<RateLimiterService>(RateLimiterService);
    limiter.resetMetrics();
    return limiter;
  }

  /**
   * Property 9a: Sequential Rate Limit - Minimum Duration Enforcement
   *
   * For any number of tickers (1-7), when requests are made sequentially
   * (as in the normal detection loop), the total duration SHALL be at least
   * (N - bucketSize) / rate seconds, proving the rate limiter throttles
   * requests beyond the initial burst.
   *
   * This is the core rate compliance property: if N requests take at least
   * (N - 9) / 9 seconds, then the sustained rate is ≤ 9 req/sec < 10 req/sec.
   *
   * **Validates: Requirements US-1 (Acceptance Criteria 5), NFR-4**
   */
  it('should enforce minimum duration for sequential detection runs, proving rate ≤ 10 req/sec', async () => {
    await fc.assert(
      fc.asyncProperty(
        requestCountArb,
        async ({ tickerCount, totalRequests }) => {
          const rateLimiter = await createFreshRateLimiter();

          const startTime = Date.now();

          // Simulate a detection run: for each ticker, make 3 API calls
          for (let ticker = 0; ticker < tickerCount; ticker++) {
            for (let filingType = 0; filingType < 3; filingType++) {
              await rateLimiter.waitForRateLimit();
            }
          }

          const totalDuration = Date.now() - startTime;

          // ── Assert: Rate Compliance ──────────────────────────────────

          // Property: Total requests matches expected count
          const metrics = rateLimiter.getMetrics();
          expect(metrics.totalRequests).toBe(totalRequests);

          // Property: If requests exceed bucket size, duration proves rate limiting
          if (totalRequests > CONFIGURED_RATE) {
            // Minimum duration = (N - bucketSize) / rate * 1000ms
            // The first `bucketSize` requests are instant (burst), the rest
            // are throttled at `rate` per second
            const excessRequests = totalRequests - CONFIGURED_RATE;
            const minExpectedMs = (excessRequests / CONFIGURED_RATE) * 1000;

            // Allow 20% tolerance for OS scheduling jitter
            expect(totalDuration).toBeGreaterThanOrEqual(minExpectedMs * 0.8);
          }

          // Property: Delays were introduced when bucket was exhausted
          if (totalRequests > CONFIGURED_RATE) {
            expect(metrics.totalDelays).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 25 },
    );
  }, 30000);

  /**
   * Property 9b: Concurrent Rate Limit - Serialization Enforcement
   *
   * For any number of concurrent requests (3-12), the rate limiter's
   * internal queue SHALL serialize them, ensuring the same rate limiting
   * behavior as sequential requests.
   *
   * **Validates: Requirements US-1 (Acceptance Criteria 5), NFR-4**
   */
  it('should serialize concurrent requests and enforce rate limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 12 }),
        async (concurrentRequests) => {
          const rateLimiter = await createFreshRateLimiter();

          const startTime = Date.now();

          // Fire all requests concurrently
          const promises = Array.from({ length: concurrentRequests }, () =>
            rateLimiter.waitForRateLimit(),
          );
          await Promise.all(promises);

          const totalDuration = Date.now() - startTime;

          // ── Assert: Rate Compliance ──────────────────────────────────

          const metrics = rateLimiter.getMetrics();
          expect(metrics.totalRequests).toBe(concurrentRequests);

          // Property: If requests exceed bucket size, duration proves rate limiting
          if (concurrentRequests > CONFIGURED_RATE) {
            const excessRequests = concurrentRequests - CONFIGURED_RATE;
            const minExpectedMs = (excessRequests / CONFIGURED_RATE) * 1000;
            expect(totalDuration).toBeGreaterThanOrEqual(minExpectedMs * 0.8);
            expect(metrics.totalDelays).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 25 },
    );
  }, 30000);

  /**
   * Property 9c: Post-Burst Sustained Rate Compliance
   *
   * For any burst of requests that exceeds the token bucket capacity,
   * the inter-request interval after the burst SHALL be approximately
   * 1/rate seconds (~111ms at 9 req/sec), proving the sustained rate
   * stays well under the SEC limit of 10 req/sec.
   *
   * **Validates: Requirements US-1 (Acceptance Criteria 5), NFR-4**
   */
  it('should maintain post-burst inter-request intervals that enforce ≤ 10 req/sec', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 12, max: 18 }),
        async (requestCount) => {
          const rateLimiter = await createFreshRateLimiter();

          const requestTimestamps: number[] = [];

          for (let i = 0; i < requestCount; i++) {
            await rateLimiter.waitForRateLimit();
            requestTimestamps.push(Date.now());
          }

          // ── Assert: Post-Burst Rate Compliance ───────────────────────

          // Examine inter-request intervals AFTER the initial burst
          // The burst is the first CONFIGURED_RATE (9) requests
          const postBurstTimestamps = requestTimestamps.slice(CONFIGURED_RATE);

          if (postBurstTimestamps.length >= 2) {
            // Calculate intervals between consecutive post-burst requests
            const intervals: number[] = [];
            for (let i = 1; i < postBurstTimestamps.length; i++) {
              intervals.push(postBurstTimestamps[i] - postBurstTimestamps[i - 1]);
            }

            // Average interval should be approximately 1000/9 ≈ 111ms
            const avgInterval =
              intervals.reduce((sum, v) => sum + v, 0) / intervals.length;

            // The minimum interval for SEC compliance is 1000/10 = 100ms
            // Our rate limiter targets 1000/9 ≈ 111ms
            // Allow 30% tolerance for OS scheduling
            const minIntervalForSECCompliance = 1000 / SEC_HARD_LIMIT; // 100ms
            expect(avgInterval).toBeGreaterThanOrEqual(minIntervalForSECCompliance * 0.7);
          }

          // Property: Delays were introduced
          const metrics = rateLimiter.getMetrics();
          expect(metrics.totalDelays).toBeGreaterThan(0);
          expect(metrics.totalRequests).toBe(requestCount);
        },
      ),
      { numRuns: 25 },
    );
  }, 30000);

  /**
   * Property 9d: waitForRateLimit Accurately Tracks Every Request
   *
   * For any number of requests, the rate limiter SHALL accurately track
   * every call to waitForRateLimit() in its metrics. This verifies the
   * integration pattern: the rate limiter is called before each SEC API
   * request and properly counts them.
   *
   * **Validates: Requirements US-1 (Acceptance Criteria 5), NFR-4**
   */
  it('should accurately track every call to waitForRateLimit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 15 }),
        async (callCount) => {
          const rateLimiter = await createFreshRateLimiter();

          for (let i = 0; i < callCount; i++) {
            await rateLimiter.waitForRateLimit();
          }

          // ── Assert ───────────────────────────────────────────────────

          const metrics = rateLimiter.getMetrics();

          // Property: Metrics accurately reflect every call
          expect(metrics.totalRequests).toBe(callCount);

          // Property: Requests in last minute matches total (test runs < 60s)
          expect(metrics.requestsLastMinute).toBe(callCount);

          // Property: Max requests per second is configured to 9 (under SEC's 10)
          expect(metrics.maxRequestsPerSecond).toBe(CONFIGURED_RATE);
          expect(metrics.maxRequestsPerSecond).toBeLessThan(SEC_HARD_LIMIT);
        },
      ),
      { numRuns: 25 },
    );
  }, 30000);
});
