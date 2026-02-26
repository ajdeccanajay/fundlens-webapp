/**
 * Unit tests for CallAnalysisPersistenceService
 */
import { CallAnalysisPersistenceService } from '../../src/documents/call-analysis-persistence.service';
import { EarningsCallResult } from '../../src/documents/earnings-call-extractor.service';

describe('CallAnalysisPersistenceService', () => {
  let service: CallAnalysisPersistenceService;
  let mockPrisma: any;

  const mockResult: EarningsCallResult = {
    callMetadata: {
      ticker: 'AAPL',
      quarter: 'Q1 2025',
      date: '2025-01-30',
      managementParticipants: ['Tim Cook', 'Luca Maestri'],
      analystParticipants: ['Analyst A'],
    },
    toneAnalysis: {
      overallConfidence: 7,
      confidenceRationale: 'Strong guidance with some hedging',
      topicsAvoided: ['China supply chain'],
    },
    guidanceSummary: {
      guidanceChanged: true,
      direction: 'raised',
      items: [{ metric: 'revenue', direction: 'up', detail: 'Raised Q2 guidance' }],
    },
    qaExchanges: [
      { analyst: 'Analyst A', question: 'Revenue outlook?', answer: 'Strong', topic: 'revenue' },
    ],
    allMetrics: [],
    redFlags: [],
    sections: [],
  };

  beforeEach(() => {
    mockPrisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'test-id-123' }]),
    };
    service = new CallAnalysisPersistenceService(mockPrisma);
  });

  it('should persist call analysis and return success with id', async () => {
    const result = await service.persist('doc-1', 'tenant-1', mockResult);
    expect(result.success).toBe(true);
    expect(result.id).toBe('test-id-123');
  });

  it('should delete existing analysis before inserting (idempotent)', async () => {
    await service.persist('doc-1', 'tenant-1', mockResult);
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM call_analysis'),
      'doc-1',
    );
  });

  it('should skip persistence when ticker is missing', async () => {
    const noTicker = { ...mockResult, callMetadata: { ...mockResult.callMetadata, ticker: '' } };
    const result = await service.persist('doc-1', 'tenant-1', noTicker);
    expect(result.success).toBe(false);
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('should uppercase the ticker', async () => {
    const lower = { ...mockResult, callMetadata: { ...mockResult.callMetadata, ticker: 'aapl' } };
    await service.persist('doc-1', 'tenant-1', lower);
    const insertCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
    expect(insertCall[3]).toBe('AAPL'); // ticker param
  });

  it('should calculate participant count correctly', async () => {
    await service.persist('doc-1', 'tenant-1', mockResult);
    const insertCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
    // 2 management + 1 analyst = 3
    expect(insertCall[14]).toBe(3);
  });

  it('should handle insert failure gracefully', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error('DB error'));
    const result = await service.persist('doc-1', 'tenant-1', mockResult);
    expect(result.success).toBe(false);
  });

  it('should pass Q&A exchange count', async () => {
    await service.persist('doc-1', 'tenant-1', mockResult);
    const insertCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
    expect(insertCall[15]).toBe(1); // 1 Q&A exchange
  });

  it('should serialize guidance items as JSON', async () => {
    await service.persist('doc-1', 'tenant-1', mockResult);
    const insertCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
    const guidanceItems = insertCall[10]; // guidance_items param
    expect(JSON.parse(guidanceItems)).toEqual(mockResult.guidanceSummary.items);
  });
});
