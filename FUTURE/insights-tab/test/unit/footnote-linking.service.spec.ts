import { Test, TestingModule } from '@nestjs/testing';
import { FootnoteLinkingService } from '../../src/deals/footnote-linking.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('FootnoteLinkingService', () => {
  let service: FootnoteLinkingService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FootnoteLinkingService,
        {
          provide: PrismaService,
          useValue: {
            footnoteReference: {
              upsert: jest.fn(),
              findMany: jest.fn()
            }
          }
        }
      ]
    }).compile();

    service = module.get<FootnoteLinkingService>(FootnoteLinkingService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extractFootnoteReferences', () => {
    it('should extract single footnote reference with parentheses', () => {
      const label = 'Revenue (1)';
      const refs = (service as any).extractFootnoteReferences(label);
      expect(refs).toEqual(['1']);
    });

    it('should extract multiple footnote references with parentheses', () => {
      const label = 'Net Income (2, 3)';
      const refs = (service as any).extractFootnoteReferences(label);
      expect(refs).toEqual(['2', '3']);
    });

    it('should extract footnote reference with brackets', () => {
      const label = 'Assets [1]';
      const refs = (service as any).extractFootnoteReferences(label);
      expect(refs).toEqual(['1']);
    });

    it('should extract footnote reference with superscript HTML', () => {
      const label = 'Revenue<sup>1</sup>';
      const refs = (service as any).extractFootnoteReferences(label);
      expect(refs).toEqual(['1']);
    });

    it('should handle multiple reference formats in same label', () => {
      const label = 'Revenue (1) and Assets [2]';
      const refs = (service as any).extractFootnoteReferences(label);
      expect(refs).toContain('1');
      expect(refs).toContain('2');
    });

    it('should return empty array for label without references', () => {
      const label = 'Revenue';
      const refs = (service as any).extractFootnoteReferences(label);
      expect(refs).toEqual([]);
    });

    it('should handle null or undefined label', () => {
      expect((service as any).extractFootnoteReferences(null)).toEqual([]);
      expect((service as any).extractFootnoteReferences(undefined)).toEqual([]);
    });

    it('should remove duplicate references', () => {
      const label = 'Revenue (1) and Cost (1)';
      const refs = (service as any).extractFootnoteReferences(label);
      expect(refs).toEqual(['1']);
    });
  });

  describe('findFootnoteByNumber', () => {
    it('should find footnote with "Note X" format', () => {
      const html = `
        Note 1 - Revenue Recognition
        
        The Company recognizes revenue when control transfers to the customer.
        
        Note 2 - Inventory
      `;
      const footnote = (service as any).findFootnoteByNumber(html, '1');
      expect(footnote).toBeDefined();
      expect(footnote.section).toBe('Revenue Recognition');
      expect(footnote.text).toContain('control transfers');
    });

    it('should find footnote with "(X)" format', () => {
      const html = `
        (1) Revenue Recognition
        
        The Company recognizes revenue when control transfers.
        
        (2) Inventory
      `;
      const footnote = (service as any).findFootnoteByNumber(html, '1');
      expect(footnote).toBeDefined();
      expect(footnote.section).toBe('Revenue Recognition');
    });

    it('should find footnote with "X." format', () => {
      const html = `
        1. Revenue Recognition
        
        The Company recognizes revenue when control transfers.
        
        2. Inventory
      `;
      const footnote = (service as any).findFootnoteByNumber(html, '1');
      expect(footnote).toBeDefined();
      expect(footnote.section).toBe('Revenue Recognition');
    });

    it('should return null for non-existent footnote', () => {
      const html = 'Note 1 - Revenue Recognition';
      const footnote = (service as any).findFootnoteByNumber(html, '99');
      expect(footnote).toBeNull();
    });

    it('should limit footnote text to 5000 characters', () => {
      const longText = 'A'.repeat(10000);
      const html = `Note 1 - Test\n${longText}`;
      const footnote = (service as any).findFootnoteByNumber(html, '1');
      expect(footnote).toBeDefined();
      expect(footnote.text.length).toBeLessThanOrEqual(5000);
    });
  });

  describe('classifyFootnote', () => {
    it('should classify as accounting_policy', () => {
      const text = 'The Company follows accounting policy for revenue recognition';
      const type = (service as any).classifyFootnote(text);
      expect(type).toBe('accounting_policy');
    });

    it('should classify as segment_breakdown', () => {
      const text = 'Revenue by geographic segment: Americas $100M, Europe $50M';
      const type = (service as any).classifyFootnote(text);
      expect(type).toBe('segment_breakdown');
    });

    it('should classify as reconciliation', () => {
      const text = 'Reconciliation of GAAP to non-GAAP measures';
      const type = (service as any).classifyFootnote(text);
      expect(type).toBe('reconciliation');
    });

    it('should classify as other for unrecognized content', () => {
      const text = 'Some other footnote content';
      const type = (service as any).classifyFootnote(text);
      expect(type).toBe('other');
    });

    it('should be case-insensitive', () => {
      const text = 'ACCOUNTING POLICY for revenue';
      const type = (service as any).classifyFootnote(text);
      expect(type).toBe('accounting_policy');
    });
  });

  describe('extractTableFromText', () => {
    it('should extract table with headers and rows', () => {
      const html = `
        <table>
          <tr><th>Region</th><th>Revenue</th></tr>
          <tr><td>Americas</td><td>$100M</td></tr>
          <tr><td>Europe</td><td>$50M</td></tr>
        </table>
      `;
      const table = (service as any).extractTableFromText(html);
      expect(table).toBeDefined();
      expect(table.type).toBe('table');
      expect(table.headers).toEqual(['Region', 'Revenue']);
      expect(table.rows).toHaveLength(2);
      expect(table.rows[0]).toEqual(['Americas', '$100M']);
    });

    it('should return null for text without table', () => {
      const text = 'Just some plain text';
      const table = (service as any).extractTableFromText(text);
      expect(table).toBeNull();
    });

    it('should handle table without headers', () => {
      const html = `
        <table>
          <tr><td>Americas</td><td>$100M</td></tr>
          <tr><td>Europe</td><td>$50M</td></tr>
        </table>
      `;
      const table = (service as any).extractTableFromText(html);
      expect(table).toBeDefined();
      expect(table.headers).toEqual([]);
      expect(table.rows).toHaveLength(2);
    });

    it('should strip HTML tags from cell content', () => {
      const html = `
        <table>
          <tr><td><b>Americas</b></td><td><i>$100M</i></td></tr>
        </table>
      `;
      const table = (service as any).extractTableFromText(html);
      expect(table).toBeDefined();
      expect(table.rows[0]).toEqual(['Americas', '$100M']);
    });
  });

  describe('extractListFromText', () => {
    it('should extract bullet point list', () => {
      const text = `
        • Item 1
        • Item 2
        • Item 3
      `;
      const list = (service as any).extractListFromText(text);
      expect(list).toBeDefined();
      expect(list.type).toBe('list');
      expect(list.data).toHaveLength(3);
      expect(list.data[0]).toBe('Item 1');
    });

    it('should extract numbered list', () => {
      const text = `
        1. First item
        2. Second item
        3. Third item
      `;
      const list = (service as any).extractListFromText(text);
      expect(list).toBeDefined();
      expect(list.type).toBe('list');
      expect(list.data).toHaveLength(3);
    });

    it('should extract list with dash bullets', () => {
      const text = `
        - Item 1
        - Item 2
      `;
      const list = (service as any).extractListFromText(text);
      expect(list).toBeDefined();
      expect(list.data).toHaveLength(2);
    });

    it('should return null for text without list', () => {
      const text = 'Just some plain text without any list markers';
      const list = (service as any).extractListFromText(text);
      expect(list).toBeNull();
    });
  });

  describe('linkFootnotesToMetrics', () => {
    it('should link footnotes to metrics', async () => {
      const dealId = 'deal-123';
      const metrics = [
        { id: 'metric-1', label: 'Revenue (1)', raw_label: 'Revenue (1)' },
        { id: 'metric-2', label: 'Net Income (2)', raw_label: 'Net Income (2)' }
      ];
      const html = `
        Note 1 - Revenue Recognition
        The Company recognizes revenue when control transfers.
        
        Note 2 - Income Taxes
        The Company accounts for income taxes under ASC 740.
      `;

      const references = await service.linkFootnotesToMetrics(dealId, metrics, html);

      expect(references).toHaveLength(2);
      expect(references[0].metricId).toBe('metric-1');
      expect(references[0].footnoteNumber).toBe('1');
      expect(references[0].footnoteSection).toBe('Revenue Recognition');
      expect(references[1].metricId).toBe('metric-2');
      expect(references[1].footnoteNumber).toBe('2');
    });

    it('should handle metrics without footnote references', async () => {
      const dealId = 'deal-123';
      const metrics = [
        { id: 'metric-1', label: 'Revenue', raw_label: 'Revenue' }
      ];
      const html = 'Note 1 - Revenue Recognition';

      const references = await service.linkFootnotesToMetrics(dealId, metrics, html);

      expect(references).toHaveLength(0);
    });

    it('should handle missing footnotes gracefully', async () => {
      const dealId = 'deal-123';
      const metrics = [
        { id: 'metric-1', label: 'Revenue (99)', raw_label: 'Revenue (99)' }
      ];
      const html = 'Note 1 - Revenue Recognition';

      const references = await service.linkFootnotesToMetrics(dealId, metrics, html);

      expect(references).toHaveLength(0);
    });

    it('should extract structured data from footnotes', async () => {
      const dealId = 'deal-123';
      const metrics = [
        { id: 'metric-1', label: 'Revenue (1)', raw_label: 'Revenue (1)' }
      ];
      const html = `
        Note 1 - Revenue by Segment
        <table>
          <tr><th>Segment</th><th>Revenue</th></tr>
          <tr><td>Americas</td><td>$100M</td></tr>
        </table>
      `;

      const references = await service.linkFootnotesToMetrics(dealId, metrics, html);

      expect(references).toHaveLength(1);
      expect(references[0].extractedData).toBeDefined();
      expect(references[0].extractedData.type).toBe('table');
    });

    it('should classify footnote types correctly', async () => {
      const dealId = 'deal-123';
      const metrics = [
        { id: 'metric-1', label: 'Revenue (1)', raw_label: 'Revenue (1)' }
      ];
      const html = `
        Note 1 - Revenue Recognition Policy
        The Company follows accounting policy for revenue recognition.
      `;

      const references = await service.linkFootnotesToMetrics(dealId, metrics, html);

      expect(references).toHaveLength(1);
      expect(references[0].contextType).toBe('accounting_policy');
    });
  });

  describe('saveFootnoteReferences', () => {
    it('should save footnote references (when migration ready)', async () => {
      const references = [
        {
          dealId: 'deal-123',
          metricId: 'metric-1',
          footnoteNumber: '1',
          footnoteSection: 'Revenue Recognition',
          footnoteText: 'The Company recognizes revenue...',
          contextType: 'accounting_policy' as const
        }
      ];

      // Should not throw error even though database table doesn't exist yet
      await expect(service.saveFootnoteReferences(references)).resolves.not.toThrow();
    });
  });

  describe('getFootnoteReferencesForMetric', () => {
    it('should return empty array until migration ready', async () => {
      const references = await service.getFootnoteReferencesForMetric('metric-1');
      expect(references).toEqual([]);
    });
  });

  describe('getFootnoteReferencesForDeal', () => {
    it('should return empty array until migration ready', async () => {
      const references = await service.getFootnoteReferencesForDeal('deal-123');
      expect(references).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty HTML content', async () => {
      const dealId = 'deal-123';
      const metrics = [
        { id: 'metric-1', label: 'Revenue (1)', raw_label: 'Revenue (1)' }
      ];
      const html = '';

      const references = await service.linkFootnotesToMetrics(dealId, metrics, html);
      expect(references).toHaveLength(0);
    });

    it('should handle empty metrics array', async () => {
      const dealId = 'deal-123';
      const metrics = [];
      const html = 'Note 1 - Revenue Recognition';

      const references = await service.linkFootnotesToMetrics(dealId, metrics, html);
      expect(references).toHaveLength(0);
    });

    it('should handle malformed HTML gracefully', async () => {
      const dealId = 'deal-123';
      const metrics = [
        { id: 'metric-1', label: 'Revenue (1)', raw_label: 'Revenue (1)' }
      ];
      const html = '<table><tr><td>Broken HTML';

      const references = await service.linkFootnotesToMetrics(dealId, metrics, html);
      // Should not throw, may or may not find references
      expect(Array.isArray(references)).toBe(true);
    });

    it('should handle very long footnote text', async () => {
      const dealId = 'deal-123';
      const metrics = [
        { id: 'metric-1', label: 'Revenue (1)', raw_label: 'Revenue (1)' }
      ];
      const longText = 'A'.repeat(10000);
      const html = `Note 1 - Revenue\n${longText}`;

      const references = await service.linkFootnotesToMetrics(dealId, metrics, html);
      expect(references).toHaveLength(1);
      expect(references[0].footnoteText.length).toBeLessThanOrEqual(5000);
    });
  });
});
