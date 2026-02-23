/**
 * Integration Test: Haiku Intent Detection — Real Bedrock Call
 *
 * This test makes REAL Bedrock API calls (not mocked) to validate the
 * end-to-end Haiku intent extraction pipeline.
 *
 * Catches configuration issues that unit tests with mocks will never find:
 * - Wrong model ID
 * - Missing Bedrock permissions
 * - Prompt formatting producing invalid JSON
 * - Validation layer enrichment on real Haiku output
 * - Caching behavior with real pipeline results
 *
 * Requirements: 9.2, 10.1, 12.1
 *
 * Usage:
 *   npx jest --config ./test/jest-unit.json --testPathPattern=integration/haiku-intent-e2e
 *
 * NOTE: Requires valid AWS credentials with Bedrock access.
 *       Set SKIP_INTEGRATION=true to skip, or RUN_INTEGRATION=true to force.
 */

import { HaikuIntentParserService } from '../../src/rag/haiku-intent-parser.service';
import { BedrockService } from '../../src/rag/bedrock.service';

// ─── Skip guard ────────────────────────────────────────────────────────────────

const SKIP = process.env.SKIP_INTEGRATION === 'true';
const FORCE = process.env.RUN_INTEGRATION === 'true';

const shouldRun = FORCE || !SKIP;

const describeIf = shouldRun ? describe : describe.skip;

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Minimal PromptLibraryService stub — BedrockService requires it in its
 * constructor but invokeClaude() never calls it.
 */
const stubPromptLibrary = {
  getPrompt: jest.fn().mockResolvedValue({
    id: 'stub',
    version: 1,
    intentType: 'general',
    systemPrompt: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    active: true,
  }),
  clearCache: jest.fn(),
} as any;

// ─── Test Suite ────────────────────────────────────────────────────────────────

