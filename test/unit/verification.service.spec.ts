/**
 * VerificationService — Unit Tests
 * Spec §3.5: Deterministic verification of Vision LLM extractions against raw text.
 *
 * Coverage:
 *   - verifyExtractedNumber: exact match, scaled variants, currency, negatives
 *   - generateNumberCandidates: all format variants
 *   - verifyVisionExtractions: batch verification of metrics + tables
 *   - Edge cases: zero, very large numbers, percentages, multiples
 */

import { VerificationService } from '../../src/documents/verification.service';

describe('VerificationService', () => {
  let service: VerificationService;

  beforeEach(() => {
    service = new VerificationService();
  });

  // ─── verifyExtractedNumber ─────────────────────────────────────

  describe('verifyExtractedNumber', () => {
    it('should verify a number found exactly in raw text', () => {
      const result = service.verifyExtractedNumber(
        { value: 275, rawDisplay: '$275' },
        'The price target is $275 per share.',
      );
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should verify a number with comma formatting', () => {
      const result = service.verifyExtractedNumber(
        { value: 391000, rawDisplay: '391,000' },
        'Revenue was 391,000 million dollars.',
      );
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should verify a number in millions scale', () => {
      const result = service.verifyExtractedNumber(
        { value: 391000000000, rawDisplay: '$391.0B' },
        'Total revenue reached $391.0 billion in FY2024.',
        'billions',
      );
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should verify a percentage', () => {
      const result = service.verifyExtractedNumber(
        { value: 42.3, rawDisplay: '42.3%' },
        'EBITDA margin was 42.3% for the period.',
      );
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should verify a multiple (e.g., 12.3x)', () => {
      const result = service.verifyExtractedNumber(
        { value: 12.3, rawDisplay: '12.3x' },
        'EV/EBITDA multiple of 12.3x based on NTM estimates.',
      );
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should verify negative number in parentheses', () => {
      const result = service.verifyExtractedNumber(
        { value: -500, rawDisplay: '(500)' },
        'Net loss was (500) million for the quarter.',
      );
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should return confidence 0.7 when number not found', () => {
      const result = service.verifyExtractedNumber(
        { value: 999, rawDisplay: '$999' },
        'The report discusses Apple revenue growth.',
      );
      expect(result.verified).toBe(false);
      expect(result.confidence).toBe(0.7);
      expect(result.flag).toBe('NUMBER_NOT_IN_RAW_TEXT');
    });

    it('should verify via rawDisplay fallback', () => {
      const result = service.verifyExtractedNumber(
        { value: 7.83, rawDisplay: '$7.83' },
        'EPS estimate of $7.83 for FY2025.',
      );
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should handle zero value', () => {
      const result = service.verifyExtractedNumber(
        { value: 0, rawDisplay: '0' },
        'The adjustment was 0 for this period.',
      );
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should verify number with decimal in raw text', () => {
      const result = service.verifyExtractedNumber(
        { value: 412.5, rawDisplay: '412.5' },
        'Revenue forecast: $412.5B for FY2025E.',
      );
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });
  });

  // ─── generateNumberCandidates ──────────────────────────────────

  describe('generateNumberCandidates', () => {
    it('should generate basic format variants', () => {
      const candidates = service.generateNumberCandidates(275);
      expect(candidates).toContain('275');
      expect(candidates).toContain('275.0');
      expect(candidates).toContain('$275');
    });

    it('should generate millions-scaled variants for large numbers', () => {
      const candidates = service.generateNumberCandidates(391000000, 'millions');
      expect(candidates).toContain('391');
      expect(candidates).toContain('391.0');
    });

    it('should generate billions-scaled variants', () => {
      const candidates = service.generateNumberCandidates(391000000000, 'billions');
      expect(candidates).toContain('391');
      expect(candidates).toContain('391.0');
    });

    it('should include percentage and multiple suffixes', () => {
      const candidates = service.generateNumberCandidates(42.3);
      expect(candidates).toContain('42.3%');
      expect(candidates).toContain('42.3x');
    });

    it('should include negative indicators', () => {
      const candidates = service.generateNumberCandidates(-500);
      expect(candidates).toContain('(500)');
      expect(candidates).toContain('-500');
    });

    it('should include currency prefix', () => {
      const candidates = service.generateNumberCandidates(275);
      expect(candidates).toContain('$275');
      expect(candidates).toContain('$(275)');
    });
  });

  // ─── verifyVisionExtractions ───────────────────────────────────

  describe('verifyVisionExtractions', () => {
    const rawText = 'Revenue: $391.0B. Price target: $275. Rating: Overweight. EPS: $7.83. Margin: 42.3%.';

    it('should verify metrics with numeric values', () => {
      const result = service.verifyVisionExtractions(
        {
          metrics: [
            { numericValue: 275, rawValue: '$275', metric_key: 'price_target' },
            { numericValue: 7.83, rawValue: '$7.83', metric_key: 'eps' },
          ],
          tables: [],
          narratives: [],
          footnotes: [],
          entities: {},
        },
        rawText,
      );

      expect(result.metrics).toHaveLength(2);
      expect(result.metrics[0].verified).toBe(true);
      expect(result.metrics[0].confidence).toBe(1.0);
      expect(result.metrics[1].verified).toBe(true);
    });

    it('should verify non-numeric metrics via string match', () => {
      const result = service.verifyVisionExtractions(
        {
          metrics: [
            { numericValue: null, rawValue: 'Overweight', metric_key: 'rating' },
          ],
          tables: [],
          narratives: [],
          footnotes: [],
          entities: {},
        },
        rawText,
      );

      expect(result.metrics[0].verified).toBe(true);
      expect(result.metrics[0].confidence).toBe(1.0);
    });

    it('should flag metrics not found in raw text', () => {
      const result = service.verifyVisionExtractions(
        {
          metrics: [
            { numericValue: 999, rawValue: '$999', metric_key: 'phantom' },
          ],
          tables: [],
          narratives: [],
          footnotes: [],
          entities: {},
        },
        rawText,
      );

      expect(result.metrics[0].verified).toBe(false);
      expect(result.metrics[0].confidence).toBe(0.7);
    });

    it('should verify table cells', () => {
      const result = service.verifyVisionExtractions(
        {
          metrics: [],
          tables: [{
            tableType: 'comp-table',
            title: 'Comp Table',
            units: 'millions',
            rows: [{
              label: 'Revenue',
              cells: [
                { value: '275', numericValue: 275, isNegative: false, isEstimate: false },
              ],
            }],
          }],
          narratives: [],
          footnotes: [],
          entities: {},
        },
        rawText,
      );

      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].rows[0].cells[0].verified).toBe(true);
      expect(result.tables[0].rows[0].cells[0].confidence).toBe(1.0);
    });

    it('should pass through narratives and footnotes unchanged', () => {
      const result = service.verifyVisionExtractions(
        {
          metrics: [],
          tables: [],
          narratives: [{ type: 'paragraph', text: 'Some text' }],
          footnotes: [{ marker: '1', text: 'Footnote text' }],
          entities: { companies: ['AAPL'] },
        },
        rawText,
      );

      expect(result.narratives).toHaveLength(1);
      expect(result.footnotes).toHaveLength(1);
      expect(result.entities.companies).toContain('AAPL');
    });
  });
});
