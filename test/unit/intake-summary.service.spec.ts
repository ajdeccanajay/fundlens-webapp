/**
 * Unit tests for IntakeSummaryService
 */
import { IntakeSummaryService, IntakeSummaryInput } from '../../src/documents/intake-summary.service';

describe('IntakeSummaryService', () => {
  let service: IntakeSummaryService;
  let mockPrisma: any;
  let mockBedrock: any;

  const baseInput: IntakeSummaryInput = {
    documentId: 'doc-1',
    tenantId: 'tenant-1',
    fileName: 'AAPL_10K_2024.pdf',
    documentType: '10-K',
    reportingEntity: 'Apple Inc.',
    ticker: 'AAPL',
    filingPeriod: 'FY2024',
    pageCount: 85,
    metricCount: 42,
    chunkCount: 24,
    topMetrics: [
      { name: 'net_sales', value: 383285, unit: 'USD millions', period: 'FY2024' },
      { name: 'net_income', value: 93736, unit: 'USD millions', period: 'FY2024' },
    ],
    notableItems: [
      { severity: 'watch', description: 'EU regulatory risk mentioned in risk factors' },
    ],
    sections: ['income_statement', 'balance_sheet', 'cash_flow', 'risk_factors'],
  };

  beforeEach(() => {
    mockPrisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    };
    mockBedrock = {
      invokeClaude: jest.fn().mockResolvedValue(
        "I've processed Apple Inc.'s 10-K filing for FY2024. Revenue came in at $383.3B with net income of $93.7B. " +
        "The filing flags EU regulatory risk as a notable concern. What would you like to explore?"
      ),
    };
    service = new IntakeSummaryService(mockPrisma, mockBedrock);
  });

  it('should generate summary via Bedrock and persist to DB', async () => {
    const summary = await service.generate(baseInput);
    expect(summary).toContain('Apple');
    expect(mockBedrock.invokeClaude).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE intel_documents SET intake_summary'),
      expect.any(String),
      'doc-1',
    );
  });

  it('should use Sonnet model', async () => {
    await service.generate(baseInput);
    const call = mockBedrock.invokeClaude.mock.calls[0][0];
    expect(call.modelId).toContain('sonnet');
  });

  it('should include top metrics in prompt', async () => {
    await service.generate(baseInput);
    const call = mockBedrock.invokeClaude.mock.calls[0][0];
    expect(call.prompt).toContain('net_sales');
    expect(call.prompt).toContain('383285');
  });

  it('should include notable items in prompt', async () => {
    await service.generate(baseInput);
    const call = mockBedrock.invokeClaude.mock.calls[0][0];
    expect(call.prompt).toContain('EU regulatory risk');
  });

  it('should fall back to simple summary when Bedrock fails', async () => {
    mockBedrock.invokeClaude.mockRejectedValue(new Error('Bedrock timeout'));
    const summary = await service.generate(baseInput);
    expect(summary).toContain('Apple Inc.');
    expect(summary).toContain('42 metrics');
    expect(summary).toContain('24 searchable sections');
    expect(summary).toContain('What would you like to explore?');
  });

  it('should persist fallback summary to DB even on Bedrock failure', async () => {
    mockBedrock.invokeClaude.mockRejectedValue(new Error('Bedrock timeout'));
    await service.generate(baseInput);
    // First call is the failed LLM persist attempt, second is fallback persist
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE intel_documents SET intake_summary'),
      expect.stringContaining('Apple Inc.'),
      'doc-1',
    );
  });

  it('should handle missing optional fields gracefully', async () => {
    const minimal: IntakeSummaryInput = {
      documentId: 'doc-2',
      tenantId: 'tenant-1',
      fileName: 'unknown.pdf',
      documentType: 'generic',
      metricCount: 0,
      chunkCount: 5,
    };
    mockBedrock.invokeClaude.mockRejectedValue(new Error('fail'));
    const summary = await service.generate(minimal);
    expect(summary).toContain('the company');
    expect(summary).toContain('0 metrics');
  });

  it('should trim whitespace from LLM response', async () => {
    mockBedrock.invokeClaude.mockResolvedValue('  Summary with spaces  \n');
    const summary = await service.generate(baseInput);
    expect(summary).toBe('Summary with spaces');
  });

  it('should set temperature to 0 for deterministic output', async () => {
    await service.generate(baseInput);
    const call = mockBedrock.invokeClaude.mock.calls[0][0];
    expect(call.temperature).toBe(0.0);
  });

  it('should include sections in prompt', async () => {
    await service.generate(baseInput);
    const call = mockBedrock.invokeClaude.mock.calls[0][0];
    expect(call.prompt).toContain('income_statement');
    expect(call.prompt).toContain('balance_sheet');
  });
});
