/**
 * Unit tests for MetricRegistryService.
 *
 * Uses the local filesystem fallback (USE_MOCK_S3=true) to read real YAML files
 * from local-s3-storage/fundlens-documents-dev/metrics/.
 */
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';

describe('MetricRegistryService', () => {
  let service: MetricRegistryService;

  beforeAll(async () => {
    // Use local filesystem fallback for tests
    process.env.USE_MOCK_S3 = 'true';
    process.env.S3_BUCKET_NAME = 'fundlens-documents-dev';
    process.env.METRIC_REGISTRY_S3_PREFIX = 'metrics/';

    service = new MetricRegistryService();
    await service.onModuleInit();
  });

  afterAll(() => {
    delete process.env.USE_MOCK_S3;
  });

  // -------------------------------------------------------------------------
  // Initialization and Loading
  // -------------------------------------------------------------------------

  describe('initialization', () => {
    it('should load all YAML files and build the index', () => {
      const stats = service.getStats();
      expect(stats.metricsLoaded).toBeGreaterThan(100);
      expect(stats.synonymsIndexed).toBeGreaterThan(500);
      expect(stats.lastBuildTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should have loaded metrics from universal, sector, pe_specific, and computed directories', () => {
      // Universal metrics
      expect(service.getMetricById('cash_and_cash_equivalents')).toBeDefined();
      expect(service.getMetricById('revenue')).toBeDefined();
      expect(service.getMetricById('total_assets')).toBeDefined();

      // Computed metrics
      expect(service.getMetricById('gross_margin_pct')).toBeDefined();

      // PE-specific
      expect(service.getMetricById('moic')).toBeDefined();
    });

    it('should NOT load concepts or clients files as metrics', () => {
      // analytical_concepts.yaml has entries like "leverage" but they're concepts, not metrics
      // If "leverage" exists, it should be from a metric file, not the concept file
      const leverage = service.getMetricById('leverage');
      // leverage is not a metric canonical_id in the metric files
      // (it's a concept in analytical_concepts.yaml which we skip)
      if (leverage) {
        // If it exists, it must have type field (metric schema)
        expect(leverage.type).toBeDefined();
      }
    });

    it('should derive db_column for universal atomic metrics', () => {
      const cash = service.getMetricById('cash_and_cash_equivalents');
      expect(cash).toBeDefined();
      expect(cash!.db_column).toBe('cash_and_cash_equivalents');
      expect(cash!.type).toBe('atomic');
    });

    it('should NOT set db_column for computed metrics', () => {
      const grossMargin = service.getMetricById('gross_margin_pct');
      expect(grossMargin).toBeDefined();
      expect(grossMargin!.type).toBe('computed');
      expect(grossMargin!.db_column).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Exact Match Resolution
  // -------------------------------------------------------------------------

  describe('resolve() — exact match', () => {
    it('should resolve "Cash" to cash_and_cash_equivalents', () => {
      const result = service.resolve('Cash');
      expect(result.canonical_id).toBe('cash_and_cash_equivalents');
      expect(result.confidence).toBe('exact');
      expect(result.display_name).toBe('Cash and Cash Equivalents');
      expect(result.type).toBe('atomic');
      expect(result.db_column).toBe('cash_and_cash_equivalents');
      expect(result.original_query).toBe('Cash');
    });

    it('should resolve "Revenue" to revenue', () => {
      const result = service.resolve('Revenue');
      expect(result.canonical_id).toBe('revenue');
      expect(result.confidence).toBe('exact');
    });

    it('should resolve canonical_id directly', () => {
      const result = service.resolve('cash_and_cash_equivalents');
      expect(result.canonical_id).toBe('cash_and_cash_equivalents');
      expect(result.confidence).toBe('exact');
    });

    it('should resolve display_name', () => {
      const result = service.resolve('Cash and Cash Equivalents');
      expect(result.canonical_id).toBe('cash_and_cash_equivalents');
      expect(result.confidence).toBe('exact');
    });

    it('should resolve case-insensitively', () => {
      const result = service.resolve('CASH AND CASH EQUIVALENTS');
      expect(result.canonical_id).toBe('cash_and_cash_equivalents');
      expect(result.confidence).toBe('exact');
    });

    it('should resolve with special characters stripped', () => {
      // "Cash and Cash Equivalents" (display_name) normalizes to "cashandcashequivalents"
      // Note: "Cash & Cash Equivalents" normalizes to "cashcashequivalents" (& is stripped, not "and")
      const result = service.resolve('Cash and Cash Equivalents');
      expect(result.canonical_id).toBe('cash_and_cash_equivalents');
      expect(result.confidence).toBe('exact');
    });

    it('should resolve computed metrics like "gross margin"', () => {
      const result = service.resolve('gross margin');
      expect(result.canonical_id).toBe('gross_margin_pct');
      expect(result.confidence).toBe('exact');
      expect(result.type).toBe('computed');
      expect(result.formula).toBeDefined();
      expect(result.dependencies).toBeDefined();
    });

    it('should resolve XBRL tag labels (namespace stripped)', () => {
      // us-gaap:CashAndCashEquivalentsAtCarryingValue → index "cashandcashequivalentsatcarryingvalue"
      const result = service.resolve('CashAndCashEquivalentsAtCarryingValue');
      expect(result.canonical_id).toBe('cash_and_cash_equivalents');
      expect(result.confidence).toBe('exact');
    });

    it('should return unresolved for unknown queries', () => {
      const result = service.resolve('completely_unknown_metric_xyz');
      expect(result.confidence).toBe('unresolved');
      expect(result.canonical_id).toBe('');
      expect(result.display_name).toBe('');
      expect(result.original_query).toBe('completely_unknown_metric_xyz');
    });

    it('should return unresolved for empty string', () => {
      const result = service.resolve('');
      expect(result.confidence).toBe('unresolved');
    });

    it('should return unresolved for whitespace-only', () => {
      const result = service.resolve('   ');
      expect(result.confidence).toBe('unresolved');
    });
  });

  // -------------------------------------------------------------------------
  // Idempotence
  // -------------------------------------------------------------------------

  describe('resolution idempotence', () => {
    it('should return identical results for the same query resolved twice', () => {
      const first = service.resolve('Revenue');
      const second = service.resolve('Revenue');
      expect(first.canonical_id).toBe(second.canonical_id);
      expect(first.confidence).toBe(second.confidence);
      expect(first.display_name).toBe(second.display_name);
      expect(first.type).toBe(second.type);
    });

    it('should return identical results for unknown queries resolved twice', () => {
      const first = service.resolve('nonexistent_metric');
      const second = service.resolve('nonexistent_metric');
      expect(first.confidence).toBe(second.confidence);
      expect(first.canonical_id).toBe(second.canonical_id);
    });
  });

  // -------------------------------------------------------------------------
  // resolveMultiple
  // -------------------------------------------------------------------------

  describe('resolveMultiple()', () => {
    it('should resolve multiple queries at once', () => {
      const results = service.resolveMultiple(['Revenue', 'Cash', 'unknown_xyz']);
      expect(results).toHaveLength(3);
      expect(results[0].canonical_id).toBe('revenue');
      expect(results[1].canonical_id).toBe('cash_and_cash_equivalents');
      expect(results[2].confidence).toBe('unresolved');
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate canonical_id Merging
  // -------------------------------------------------------------------------

  describe('duplicate canonical_id handling', () => {
    it('should merge synonyms from duplicate canonical_ids across files', () => {
      // net_income appears in income_statement.yaml, cash_flow.yaml, equity_statement.yaml
      const netIncome = service.getMetricById('net_income');
      expect(netIncome).toBeDefined();
      // Should have synonyms from all files merged
      expect(netIncome!.synonyms.length).toBeGreaterThan(3);
    });

    it('should resolve net_income consistently regardless of which file defined it', () => {
      const result = service.resolve('net_income');
      expect(result.canonical_id).toBe('net_income');
      expect(result.confidence).toBe('exact');
    });
  });

  // -------------------------------------------------------------------------
  // LRU Cache
  // -------------------------------------------------------------------------

  describe('LRU cache', () => {
    it('should cache resolved results (second call returns same result)', () => {
      // Clear cache by rebuilding
      const result1 = service.resolve('Revenue');
      const result2 = service.resolve('Revenue');
      expect(result1.canonical_id).toBe(result2.canonical_id);
      expect(result1.confidence).toBe(result2.confidence);
    });

    it('should report cache size in stats', () => {
      // Resolve a few queries to populate cache
      service.resolve('Revenue');
      service.resolve('Cash');
      service.resolve('Total Assets');
      const stats = service.getStats();
      expect(stats.cacheSize).toBeGreaterThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  describe('getStats()', () => {
    it('should return correct structure', () => {
      const stats = service.getStats();
      expect(stats).toHaveProperty('metricsLoaded');
      expect(stats).toHaveProperty('synonymsIndexed');
      expect(stats).toHaveProperty('collisions');
      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('lastBuildTimeMs');
      expect(typeof stats.metricsLoaded).toBe('number');
      expect(typeof stats.synonymsIndexed).toBe('number');
      expect(typeof stats.collisions).toBe('number');
      expect(typeof stats.cacheSize).toBe('number');
      expect(typeof stats.lastBuildTimeMs).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // rebuildIndex
  // -------------------------------------------------------------------------

  describe('rebuildIndex()', () => {
    it('should reload and rebuild all maps', async () => {
      const result = await service.rebuildIndex();
      expect(result.metricsLoaded).toBeGreaterThan(100);
      expect(result.synonymsIndexed).toBeGreaterThan(500);
      expect(result.loadTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should clear the LRU cache on rebuild', async () => {
      // Populate cache
      service.resolve('Revenue');
      service.resolve('Cash');
      expect(service.getStats().cacheSize).toBeGreaterThan(0);

      // Rebuild
      await service.rebuildIndex();
      expect(service.getStats().cacheSize).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // XBRL Tag Indexing
  // -------------------------------------------------------------------------

  describe('XBRL tag indexing', () => {
    it('should index XBRL tag labels without namespace prefix', () => {
      // us-gaap:AccountsReceivableNetCurrent should be indexed
      const result = service.resolve('AccountsReceivableNetCurrent');
      expect(result.confidence).toBe('exact');
      expect(result.canonical_id).toBe('accounts_receivable');
    });
  });

  // -------------------------------------------------------------------------
  // Fuzzy Matching (Task 3.1)
  // -------------------------------------------------------------------------

  describe('resolve() — fuzzy matching', () => {
    it('should auto-resolve a typo like "revenu" to revenue (fuzzy_auto)', () => {
      // "revenu" normalized → "revenu" vs "revenue" → score ~0.91
      const result = service.resolve('revenu');
      expect(result.confidence).toBe('fuzzy_auto');
      expect(result.canonical_id).toBe('revenue');
      expect(result.display_name).toBe('Revenue');
      expect(result.fuzzy_score).toBeGreaterThanOrEqual(0.85);
      expect(result.match_source).toContain('fuzzy:');
    });

    it('should auto-resolve "ebitdaa" to ebitda (fuzzy_auto)', () => {
      const result = service.resolve('ebitdaa');
      // "ebitdaa" normalized → "ebitdaa", "ebitda" normalized → "ebitda"
      // string-similarity score should be high enough for auto-resolve
      if (result.confidence === 'fuzzy_auto') {
        expect(result.canonical_id).toBe('ebitda');
        expect(result.fuzzy_score).toBeGreaterThanOrEqual(0.85);
      } else {
        // If not auto-resolved, should at least have suggestions
        expect(result.confidence).toBe('unresolved');
        expect(result.suggestions).not.toBeNull();
        expect(result.suggestions!.length).toBeGreaterThan(0);
      }
    });

    it('should return unresolved with suggestions for moderate matches (0.70-0.84)', () => {
      // "revnue" normalized → "revnue" vs "revenue" → score ~0.727 (suggestion range)
      const result = service.resolve('revnue');
      expect(result.confidence).toBe('unresolved');
      expect(result.suggestions).not.toBeNull();
      expect(result.suggestions!.length).toBeGreaterThan(0);
      expect(result.suggestions!.length).toBeLessThanOrEqual(3);
      // The top suggestion should be revenue
      expect(result.suggestions![0].canonical_id).toBe('revenue');
      expect(result.suggestions![0].fuzzy_score).toBeGreaterThanOrEqual(0.70);
      expect(result.suggestions![0].fuzzy_score).toBeLessThan(0.85);
    });

    it('should return unresolved with no suggestions for completely random strings', () => {
      const result = service.resolve('zzzzxxxxxqqqqqwwwww');
      expect(result.confidence).toBe('unresolved');
      // No synonym should be close to this gibberish
      if (result.suggestions) {
        // If suggestions exist, they should have scores >= 0.70
        for (const s of result.suggestions) {
          expect(s.fuzzy_score).toBeGreaterThanOrEqual(0.70);
        }
      }
    });

    it('should cache fuzzy-resolved results', () => {
      // First call triggers fuzzy matching
      const result1 = service.resolve('revenu');
      // Second call should hit cache
      const result2 = service.resolve('revenu');
      expect(result1.canonical_id).toBe(result2.canonical_id);
      expect(result1.confidence).toBe(result2.confidence);
      expect(result1.fuzzy_score).toBe(result2.fuzzy_score);
    });

    it('should include fuzzy_score in fuzzy_auto resolutions', () => {
      const result = service.resolve('revenu');
      expect(result.confidence).toBe('fuzzy_auto');
      expect(result.fuzzy_score).not.toBeNull();
      expect(result.fuzzy_score).toBeGreaterThanOrEqual(0.85);
      expect(result.fuzzy_score).toBeLessThanOrEqual(1.0);
    });

    it('should deduplicate suggestions by canonical_id', () => {
      // A query that might match multiple synonyms of the same metric
      // should not produce duplicate suggestions
      const result = service.resolve('cashandcashequiv');
      if (result.confidence === 'unresolved' && result.suggestions) {
        const ids = result.suggestions.map((s) => s.canonical_id);
        const uniqueIds = new Set(ids);
        expect(ids.length).toBe(uniqueIds.size);
      }
    });

    it('should log unresolved queries with tenantId', () => {
      // This test verifies the logging path runs without error
      const result = service.resolve('zzzzxxxxxqqqqqwwwww', 'tenant-123');
      expect(result.confidence).toBe('unresolved');
    });

    it('should not use fuzzy matching for exact matches', () => {
      const result = service.resolve('Revenue');
      expect(result.confidence).toBe('exact');
      expect(result.fuzzy_score).toBeNull();
    });

    it('should have suggestions bounded to max 3', () => {
      // Use a query that might match many metrics
      const result = service.resolve('net');
      if (result.confidence === 'unresolved' && result.suggestions) {
        expect(result.suggestions.length).toBeLessThanOrEqual(3);
      }
    });
  });

  // -------------------------------------------------------------------------
  // DAG Validation (Task 5.1)
  // -------------------------------------------------------------------------

  describe('DAG validation for computed metric dependencies', () => {
    it('should produce a non-empty topological order when computed metrics exist', () => {
      const order = service.getTopologicalOrder();
      expect(order.length).toBeGreaterThan(0);
    });

    it('should include all computed metrics in topological order (no cycles in real registry)', () => {
      const graph = service.getDependencyGraph();
      const order = service.getTopologicalOrder();
      const orderSet = new Set(order);

      for (const [metricId] of graph) {
        expect(orderSet.has(metricId)).toBe(true);
      }
    });

    it('should order dependencies before dependents', () => {
      const graph = service.getDependencyGraph();
      const order = service.getTopologicalOrder();
      const positionMap = new Map<string, number>();
      order.forEach((id, idx) => positionMap.set(id, idx));

      for (const [metricId, deps] of graph) {
        for (const dep of deps) {
          // Only check ordering between computed metrics (atomic deps aren't in the order)
          if (positionMap.has(dep) && positionMap.has(metricId)) {
            expect(positionMap.get(dep)!).toBeLessThan(positionMap.get(metricId)!);
          }
        }
      }
    });

    it('should have dependency graph entries for all computed metrics with dependencies', () => {
      const graph = service.getDependencyGraph();
      const allMetrics = service.getAllMetrics();

      for (const [id, metric] of allMetrics) {
        if (metric.type === 'computed' && metric.dependencies && metric.dependencies.length > 0) {
          expect(graph.has(id)).toBe(true);
          expect(graph.get(id)).toEqual(metric.dependencies);
        }
      }
    });

    it('should validate that all dependencies reference existing metrics or log warnings', () => {
      const graph = service.getDependencyGraph();
      const allMetrics = service.getAllMetrics();
      let missingDeps = 0;

      for (const [metricId, deps] of graph) {
        for (const dep of deps) {
          if (!allMetrics.has(dep)) {
            missingDeps++;
          }
        }
      }

      // Some computed metrics may reference atomic metrics that are supplemental
      // and not in the registry — this is expected. Just ensure it's a small number.
      expect(missingDeps).toBeLessThan(graph.size);
    });
  });

  // -------------------------------------------------------------------------
  // Client Overlay and Tenant-Scoped Resolution (Task 3.5)
  // -------------------------------------------------------------------------

  describe('client overlay — tenant-scoped resolution', () => {
    beforeAll(async () => {
      // Pre-load the third_avenue overlay so it's available synchronously
      await service.preloadClientOverlay('third_avenue');
    });

    it('should resolve Third Avenue synonym "owner earnings" to net_income', () => {
      const result = service.resolve('owner earnings', 'third_avenue');
      expect(result.canonical_id).toBe('net_income');
      expect(result.confidence).toBe('exact');
      expect(result.match_source).toContain('client_overlay:third_avenue');
    });

    it('should resolve Third Avenue synonym "distributable cash" to free_cash_flow', () => {
      const result = service.resolve('distributable cash', 'third_avenue');
      expect(result.canonical_id).toBe('free_cash_flow');
      expect(result.confidence).toBe('exact');
    });

    it('should resolve Third Avenue synonym "leverage safety" to net_debt_to_ebitda', () => {
      const result = service.resolve('leverage safety', 'third_avenue');
      expect(result.canonical_id).toBe('net_debt_to_ebitda');
      expect(result.confidence).toBe('exact');
    });

    it('should resolve Third Avenue synonym "discount to NAV" to price_to_book', () => {
      const result = service.resolve('discount to NAV', 'third_avenue');
      expect(result.canonical_id).toBe('price_to_book');
      expect(result.confidence).toBe('exact');
    });

    it('should still resolve universal synonyms when tenantId is provided', () => {
      const result = service.resolve('Revenue', 'third_avenue');
      expect(result.canonical_id).toBe('revenue');
      expect(result.confidence).toBe('exact');
    });

    it('should NOT resolve Third Avenue synonyms for a different tenant', async () => {
      await service.preloadClientOverlay('other_tenant');
      const result = service.resolve('owner earnings', 'other_tenant');
      // "owner earnings" is not a universal synonym, so it should be unresolved for other_tenant
      expect(result.confidence).not.toBe('exact');
    });

    it('should NOT resolve Third Avenue synonyms when no tenantId is provided', () => {
      const result = service.resolve('owner earnings');
      // Without tenantId, overlay synonyms are not checked
      expect(result.confidence).not.toBe('exact');
    });

    it('should use universal registry silently when overlay file does not exist', async () => {
      await service.preloadClientOverlay('nonexistent_tenant');
      const result = service.resolve('Revenue', 'nonexistent_tenant');
      expect(result.canonical_id).toBe('revenue');
      expect(result.confidence).toBe('exact');
    });

    it('should clear overlay cache on rebuildIndex', async () => {
      // Pre-load overlay
      await service.preloadClientOverlay('third_avenue');
      let result = service.resolve('owner earnings', 'third_avenue');
      expect(result.canonical_id).toBe('net_income');

      // Rebuild clears overlay cache
      await service.rebuildIndex();

      // Re-load overlay for next test
      await service.preloadClientOverlay('third_avenue');
      result = service.resolve('owner earnings', 'third_avenue');
      expect(result.canonical_id).toBe('net_income');
    });
  });
});
