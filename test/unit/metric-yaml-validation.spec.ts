/**
 * Unit Tests: YAML Validation
 * 
 * Feature: metric-normalization-enhancement
 * Property 6: Data Preservation
 * 
 * Validates: Requirements BR-3.1 (Zero Data Loss)
 * 
 * Tests:
 * - All metrics from original YAMLs are preserved
 * - No duplicate metric IDs
 * - All synonyms are unique per metric
 * - All XBRL tags are valid format
 * - All required fields present
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

describe('Metric YAML Validation', () => {
  let enhancedYaml: any;
  let originalYaml1: any;
  let originalYaml2: any;

  beforeAll(() => {
    // Load YAML files
    const yamlPath1 = path.join(__dirname, '../../python_parser/xbrl_parsing/metric_mapping.yaml.backup');
    const yamlPath2 = path.join(__dirname, '../../python_parser/xbrl_parsing/metric_mapping_enhanced.yaml.backup');
    const enhancedPath = path.join(__dirname, '../../python_parser/xbrl_parsing/metric_mapping_enhanced.yaml');

    originalYaml1 = yaml.load(fs.readFileSync(yamlPath1, 'utf8'));
    originalYaml2 = yaml.load(fs.readFileSync(yamlPath2, 'utf8'));
    enhancedYaml = yaml.load(fs.readFileSync(enhancedPath, 'utf8'));
  });

  describe('Data Preservation (Property 6)', () => {
    it('should preserve all metrics from original metric_mapping.yaml', () => {
      const originalIds = new Set(originalYaml1.metrics.map((m: any) => m.id));
      const enhancedIds = new Set(enhancedYaml.metrics.map((m: any) => m.id));

      originalIds.forEach(id => {
        expect(enhancedIds.has(id)).toBe(true);
      });
    });

    it('should preserve all metrics from original metric_mapping_enhanced.yaml', () => {
      const originalIds = new Set(originalYaml2.metrics.map((m: any) => m.id));
      const enhancedIds = new Set(enhancedYaml.metrics.map((m: any) => m.id));

      originalIds.forEach(id => {
        expect(enhancedIds.has(id)).toBe(true);
      });
    });

    it('should preserve all original synonyms', () => {
      // Check yaml1 synonyms
      originalYaml1.metrics.forEach((originalMetric: any) => {
        const enhancedMetric = enhancedYaml.metrics.find((m: any) => m.id === originalMetric.id);
        expect(enhancedMetric).toBeDefined();

        if (originalMetric.synonyms) {
          const originalSynonyms = Array.isArray(originalMetric.synonyms)
            ? originalMetric.synonyms
            : (originalMetric.synonyms.primary || []);

          // Enhanced synonyms can be either array or object format
          const enhancedSynonyms = Array.isArray(enhancedMetric.synonyms)
            ? enhancedMetric.synonyms
            : (enhancedMetric.synonyms?.primary || []);

          originalSynonyms.forEach((syn: string) => {
            expect(enhancedSynonyms).toContain(syn);
          });
        }
      });

      // Check yaml2 synonyms
      originalYaml2.metrics.forEach((originalMetric: any) => {
        const enhancedMetric = enhancedYaml.metrics.find((m: any) => m.id === originalMetric.id);
        expect(enhancedMetric).toBeDefined();

        if (originalMetric.synonyms) {
          const originalSynonyms = Array.isArray(originalMetric.synonyms)
            ? originalMetric.synonyms
            : (originalMetric.synonyms.primary || []);

          // Enhanced synonyms can be either array or object format
          const enhancedSynonyms = Array.isArray(enhancedMetric.synonyms)
            ? enhancedMetric.synonyms
            : (enhancedMetric.synonyms?.primary || []);

          originalSynonyms.forEach((syn: string) => {
            expect(enhancedSynonyms).toContain(syn);
          });
        }
      });
    });
  });

  describe('Schema Validation', () => {
    it('should have no duplicate metric IDs', () => {
      const ids = enhancedYaml.metrics.map((m: any) => m.id);
      const uniqueIds = new Set(ids);

      expect(ids.length).toBe(uniqueIds.size);
    });

    it('should have all required fields for each metric', () => {
      enhancedYaml.metrics.forEach((metric: any) => {
        expect(metric.id).toBeDefined();
        expect(metric.name).toBeDefined();
        expect(metric.canonical_name || metric.name).toBeDefined();
        
        // statement_type is required for most metrics
        if (!['effective_tax_rate', 'arpu', 'combined_ratio', 'net_interest_margin'].includes(metric.id)) {
          expect(metric.statement_type).toBeDefined();
        }
      });
    });

    it('should have valid statement types', () => {
      const validTypes = ['income_statement', 'balance_sheet', 'cash_flow'];

      enhancedYaml.metrics.forEach((metric: any) => {
        if (metric.statement_type) {
          expect(validTypes).toContain(metric.statement_type);
        }
      });
    });

    it('should have valid period types', () => {
      const validPeriods = ['duration', 'instant', 'duration_ttm', 'multi_period_duration', 'duration_ttm_vs_instant'];

      enhancedYaml.metrics.forEach((metric: any) => {
        if (metric.period_type) {
          expect(validPeriods).toContain(metric.period_type);
        }
      });
    });

    it('should have unique synonyms per metric (case-insensitive)', () => {
      enhancedYaml.metrics.forEach((metric: any) => {
        if (metric.synonyms?.primary) {
          const lowerSynonyms = metric.synonyms.primary.map((s: string) => s.toLowerCase());
          const uniqueSynonyms = new Set(lowerSynonyms);

          if (lowerSynonyms.length !== uniqueSynonyms.size) {
            const duplicates = lowerSynonyms.filter((s: string, i: number) => 
              lowerSynonyms.indexOf(s) !== i
            );
            fail(`Metric ${metric.id} has duplicate synonyms: ${duplicates.join(', ')}`);
          }
        }
      });
    });

    it('should have valid XBRL tag format', () => {
      const xbrlTagPattern = /^[a-z-]+:[A-Z][A-Za-z0-9]+$/;

      enhancedYaml.metrics.forEach((metric: any) => {
        if (metric.taxonomy_tags?.us_gaap?.priority) {
          metric.taxonomy_tags.us_gaap.priority.forEach((tag: string) => {
            expect(tag).toMatch(xbrlTagPattern);
          });
        }

        if (metric.taxonomy_tags?.company_specific) {
          Object.values(metric.taxonomy_tags.company_specific).forEach((tags: any) => {
            if (Array.isArray(tags)) {
              tags.forEach((tag: string) => {
                expect(tag).toMatch(xbrlTagPattern);
              });
            }
          });
        }
      });
    });

    it('should have valid ticker symbols in company_specific tags', () => {
      const validTickers = /^[A-Z]{1,5}$/;

      enhancedYaml.metrics.forEach((metric: any) => {
        if (metric.taxonomy_tags?.company_specific) {
          Object.keys(metric.taxonomy_tags.company_specific).forEach((ticker: string) => {
            expect(ticker).toMatch(validTickers);
          });
        }
      });
    });

    it('should have valid industry names', () => {
      const validIndustries = [
        'technology', 'banking', 'insurance', 'healthcare', 'energy',
        'media', 'telecom', 'real_estate', 'utilities', 'retail', 'manufacturing',
        'saas', 'BANKS'
      ];

      enhancedYaml.metrics.forEach((metric: any) => {
        if (metric.synonyms?.industry_specific) {
          Object.keys(metric.synonyms.industry_specific).forEach((industry: string) => {
            expect(validIndustries).toContain(industry);
          });
        }

        if (metric.taxonomy_tags?.us_gaap?.by_industry) {
          Object.keys(metric.taxonomy_tags.us_gaap.by_industry).forEach((industry: string) => {
            expect(validIndustries).toContain(industry);
          });
        }
      });
    });
  });

  describe('Coverage Requirements', () => {
    it('should have at least 117 metrics (target from requirements)', () => {
      expect(enhancedYaml.metrics.length).toBeGreaterThanOrEqual(117);
    });

    it('should include all critical financial metrics', () => {
      const criticalMetrics = [
        'revenue', 'cost_of_revenue', 'gross_profit', 'operating_income',
        'net_income', 'ebitda', 'cash', 'total_assets', 'total_liabilities',
        'shareholders_equity', 'operating_cash_flow', 'capex', 'fcf',
        'eps_basic', 'eps_diluted', 'shares_outstanding'
      ];

      const metricIds = enhancedYaml.metrics.map((m: any) => m.id);

      criticalMetrics.forEach(id => {
        expect(metricIds).toContain(id);
      });
    });

    it('should have comprehensive synonyms for major metrics', () => {
      const majorMetrics = ['revenue', 'cost_of_revenue', 'net_income', 'cash'];

      majorMetrics.forEach(metricId => {
        const metric = enhancedYaml.metrics.find((m: any) => m.id === metricId);
        expect(metric).toBeDefined();
        expect(metric.synonyms?.primary?.length).toBeGreaterThan(3);
      });
    });

    it('should have industry-specific variations for key metrics', () => {
      const metric = enhancedYaml.metrics.find((m: any) => m.id === 'cost_of_revenue');
      expect(metric).toBeDefined();
      expect(metric.synonyms?.industry_specific).toBeDefined();
      expect(Object.keys(metric.synonyms.industry_specific).length).toBeGreaterThan(0);
    });

    it('should have company-specific XBRL tags for major companies', () => {
      const metric = enhancedYaml.metrics.find((m: any) => m.id === 'cost_of_revenue');
      expect(metric).toBeDefined();
      expect(metric.taxonomy_tags?.company_specific).toBeDefined();
      
      const companies = Object.keys(metric.taxonomy_tags.company_specific);
      expect(companies).toContain('AAPL');
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain the same YAML structure', () => {
      expect(enhancedYaml.conventions).toBeDefined();
      expect(enhancedYaml.frames).toBeDefined();
      expect(enhancedYaml.unit_candidates).toBeDefined();
      expect(enhancedYaml.metrics).toBeDefined();
      expect(Array.isArray(enhancedYaml.metrics)).toBe(true);
    });

    it('should have metrics sorted by ID', () => {
      const ids = enhancedYaml.metrics.map((m: any) => m.id);
      const sortedIds = [...ids].sort();

      expect(ids).toEqual(sortedIds);
    });
  });
});
