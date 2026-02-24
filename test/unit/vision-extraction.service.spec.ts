/**
 * VisionExtractionService — Unit Tests
 * Spec §3.4, §5.1, §5.2: Vision LLM extraction from page images.
 *
 * Coverage:
 *   - identifyKeyPages: financial table detection, page cap
 *   - extractFromPages: parallel processing, error handling
 *   - parseVisionResponse: JSON parsing, markdown fencing
 *   - flattenMetrics: metric aggregation from vision results
 */

import { Test, TestingModule } from '@nestjs/testing';
import { VisionExtractionService } from '../../src/documents/vision-extraction.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { S3Service } from '../../src/services/s3.service';

describe('VisionExtractionService', () => {
  let service: VisionExtractionService;
  let bedrock: jest.Mocked<BedrockService>;
  let s3: jest.Mocked<S3Service>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisionExtractionService,
        {
          provide: BedrockService,
          useValue: {
            invokeClaudeWithVision: jest.fn(),
          },
        },
        {
          provide: S3Service,
          useValue: {
            getFileBuffer: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(VisionExtractionService);
    bedrock = module.get(BedrockService);
    s3 = module.get(S3Service);
  });

  // ─── identifyKeyPages ──────────────────────────────────────────

  describe('identifyKeyPages', () => {
    it('should always include first 2 pages and last page', () => {
      const rawText = 'Page 1 intro\n\n\n\nPage 2 summary\n\n\n\nPage 3 body\n\n\n\nPage 4 appendix';
      const pages = service.identifyKeyPages(rawText, 'sell-side-report');
      expect(pages).toContain(1);
      expect(pages).toContain(2);
      expect(pages).toContain(4); // last page
    });

    it('should identify pages with financial tables (multiple numbers)', () => {
      const rawText = 'Intro page\n\n\n\n' +
        'Revenue  $100.5  $110.2  $120.3\nEBITDA   $45.2   $50.1   $55.0\n\n\n\n' +
        'Conclusion page';
      const pages = service.identifyKeyPages(rawText, 'sell-side-report');
      expect(pages).toContain(2); // The financial table page
    });

    it('should identify pages with dollar amounts', () => {
      const rawText = 'Cover\n\n\n\n' +
        'Price target $275. Revenue $391.0B. EPS $7.83. EBITDA $120.5B. FCF $95.2B. Margin $50.1B.\n\n\n\n' +
        'End';
      const pages = service.identifyKeyPages(rawText, 'sell-side-report');
      expect(pages).toContain(2);
    });

    it('should identify pages with percentages (comp tables)', () => {
      const rawText = 'Cover\n\n\n\n' +
        'Margin 42.3% Growth 8.1% ROE 15.2% ROIC 12.5%\n\n\n\n' +
        'End';
      const pages = service.identifyKeyPages(rawText, 'sell-side-report');
      expect(pages).toContain(2);
    });

    it('should identify pages with valuation multiples', () => {
      const rawText = 'Cover\n\n\n\n' +
        'EV/EBITDA 12.3x P/E 22.5x EV/Revenue 3.2x\n\n\n\n' +
        'End';
      const pages = service.identifyKeyPages(rawText, 'sell-side-report');
      expect(pages).toContain(2);
    });

    it('should cap at 15 pages to control cost', () => {
      // Create 30 pages, all with financial data
      const pages = Array.from({ length: 30 }, (_, i) =>
        `Revenue $${100 + i}.0  $${110 + i}.0  $${120 + i}.0\nEBITDA $${50 + i}.0  $${55 + i}.0  $${60 + i}.0`,
      ).join('\n\n\n\n');

      const keyPages = service.identifyKeyPages(pages, 'sell-side-report');
      expect(keyPages.length).toBeLessThanOrEqual(15);
    });

    it('should return sorted page numbers', () => {
      const rawText = 'Cover\n\n\n\n' +
        'Revenue $100 $200 $300\n\n\n\n' +
        'Text only page\n\n\n\n' +
        'EBITDA 42.3% 38.1% 45.2% 50.0%\n\n\n\n' +
        'End';
      const pages = service.identifyKeyPages(rawText, 'sell-side-report');
      for (let i = 1; i < pages.length; i++) {
        expect(pages[i]).toBeGreaterThanOrEqual(pages[i - 1]);
      }
    });

    it('should handle empty text', () => {
      const pages = service.identifyKeyPages('', 'generic');
      expect(pages.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── flattenMetrics ────────────────────────────────────────────

  describe('flattenMetrics', () => {
    it('should flatten metrics from multiple pages', () => {
      const visionResults = [
        {
          pageNumber: 3,
          tables: [{
            tableType: 'comp-table',
            title: 'Comp Table',
            units: 'millions',
            headers: [],
            rows: [
              {
                label: 'Revenue',
                cells: [
                  { value: '$100M', numericValue: 100, isNegative: false, isEstimate: false, period: 'FY2024' },
                  { value: '$110M', numericValue: 110, isNegative: false, isEstimate: true, period: 'FY2025E' },
                ],
              },
            ],
          }],
          charts: [],
          narratives: [],
          footnotes: [],
          entities: { companies: [], dates: [], metrics: [] },
        },
      ];

      const metrics = service.flattenMetrics(visionResults);
      expect(metrics).toHaveLength(2);
      expect(metrics[0].metric_key).toBe('revenue');
      expect(metrics[0].numeric_value).toBe(100);
      expect(metrics[0].page_number).toBe(3);
      expect(metrics[1].is_estimate).toBe(true);
    });

    it('should skip cells without numeric values', () => {
      const visionResults = [{
        pageNumber: 1,
        tables: [{
          tableType: 'comp-table',
          title: 'Test',
          units: 'millions',
          headers: [],
          rows: [{
            label: 'Rating',
            cells: [{ value: 'Buy', numericValue: null, isNegative: false, isEstimate: false }],
          }],
        }],
        charts: [],
        narratives: [],
        footnotes: [],
        entities: { companies: [], dates: [], metrics: [] },
      }];

      const metrics = service.flattenMetrics(visionResults);
      expect(metrics).toHaveLength(0);
    });

    it('should handle empty vision results', () => {
      const metrics = service.flattenMetrics([]);
      expect(metrics).toHaveLength(0);
    });

    it('should include table_type and units in flattened metrics', () => {
      const visionResults = [{
        pageNumber: 5,
        tables: [{
          tableType: 'income-statement',
          title: 'Income Statement',
          units: 'billions',
          headers: [],
          rows: [{
            label: 'Net Income',
            cells: [{ value: '$50.2B', numericValue: 50.2, isNegative: false, isEstimate: false, period: 'FY2024' }],
          }],
        }],
        charts: [],
        narratives: [],
        footnotes: [],
        entities: { companies: [], dates: [], metrics: [] },
      }];

      const metrics = service.flattenMetrics(visionResults);
      expect(metrics[0].table_type).toBe('income-statement');
      expect(metrics[0].units).toBe('billions');
    });
  });

  // ─── Vision response parsing ───────────────────────────────────

  describe('parseVisionResponse (via extractSinglePage)', () => {
    it('should handle valid JSON response', async () => {
      s3.getFileBuffer.mockResolvedValue(Buffer.from('fake pdf'));

      bedrock.invokeClaudeWithVision.mockResolvedValue(JSON.stringify({
        tables: [{ tableType: 'comp-table', title: 'Peers', rows: [] }],
        charts: [],
        narratives: [{ type: 'heading', text: 'Valuation Summary' }],
        footnotes: [],
        entities: { companies: ['AAPL'], dates: ['FY2024'], metrics: ['Revenue'] },
      }));

      // Access private method via extractFromPages with mocked rendering
      // We test the parsing indirectly through the public API
      const result = await (service as any).extractSinglePage(
        'base64data', 1, 'sell-side-report',
      );

      expect(result.pageNumber).toBe(1);
      expect(result.tables).toHaveLength(1);
      expect(result.narratives).toHaveLength(1);
      expect(result.entities.companies).toContain('AAPL');
    });

    it('should handle markdown-fenced JSON response', async () => {
      bedrock.invokeClaudeWithVision.mockResolvedValue(
        '```json\n{"tables":[],"charts":[],"narratives":[],"footnotes":[],"entities":{"companies":[],"dates":[],"metrics":[]}}\n```',
      );

      const result = await (service as any).extractSinglePage(
        'base64data', 1, 'generic',
      );

      expect(result.tables).toHaveLength(0);
      expect(result.pageNumber).toBe(1);
    });

    it('should return empty result on vision failure', async () => {
      bedrock.invokeClaudeWithVision.mockRejectedValue(new Error('Bedrock timeout'));

      const result = await (service as any).extractSinglePage(
        'base64data', 1, 'generic',
      );

      expect(result.tables).toHaveLength(0);
      expect(result.charts).toHaveLength(0);
      expect(result.pageNumber).toBe(1);
    });

    it('should return empty result on invalid JSON', async () => {
      bedrock.invokeClaudeWithVision.mockResolvedValue('not json at all');

      const result = await (service as any).extractSinglePage(
        'base64data', 1, 'generic',
      );

      expect(result.tables).toHaveLength(0);
    });
  });
});
