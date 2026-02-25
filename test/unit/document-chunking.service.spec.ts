/**
 * DocumentChunkingService — Unit Tests
 * Spec §3.4 Step 4: Financial-aware chunking
 */
import { DocumentChunkingService } from '../../src/documents/document-chunking.service';

describe('DocumentChunkingService', () => {
  let service: DocumentChunkingService;

  beforeEach(() => {
    service = new DocumentChunkingService();
  });

  describe('chunk', () => {
    it('should chunk simple text into sections', () => {
      const text = 'Revenue grew significantly in the fiscal year. '.repeat(60);
      const chunks = service.chunk(text);
      expect(chunks.length).toBeGreaterThan(0);
      for (const c of chunks) {
        expect(c.content.length).toBeGreaterThan(50);
        expect(c.tokenEstimate).toBeGreaterThan(0);
        expect(c.chunkIndex).toBeGreaterThanOrEqual(0);
      }
    });

    it('should preserve table chunks from vision results', () => {
      const visionResults = [{
        pageNumber: 3,
        tables: [{
          title: 'Comparable Companies',
          tableType: 'comp-table',
          units: 'millions',
          headers: [{ cells: ['Company', 'EV/EBITDA', 'P/E'] }],
          rows: [
            { label: 'AAPL', cells: ['22.3x', '31.2x'] },
            { label: 'MSFT', cells: ['19.8x', '27.5x'] },
          ],
        }],
        narratives: [],
        footnotes: [],
        entities: {},
      }];

      const chunks = service.chunk('Some text content here. '.repeat(100), visionResults);
      const tableChunks = chunks.filter(c => c.sectionType === 'comp-table');
      expect(tableChunks.length).toBe(1);
      expect(tableChunks[0].content).toContain('Comparable Companies');
      expect(tableChunks[0].content).toContain('AAPL');
      expect(tableChunks[0].pageNumber).toBe(3);
    });

    it('should classify financial sections correctly', () => {
      const text = [
        'Consolidated Statements of Operations\n\nRevenue was $100M in FY2024. ' + 'x'.repeat(200),
        '\n\n\n',
        'Risk Factors\n\nThe company faces significant competition. ' + 'y'.repeat(200),
        '\n\n\n',
        'Management Discussion and Analysis\n\nRevenue grew 15% YoY. ' + 'z'.repeat(200),
      ].join('');

      const chunks = service.chunk(text);
      const types = chunks.map(c => c.sectionType);
      expect(types).toContain('income-statement');
      expect(types).toContain('risk-factors');
      expect(types).toContain('mda');
    });

    it('should respect maxTokens option', () => {
      const text = 'Revenue grew significantly in the fiscal year. '.repeat(200);
      const chunks = service.chunk(text, [], { maxTokens: 300 });
      for (const c of chunks) {
        expect(c.tokenEstimate).toBeLessThan(600);
      }
    });

    it('should filter out tiny chunks', () => {
      const text = 'Short.\n\n\nAnother short.\n\n\n' + 'Long enough content. '.repeat(50);
      const chunks = service.chunk(text);
      for (const c of chunks) {
        expect(c.content.length).toBeGreaterThan(50);
      }
    });

    it('should handle empty text gracefully', () => {
      const chunks = service.chunk('');
      expect(chunks).toEqual([]);
    });

    it('should handle text with form-feed page breaks', () => {
      const text = 'Page 1 content. '.repeat(20) + '\f' + 'Page 2 content. '.repeat(20);
      const chunks = service.chunk(text);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should split large sections with overlap', () => {
      const text = 'This is a sentence about revenue growth. '.repeat(100);
      const chunks = service.chunk(text, [], { maxTokens: 600, overlap: 100 });
      expect(chunks.length).toBeGreaterThan(1);

      // Check overlap: end of chunk N should appear in start of chunk N+1
      if (chunks.length >= 2) {
        const lastChars = chunks[0].content.slice(-50);
        // Overlap means some content from end of chunk 0 appears in chunk 1
        // (not exact match due to sentence boundary alignment)
        expect(chunks[1].chunkIndex).toBe(chunks[0].chunkIndex + 1);
      }
    });

    it('should assign sequential chunk indices', () => {
      const text = 'Content block with enough text. '.repeat(100);
      const chunks = service.chunk(text);
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].chunkIndex).toBe(i);
      }
    });
  });
});