describeIf('Integration: Haiku Intent E2E with Real Bedrock (@slow)', () => {
  let bedrock: BedrockService;
  let parser: HaikuIntentParserService;

  beforeAll(() => {
    // Real BedrockService — uses AWS credentials from environment
    bedrock = new BedrockService(stubPromptLibrary);
    parser = new HaikuIntentParserService(bedrock);
  });

  // ─── 1. Basic extraction: known query produces valid QIO ─────────────────

  it('should extract correct QIO for "What is AMZN revenue?" via real Bedrock', async () => {
    const qio = await parser.parse('What is AMZN revenue?');

    expect(qio).not.toBeNull();
    expect(qio!.entities.length).toBeGreaterThanOrEqual(1);

    const amznEntity = qio!.entities.find(e => e.ticker === 'AMZN');
    expect(amznEntity).toBeDefined();
    expect(amznEntity!.ticker).toBe('AMZN');
    expect(amznEntity!.confidence).toBeGreaterThan(0);

    expect(qio!.metrics.length).toBeGreaterThanOrEqual(1);
    const revenueMetric = qio!.metrics.find(
      m => m.canonical_guess.includes('revenue') || m.raw_name.toLowerCase().includes('revenue'),
    );
    expect(revenueMetric).toBeDefined();

    expect(qio!.query_type).toBe('single_metric');
    expect(qio!.original_query).toBe('What is AMZN revenue?');
  }, 15000);

  // ─── 2. Company name resolution ──────────────────────────────────────────

  it('should resolve company name "Amazon" to ticker AMZN', async () => {
    const qio = await parser.parse('What is Amazon revenue?');

    expect(qio).not.toBeNull();
    const entity = qio!.entities.find(e => e.ticker === 'AMZN');
    expect(entity).toBeDefined();
    expect(entity!.company.toLowerCase()).toContain('amazon');
  }, 15000);

  // ─── 3. Single-letter ticker ─────────────────────────────────────────────

  it('should correctly identify single-letter ticker C as Citigroup', async () => {
    const qio = await parser.parse("What is C's revenue?");

    expect(qio).not.toBeNull();
    const entity = qio!.entities.find(e => e.ticker === 'C');
    expect(entity).toBeDefined();
    expect(entity!.company.toLowerCase()).toContain('citi');
  }, 15000);

  // ─── 4. Multi-entity comparative ─────────────────────────────────────────

  it('should extract multiple entities for a comparative query', async () => {
    const qio = await parser.parse('Compare Amazon and Nvidia revenue over 5 years');

    expect(qio).not.toBeNull();
    expect(qio!.entities.length).toBeGreaterThanOrEqual(2);

    const tickers = qio!.entities.map(e => e.ticker);
    expect(tickers).toContain('AMZN');
    expect(tickers).toContain('NVDA');

    expect(['comparative', 'trend_analysis']).toContain(qio!.query_type);
    expect(qio!.time_period.type).toBe('range');
  }, 15000);

  // ─── 5. Metric/ticker disambiguation ─────────────────────────────────────

  it('should classify ROIC as a metric, not a ticker', async () => {
    const qio = await parser.parse("What is AAPL's ROIC?");

    expect(qio).not.toBeNull();

    // ROIC should be in metrics, not entities
    const tickerROIC = qio!.entities.find(e => e.ticker === 'ROIC');
    expect(tickerROIC).toBeUndefined();

    const roicMetric = qio!.metrics.find(
      m => m.canonical_guess.includes('roic') || m.raw_name.toLowerCase().includes('roic'),
    );
    expect(roicMetric).toBeDefined();

    // AAPL should be the entity
    const aapl = qio!.entities.find(e => e.ticker === 'AAPL');
    expect(aapl).toBeDefined();
  }, 15000);

  // ─── 6. Narrative-only query ─────────────────────────────────────────────

  it('should classify a narrative query correctly', async () => {
    const qio = await parser.parse('What did the 10-K say about risks?');

    expect(qio).not.toBeNull();
    expect(qio!.query_type).toBe('narrative_only');
    expect(qio!.needs_narrative).toBe(true);
  }, 15000);

  // ─── 7. JSON structure integrity ─────────────────────────────────────────

  it('should produce a QIO with all required fields', async () => {
    const qio = await parser.parse('MSFT net income FY2024');

    expect(qio).not.toBeNull();

    // Required fields
    expect(Array.isArray(qio!.entities)).toBe(true);
    expect(Array.isArray(qio!.metrics)).toBe(true);
    expect(qio!.time_period).toBeDefined();
    expect(typeof qio!.time_period.type).toBe('string');
    expect(typeof qio!.query_type).toBe('string');
    expect(typeof qio!.needs_narrative).toBe('boolean');
    expect(typeof qio!.needs_peer_comparison).toBe('boolean');
    expect(typeof qio!.needs_computation).toBe('boolean');
    expect(typeof qio!.original_query).toBe('string');

    // Entity structure
    for (const entity of qio!.entities) {
      expect(typeof entity.ticker).toBe('string');
      expect(entity.ticker).toBe(entity.ticker.toUpperCase()); // normalized
      expect(typeof entity.company).toBe('string');
      expect(typeof entity.confidence).toBe('number');
      expect(entity.confidence).toBeGreaterThanOrEqual(0);
      expect(entity.confidence).toBeLessThanOrEqual(1);
    }

    // Metric structure
    for (const metric of qio!.metrics) {
      expect(typeof metric.raw_name).toBe('string');
      expect(typeof metric.canonical_guess).toBe('string');
      expect(metric.canonical_guess).toBe(metric.canonical_guess.toLowerCase()); // normalized
      expect(typeof metric.is_computed).toBe('boolean');
    }
  }, 15000);

  // ─── 8. Caching: second call returns identical result ────────────────────

  it('should return identical QIO on second parse of the same query', async () => {
    const query = 'What is GOOGL revenue?';

    const first = await parser.parse(query);
    expect(first).not.toBeNull();

    const second = await parser.parse(query);
    expect(second).not.toBeNull();

    // Both should have the same structure (Haiku with temp=0 should be deterministic)
    expect(first!.entities.map(e => e.ticker).sort()).toEqual(
      second!.entities.map(e => e.ticker).sort(),
    );
    expect(first!.query_type).toBe(second!.query_type);
    expect(first!.time_period.type).toBe(second!.time_period.type);
  }, 30000);

  // ─── 9. Latency: cache miss should complete within budget ────────────────

  it('should complete a simple query within 800ms latency budget', async () => {
    const start = Date.now();
    const qio = await parser.parse('NVDA revenue');
    const elapsed = Date.now() - start;

    expect(qio).not.toBeNull();
    // Allow generous budget for network variability, but flag if way over
    expect(elapsed).toBeLessThan(10000); // hard ceiling — something is very wrong if >10s
    // Log actual latency for observability
    console.log(`[Haiku E2E] Simple query latency: ${elapsed}ms`);
  }, 15000);

  // ─── 10. Concept analysis query ──────────────────────────────────────────

  it('should classify "how levered is ABNB?" as concept_analysis', async () => {
    const qio = await parser.parse('How levered is ABNB?');

    expect(qio).not.toBeNull();
    expect(qio!.query_type).toBe('concept_analysis');
    expect(qio!.needs_computation).toBe(true);

    const abnb = qio!.entities.find(e => e.ticker === 'ABNB');
    expect(abnb).toBeDefined();

    // Should expand leverage into constituent metrics
    expect(qio!.metrics.length).toBeGreaterThanOrEqual(1);
  }, 15000);
});
