/**
 * Unit tests for DocumentFlagsPersistenceService
 */
import { DocumentFlagsPersistenceService, DocumentFlag } from '../../src/documents/document-flags-persistence.service';

describe('DocumentFlagsPersistenceService', () => {
  let service: DocumentFlagsPersistenceService;
  let mockPrisma: any;

  const sampleFlags: DocumentFlag[] = [
    { flagType: 'earnings_red_flag', severity: 'high', description: 'Revenue miss', evidence: 'Q1 revenue below guidance' },
    { flagType: 'going_concern', severity: 'medium', description: 'Auditor noted going concern' },
    { flagType: 'restatement', severity: 'low', description: 'Minor restatement of Q3 figures' },
  ];

  beforeEach(() => {
    mockPrisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    };
    service = new DocumentFlagsPersistenceService(mockPrisma);
  });

  it('should persist all flags and return count', async () => {
    const result = await service.persist('doc-1', 'tenant-1', 'AAPL', sampleFlags);
    expect(result.persisted).toBe(3);
  });

  it('should delete existing flags before inserting (idempotent)', async () => {
    await service.persist('doc-1', 'tenant-1', 'AAPL', sampleFlags);
    expect(mockPrisma.$executeRawUnsafe.mock.calls[0][0]).toContain('DELETE FROM document_flags');
  });

  it('should return 0 for empty flags array', async () => {
    const result = await service.persist('doc-1', 'tenant-1', 'AAPL', []);
    expect(result.persisted).toBe(0);
    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('should normalize severity: high → flag', async () => {
    await service.persist('doc-1', 'tenant-1', 'AAPL', [
      { flagType: 'test', severity: 'high', description: 'test' },
    ]);
    // First call is DELETE, second is INSERT
    const insertCall = mockPrisma.$executeRawUnsafe.mock.calls[1];
    expect(insertCall[5]).toBe('flag'); // normalized severity
  });

  it('should normalize severity: medium → watch', async () => {
    await service.persist('doc-1', 'tenant-1', null, [
      { flagType: 'test', severity: 'medium', description: 'test' },
    ]);
    const insertCall = mockPrisma.$executeRawUnsafe.mock.calls[1];
    expect(insertCall[5]).toBe('watch');
  });

  it('should normalize severity: low → info', async () => {
    await service.persist('doc-1', 'tenant-1', 'AAPL', [
      { flagType: 'test', severity: 'low', description: 'test' },
    ]);
    const insertCall = mockPrisma.$executeRawUnsafe.mock.calls[1];
    expect(insertCall[5]).toBe('info');
  });

  it('should pass through already-normalized severities', async () => {
    await service.persist('doc-1', 'tenant-1', 'AAPL', [
      { flagType: 'test', severity: 'watch', description: 'test' },
    ]);
    const insertCall = mockPrisma.$executeRawUnsafe.mock.calls[1];
    expect(insertCall[5]).toBe('watch');
  });

  it('should uppercase ticker', async () => {
    await service.persist('doc-1', 'tenant-1', 'aapl', [
      { flagType: 'test', severity: 'info', description: 'test' },
    ]);
    const insertCall = mockPrisma.$executeRawUnsafe.mock.calls[1];
    expect(insertCall[3]).toBe('AAPL');
  });

  it('should handle null ticker', async () => {
    await service.persist('doc-1', 'tenant-1', null, [
      { flagType: 'test', severity: 'info', description: 'test' },
    ]);
    const insertCall = mockPrisma.$executeRawUnsafe.mock.calls[1];
    expect(insertCall[3]).toBeNull();
  });

  it('should continue on individual insert failure', async () => {
    mockPrisma.$executeRawUnsafe
      .mockResolvedValueOnce(undefined) // DELETE
      .mockRejectedValueOnce(new Error('fail')) // first INSERT fails
      .mockResolvedValueOnce(undefined) // second INSERT succeeds
      .mockResolvedValueOnce(undefined); // third INSERT succeeds
    const result = await service.persist('doc-1', 'tenant-1', 'AAPL', sampleFlags);
    expect(result.persisted).toBe(2);
  });

  it('should handle complete failure gracefully', async () => {
    mockPrisma.$executeRawUnsafe.mockRejectedValue(new Error('DB down'));
    const result = await service.persist('doc-1', 'tenant-1', 'AAPL', sampleFlags);
    expect(result.persisted).toBe(0);
  });
});
