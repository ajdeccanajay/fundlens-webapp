/**
 * Property-Based Tests for MetricRegistryService.getSynonymsForDbColumn()
 *
 * Feature: rag-chatbot-master-engineering
 * Properties tested:
 * - Property 1: Synonym lookup completeness
 * - Property 2: Unknown canonical ID fallback
 *
 * Uses the local filesystem fallback (USE_MOCK_S3=true) to read real YAML files
 * from local-s3-storage/fundlens-documents-dev/metrics/.
 */

import * as fc from 'fast-check';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { MetricDefinition } from '../../src/rag/metric-resolution/types';

describe('Property Tests - Synonym Lookup', () => {
  let service: MetricRegistryService;
  let allMetrics: Map<string, MetricDefinition>;
  let canonicalIds: string[];

  beforeAll(async () => {
    process.env.USE_MOCK_S3 = 'true';
    process.env.S3_BUCKET_NAME = 'fundlens-documents-dev';
    process.env.METRIC_REGISTRY_S3_PREFIX = 'metrics/';

    service = new MetricRegistryService();
    await service.onModuleInit();

    allMetrics = service.getAllMetrics();
    canonicalIds = Array.from(allMetrics.keys());
  });

  afterAll(() => {
    delete process.env.USE_MOCK_S3;
  });

  describe('Property 1: Synonym lookup completeness', () => {
    /**
     * **Validates: Requirements 2.1, 2.2, 2.4**
     *
     * For any canonical metric ID that exists in the MetricRegistry,
     * calling getSynonymsForDbColumn(canonicalId) should return an array
     * containing the canonical_id, the db_column (if defined), and every
     * synonym from the YAML definition — with no normalization applied
     * to the synonym strings.
     */

    it('returned array always contains the canonical_id itself', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...canonicalIds),
          (canonicalId) => {
            const synonyms = service.getSynonymsForDbColumn(canonicalId);
            expect(synonyms).toContain(canonicalId);
          },
        ),
        { numRuns: Math.min(canonicalIds.length, 10) },
      );
    });

    it('returned array contains db_column when the metric definition has one', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...canonicalIds),
          (canonicalId) => {
            const definition = allMetrics.get(canonicalId)!;
            const synonyms = service.getSynonymsForDbColumn(canonicalId);

            if (definition.db_column) {
              expect(synonyms).toContain(definition.db_column);
            }
          },
        ),
        { numRuns: Math.min(canonicalIds.length, 10) },
      );
    });

    it('returned array contains every YAML synonym without normalization', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...canonicalIds),
          (canonicalId) => {
            const definition = allMetrics.get(canonicalId)!;
            const synonyms = service.getSynonymsForDbColumn(canonicalId);

            for (const yamlSynonym of definition.synonyms ?? []) {
              expect(synonyms).toContain(yamlSynonym);
            }
          },
        ),
        { numRuns: Math.min(canonicalIds.length, 10) },
      );
    });

    it('returned array contains no duplicates', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...canonicalIds),
          (canonicalId) => {
            const synonyms = service.getSynonymsForDbColumn(canonicalId);
            const uniqueSynonyms = new Set(synonyms);
            expect(synonyms.length).toBe(uniqueSynonyms.size);
          },
        ),
        { numRuns: Math.min(canonicalIds.length, 10) },
      );
    });

    it('returned array size equals unique count of canonical_id + db_column + YAML synonyms + storage-normalized forms', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...canonicalIds),
          (canonicalId) => {
            const definition = allMetrics.get(canonicalId)!;
            const synonyms = service.getSynonymsForDbColumn(canonicalId);

            // Build expected set the same way the implementation does
            const expected = new Set<string>();
            expected.add(canonicalId);
            if (definition.db_column) expected.add(definition.db_column);
            for (const syn of definition.synonyms ?? []) {
              expected.add(syn);
              // Storage-normalized form (same as IngestionValidationService.normalizeForStorage)
              const storageNormalized = syn
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '');
              if (storageNormalized) {
                expected.add(storageNormalized);
              }
            }

            expect(synonyms.length).toBe(expected.size);
          },
        ),
        { numRuns: Math.min(canonicalIds.length, 10) },
      );
    });
  });

  describe('Property 2: Unknown canonical ID fallback', () => {
    /**
     * **Validates: Requirements 2.3**
     *
     * For any string that does not match a canonical ID in the MetricRegistry,
     * calling getSynonymsForDbColumn(unknownId) should return an array
     * containing exactly that string.
     */

    it('returns [unknownId] for any string not in the registry', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }).filter(
            (s) => !allMetrics.has(s),
          ),
          (unknownId) => {
            const synonyms = service.getSynonymsForDbColumn(unknownId);
            expect(synonyms).toEqual([unknownId]);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('returns [unknownId] for random alphanumeric strings not in the registry', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-z0-9_]{5,30}$/).filter(
            (s) => !allMetrics.has(s),
          ),
          (unknownId) => {
            const synonyms = service.getSynonymsForDbColumn(unknownId);
            expect(synonyms).toHaveLength(1);
            expect(synonyms[0]).toBe(unknownId);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('returns exactly one element for unknown IDs', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'zzz_nonexistent_metric',
            'totally_fake_12345',
            'xyzzy_unknown',
            'not_a_real_metric_at_all',
            'gibberish_abc_def_ghi',
          ),
          (unknownId) => {
            const synonyms = service.getSynonymsForDbColumn(unknownId);
            expect(synonyms).toHaveLength(1);
            expect(synonyms[0]).toBe(unknownId);
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
