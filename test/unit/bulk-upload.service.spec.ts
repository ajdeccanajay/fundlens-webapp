/**
 * Unit tests for BulkUploadService
 */
import { BulkUploadService, BulkUploadDocument, BulkUploadProgress } from '../../src/documents/bulk-upload.service';

describe('BulkUploadService', () => {
  let service: BulkUploadService;
  let mockPrisma: any;
  let mockEnrichment: any;

  const sampleDocs: BulkUploadDocument[] = [
    { documentId: 'doc-1', fileName: 'CIM.pdf', documentType: 'cim' },
    { documentId: 'doc-2', fileName: 'Model.xlsx', documentType: 'financial_model' },
    { documentId: 'doc-3', fileName: 'Presentation.pdf', documentType: 'management_presentation' },
    { documentId: 'doc-4', fileName: 'Transcript.pdf', documentType: 'earnings_transcript' },
    { documentId: 'doc-5', fileName: 'Misc.pdf', documentType: 'generic' },
    { documentId: 'doc-6', fileName: 'DD Report.pdf', documentType: 'due_diligence_report' },
  ];

  beforeEach(() => {
    mockPrisma = {};
    mockEnrichment = {
      enrichDocument: jest.fn().mockResolvedValue(undefined),
    };
    service = new BulkUploadService(mockPrisma, mockEnrichment);
  });

  it('should process all documents and return results', async () => {
    const result = await service.processBulk(sampleDocs, 'tenant-1', 'deal-1');
    expect(result.total).toBe(6);
    expect(result.succeeded).toBe(6);
    expect(result.failed).toBe(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('should prioritize CIM first, generic last', async () => {
    await service.processBulk(sampleDocs, 'tenant-1', 'deal-1');
    const calls = mockEnrichment.enrichDocument.mock.calls;
    // CIM should be first
    expect(calls[0][0]).toBe('doc-1');
    // Generic should be last
    const lastDocId = calls[calls.length - 1][0];
    expect(lastDocId).toBe('doc-5');
  });

  it('should process in batches of 5', async () => {
    // With 6 docs, should be 2 batches
    const progressUpdates: BulkUploadProgress[] = [];
    await service.processBulk(sampleDocs, 'tenant-1', 'deal-1', (p) => {
      progressUpdates.push({ ...p });
    });
    expect(progressUpdates.length).toBe(2);
    expect(progressUpdates[0].currentBatch).toBe(1);
    expect(progressUpdates[0].totalBatches).toBe(2);
    expect(progressUpdates[1].currentBatch).toBe(2);
  });

  it('should emit progress callbacks with ready and failed docs', async () => {
    mockEnrichment.enrichDocument
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('extraction failed'))
      .mockResolvedValueOnce(undefined);

    const progressUpdates: BulkUploadProgress[] = [];
    const result = await service.processBulk(sampleDocs, 'tenant-1', 'deal-1', (p) => {
      progressUpdates.push({ ...p, readyDocs: [...p.readyDocs], failedDocs: [...p.failedDocs] });
    });

    expect(result.succeeded).toBe(5);
    expect(result.failed).toBe(1);
  });

  it('should handle all documents failing', async () => {
    mockEnrichment.enrichDocument.mockRejectedValue(new Error('fail'));
    const result = await service.processBulk(
      [{ documentId: 'doc-1', fileName: 'a.pdf' }],
      'tenant-1', 'deal-1',
    );
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.documents[0].error).toBe('fail');
  });

  it('should handle empty document list', async () => {
    const result = await service.processBulk([], 'tenant-1', 'deal-1');
    expect(result.total).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(mockEnrichment.enrichDocument).not.toHaveBeenCalled();
  });

  it('should pass tenantId and dealId to enrichment', async () => {
    await service.processBulk(
      [{ documentId: 'doc-1', fileName: 'a.pdf' }],
      'tenant-abc', 'deal-xyz',
    );
    expect(mockEnrichment.enrichDocument).toHaveBeenCalledWith('doc-1', 'tenant-abc', 'deal-xyz');
  });

  it('should assign default priority to unknown document types', async () => {
    const docs: BulkUploadDocument[] = [
      { documentId: 'doc-1', fileName: 'unknown.pdf', documentType: 'unknown_type' },
      { documentId: 'doc-2', fileName: 'cim.pdf', documentType: 'cim' },
    ];
    await service.processBulk(docs, 'tenant-1', 'deal-1');
    // CIM should still be processed first
    expect(mockEnrichment.enrichDocument.mock.calls[0][0]).toBe('doc-2');
  });
});
