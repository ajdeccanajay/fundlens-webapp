/**
 * VisionExtractionService — Unit Tests
 * Spec §3.4, §5.1, §5.2: Vision extraction via Bedrock Claude native PDF support.
 *
 * Coverage:
 *   - identifyKeyPages: financial table detection, page cap
 *   - extractFromPages: PDF splitting + Bedrock calls, error handling
 *   - parseBatchResponse: JSON parsing, markdown fencing, single-page fallback
 *   - flattenMetrics: metric aggregation from vision results
 */

import { Test, TestingModule } from '@nestjs/testing';
import { VisionExtractionService } from '../../src/documents/vision-extraction.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { S3Service } from '../../src/services/s3.service';
import { PDFDocument } from 'pdf-lib';

describe('VisionExtractionService', () => {
  let service: VisionExtractionService;
  let bedrock: jest.Mocked<BedrockService>;
  let s3: jest.Mocked<S3Service>;
  let realPdfBytes: Uint8Array;

  // Create a real minimal PDF for testing (pdf-lib is pure JS, fast)
  beforeAll(async () => {
    const doc = await PDFDocument.create();
    // Add 10 blank pages
    for (let i = 0; i < 10; i++) {
      doc.addPage([612, 792]); // Letter size
    }
    realPdfBytes = await doc.save();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisionExtractionService,
        {
          provide: BedrockService,
          useValue: {
            invokeClaudeWithDocument: jest.fn(),
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

    // Return real PDF bytes so pdf-lib can load them
    s3.getFileBuffer.mockResolvedValue(Buffer.from(realPdfBytes));
  });

  // ─── identifyKeyPages ──────────────────────────────────────────

  describe('identifyKeyPages', () => {
    it('should always include first 2 pages and last page', () => {
      const rawText = 'Page 1 intro\n\n\n\nPage 2 summary\n\n\n\nPage 3 body\n\n\n\nPage 4 appendix';
      const pages = service.identifyKeyPages(rawText, 'sell-side-report');
      expect(pages).toContain(1);
      expect(pages).toContain(2);
      expect(pages).toContain(4);
    });

    it('should identify pages with financial tables (multiple numbers)', () => {
      const rawText = 'Intro page\n\n\n\n' +
        'Revenue  $100.5  $110.2  $120.3\nEBITDA   $45.2   $50.1   $55.0\n\n\n\n' +
        'Conclusion page';
      const pages = service.identifyKeyPages(rawText, 'sell-side-report');
      expect(pages).toContain(2);
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
      const pages = Array.from({ length: 30 }, (_, i) =>
        `Revenue ${100 + i}.0  ${110 + i}.0  ${120 + i}.0\nEBITDA ${50 + i}.0  ${55 + i}.0  ${60 + i}.0`,
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

  // ─── extractFromPages (PDF-native via Bedrock) ─────────────────

  describe('extractFromPages', () => {
    it('should call invokeClaudeWithDocument with PDF bytes', async () => {
      bedrock.invokeClaudeWithDocument.mockResolvedValue(JSON.stringify({
        pages: [{
          original_page_number: 1,
          tables: [{ tableType: 'comp-table', title: 'Peers', rows: [], headers: [] }],
          charts: [],
          narratives: [{ type: 'heading', text: 'Valuation Summary' }],
          footnotes: [],
          entities: { companies: ['AAPL'], dates: ['FY2024'], metrics: ['Revenue'] },
        }],
      }));

      const results = await service.extractFromPages('test/doc.pdf', [1], 'sell-side-report');

      expect(bedrock.invokeClaudeWithDocument).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0].pageNumber).toBe(1);
      expect(results[0].tables).toHaveLength(1);
      expect(results[0].entities.companies).toContain('AAPL');
    });

    it('should batch pages in groups of 5', async () => {
      bedrock.invokeClaudeWithDocument.mockResolvedValue(JSON.stringify({
        pages: [
          { original_page_number: 1, tables: [], charts: [], narratives: [], footnotes: [], entities: { companies: [], dates: [], metrics: [] } },
        ],
      }));

      // 8 pages → 2 batches (5 + 3)
      await service.extractFromPages('test/doc.pdf', [1, 2, 3, 4, 5, 6, 7, 8], 'generic');

      expect(bedrock.invokeClaudeWithDocument).toHaveBeenCalledTimes(2);
    });

    it('should handle Bedrock failure gracefully and return empty', async () => {
      bedrock.invokeClaudeWithDocument.mockRejectedValue(new Error('Bedrock timeout'));

      const results = await service.extractFromPages('test/doc.pdf', [1, 2], 'generic');

      expect(results).toHaveLength(0);
    });

    it('should continue processing remaining batches if one fails', async () => {
      bedrock.invokeClaudeWithDocument
        .mockRejectedValueOnce(new Error('Batch 1 failed'))
        .mockResolvedValueOnce(JSON.stringify({
          pages: [
            { original_page_number: 6, tables: [], charts: [], narratives: [], footnotes: [], entities: { companies: [], dates: [], metrics: [] } },
          ],
        }));

      // 8 pages → 2 batches, first fails, second succeeds
      const results = await service.extractFromPages('test/doc.pdf', [1, 2, 3, 4, 5, 6, 7, 8], 'generic');

      expect(results).toHaveLength(1);
      expect(results[0].pageNumber).toBe(6);
    });

    it('should pass correct model ID and max_tokens', async () => {
      bedrock.invokeClaudeWithDocument.mockResolvedValue(JSON.stringify({
        pages: [{ original_page_number: 1, tables: [], charts: [], narratives: [], footnotes: [], entities: { companies: [], dates: [], metrics: [] } }],
      }));

      await service.extractFromPages('test/doc.pdf', [1], 'generic');

      expect(bedrock.invokeClaudeWithDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
          max_tokens: 8000,
        }),
      );
    });
  });

  // ─── parseBatchResponse (via extractFromPages) ─────────────────

  describe('parseBatchResponse', () => {
    it('should handle valid multi-page JSON response', async () => {
      bedrock.invokeClaudeWithDocument.mockResolvedValue(JSON.stringify({
        pages: [
          {
            original_page_number: 1,
            tables: [{ tableType: 'comp-table', title: 'Peers', rows: [], headers: [] }],
            charts: [],
            narratives: [],
            footnotes: [],
            entities: { companies: ['AAPL'], dates: [], metrics: [] },
          },
          {
            original_page_number: 3,
            tables: [],
            charts: [{ chartType: 'bar', title: 'Revenue Growth', dataPoints: [] }],
            narratives: [],
            footnotes: [],
            entities: { companies: [], dates: [], metrics: [] },
          },
        ],
      }));

      const results = await service.extractFromPages('test/doc.pdf', [1, 3], 'sell-side-report');

      expect(results).toHaveLength(2);
      expect(results[0].pageNumber).toBe(1);
      expect(results[0].tables).toHaveLength(1);
      expect(results[1].pageNumber).toBe(3);
      expect(results[1].charts).toHaveLength(1);
    });

    it('should handle markdown-fenced JSON response', async () => {
      bedrock.invokeClaudeWithDocument.mockResolvedValue(
        '```json\n{"pages":[{"original_page_number":1,"tables":[],"charts":[],"narratives":[],"footnotes":[],"entities":{"companies":[],"dates":[],"metrics":[]}}]}\n```',
      );

      const results = await service.extractFromPages('test/doc.pdf', [1], 'generic');

      expect(results).toHaveLength(1);
      expect(results[0].pageNumber).toBe(1);
    });

    it('should handle single-page response without pages wrapper', async () => {
      bedrock.invokeClaudeWithDocument.mockResolvedValue(JSON.stringify({
        tables: [{ tableType: 'income-statement', title: 'IS', rows: [], headers: [] }],
        charts: [],
        narratives: [],
        footnotes: [],
        entities: { companies: [], dates: [], metrics: [] },
      }));

      const results = await service.extractFromPages('test/doc.pdf', [5], 'generic');

      expect(results).toHaveLength(1);
      expect(results[0].pageNumber).toBe(5);
      expect(results[0].tables).toHaveLength(1);
    });

    it('should return empty on invalid JSON', async () => {
      bedrock.invokeClaudeWithDocument.mockResolvedValue('not json at all');

      const results = await service.extractFromPages('test/doc.pdf', [1], 'generic');

      expect(results).toHaveLength(0);
    });
  });
});
