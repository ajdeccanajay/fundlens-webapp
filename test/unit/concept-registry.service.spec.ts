import { ConceptRegistryService } from '../../src/rag/metric-resolution/concept-registry.service';

// Mock S3 and filesystem
jest.mock('@aws-sdk/client-s3');
jest.mock('fs');
jest.mock('js-yaml');

describe('ConceptRegistryService', () => {
  let service: ConceptRegistryService;

  const mockConceptYaml = {
    leverage: {
      display_name: 'Leverage Analysis',
      description: 'Comprehensive view of debt levels',
      triggers: ['how levered', 'leverage', 'how much debt', 'debt load', 'gearing'],
      primary_metrics: {
        all: ['net_debt_to_ebitda', 'debt_to_equity', 'interest_coverage'],
        energy: ['net_debt_to_ebitda', 'debt_to_equity', 'interest_coverage'],
        private_equity: ['net_debt_to_ebitda', 'interest_coverage', 'leverage_at_entry'],
      },
      secondary_metrics: {
        all: ['total_debt', 'net_debt', 'debt_to_total_assets'],
        private_equity: ['equity_contribution'],
      },
      context_prompt: 'Summarize leverage discussion from filings.',
      presentation: { layout: 'profile', include_peer_comparison: true, include_historical_trend: true },
    },
    profitability: {
      display_name: 'Profitability Analysis',
      description: 'Margin profile and earnings quality',
      triggers: ['how profitable', 'profitability', 'margins', 'margin profile'],
      primary_metrics: {
        all: ['gross_margin_pct', 'operating_margin_pct', 'net_margin_pct', 'return_on_equity'],
        banking: ['return_on_average_equity', 'net_interest_margin', 'efficiency_ratio'],
      },
      secondary_metrics: {
        all: ['ebitda_margin_pct', 'return_on_assets'],
      },
      context_prompt: 'Summarize margin trends.',
      presentation: { layout: 'profile', include_peer_comparison: true, include_historical_trend: true },
    },
  };

  beforeEach(() => {
    process.env.USE_MOCK_S3 = 'true';

    const fsModule = require('fs');
    fsModule.existsSync = jest.fn().mockReturnValue(true);
    fsModule.readFileSync = jest.fn().mockReturnValue('mock yaml content');

    const yamlModule = require('js-yaml');
    yamlModule.load = jest.fn().mockReturnValue(mockConceptYaml);

    service = new ConceptRegistryService();
  });

  afterEach(() => {
    delete process.env.USE_MOCK_S3;
    jest.restoreAllMocks();
  });

  describe('after initialization', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should load all concepts', () => {
      expect(service.getAllConceptIds()).toEqual(['leverage', 'profitability']);
    });

    it('should get concept by ID', () => {
      const concept = service.getConceptById('leverage');
      expect(concept).toBeDefined();
      expect(concept!.display_name).toBe('Leverage Analysis');
      expect(concept!.triggers).toContain('how levered');
    });
  });

  describe('matchConcept', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should exact-match a trigger', () => {
      const match = service.matchConcept('leverage');
      expect(match).not.toBeNull();
      expect(match!.concept_id).toBe('leverage');
      expect(match!.confidence).toBe('exact');
    });

    it('should exact-match a multi-word trigger', () => {
      const match = service.matchConcept('how much debt');
      expect(match).not.toBeNull();
      expect(match!.concept_id).toBe('leverage');
      expect(match!.confidence).toBe('exact');
    });

    it('should match case-insensitively', () => {
      const match = service.matchConcept('How Profitable');
      expect(match).not.toBeNull();
      expect(match!.concept_id).toBe('profitability');
    });

    it('should match concept_id directly', () => {
      const match = service.matchConcept('profitability');
      expect(match).not.toBeNull();
      expect(match!.concept_id).toBe('profitability');
    });

    it('should match display_name', () => {
      const match = service.matchConcept('Leverage Analysis');
      expect(match).not.toBeNull();
      expect(match!.concept_id).toBe('leverage');
    });

    it('should return null for unrelated queries', () => {
      const match = service.matchConcept('what is the weather today');
      expect(match).toBeNull();
    });

    it('should return null for empty query', () => {
      const match = service.matchConcept('');
      expect(match).toBeNull();
    });
  });

  describe('getMetricBundle', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should return "all" metrics when no sector specified', () => {
      const bundle = service.getMetricBundle('leverage');
      expect(bundle).not.toBeNull();
      expect(bundle!.primary_metrics).toEqual(['net_debt_to_ebitda', 'debt_to_equity', 'interest_coverage']);
      expect(bundle!.secondary_metrics).toEqual(['total_debt', 'net_debt', 'debt_to_total_assets']);
    });

    it('should include sector-specific primary metrics', () => {
      const bundle = service.getMetricBundle('leverage', 'energy');
      expect(bundle).not.toBeNull();
      // energy has same metrics as all for leverage, so no new additions
      expect(bundle!.primary_metrics).toEqual(['net_debt_to_ebitda', 'debt_to_equity', 'interest_coverage']);
    });

    it('should include asset-class-specific metrics', () => {
      const bundle = service.getMetricBundle('leverage', undefined, 'private_equity');
      expect(bundle).not.toBeNull();
      // all + private_equity primary metrics, deduplicated
      expect(bundle!.primary_metrics).toContain('net_debt_to_ebitda');
      expect(bundle!.primary_metrics).toContain('interest_coverage');
      expect(bundle!.primary_metrics).toContain('leverage_at_entry');
      expect(bundle!.primary_metrics).toContain('debt_to_equity');
    });

    it('should deduplicate secondary metrics that appear in primary', () => {
      const bundle = service.getMetricBundle('leverage');
      expect(bundle).not.toBeNull();
      const primarySet = new Set(bundle!.primary_metrics);
      for (const sec of bundle!.secondary_metrics) {
        expect(primarySet.has(sec)).toBe(false);
      }
    });

    it('should include context_prompt and presentation', () => {
      const bundle = service.getMetricBundle('leverage');
      expect(bundle).not.toBeNull();
      expect(bundle!.context_prompt).toContain('leverage');
      expect(bundle!.presentation.layout).toBe('profile');
      expect(bundle!.presentation.include_peer_comparison).toBe(true);
    });

    it('should return null for unknown concept', () => {
      const bundle = service.getMetricBundle('nonexistent');
      expect(bundle).toBeNull();
    });

    it('should combine sector and asset class metrics', () => {
      const bundle = service.getMetricBundle('profitability', 'banking');
      expect(bundle).not.toBeNull();
      expect(bundle!.primary_metrics).toContain('gross_margin_pct');
      expect(bundle!.primary_metrics).toContain('return_on_average_equity');
      expect(bundle!.primary_metrics).toContain('net_interest_margin');
    });
  });
});
