/**
 * Unit tests for UploadedDocKBSyncService
 */
import { UploadedDocKBSyncService } from '../../src/documents/uploaded-doc-kb-sync.service';

describe('UploadedDocKBSyncService', () => {
  let service: UploadedDocKBSyncService;
  let mockPrisma: any;
  let mockKBSync: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    };
    mockKBSync = {
      startIngestion: jest.fn().mockResolvedValue({ success: true, jobId: 'job-123' }),
      getIngestionStatus: jest.fn().mockResolvedValue({ status: 'COMPLETE' }),
    };
    service = new UploadedDocKBSyncService(mockPrisma, mockKBSync);
  });

  describe('processPending', () => {
    it('should return early when no pending documents', async () => {
      const result = await service.processPending();
      expect(result.processed).toBe(0);
      expect(result.synced).toBe(0);
      expect(mockKBSync.startIngestion).not.toHaveBeenCalled();
    });

    it('should trigger ingestion for pending documents', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { document_id: 'doc-1', tenant_id: 't-1', file_name: 'a.pdf', kb_sync_status: 'prepared' },
        { document_id: 'doc-2', tenant_id: 't-1', file_name: 'b.pdf', kb_sync_status: 'prepared' },
      ]);

      const result = await service.processPending();
      expect(result.processed).toBe(2);
      expect(result.synced).toBe(2);
      expect(mockKBSync.startIngestion).toHaveBeenCalledTimes(1);
    });

    it('should update documents to syncing status with job ID', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { document_id: 'doc-1', tenant_id: 't-1', file_name: 'a.pdf', kb_sync_status: 'prepared' },
      ]);

      await service.processPending();
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("kb_sync_status = 'syncing'"),
        'job-123',
        'doc-1',
      );
    });

    it('should set skippedInFlight when ingestion fails to start', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { document_id: 'doc-1', tenant_id: 't-1', file_name: 'a.pdf', kb_sync_status: 'prepared' },
      ]);
      mockKBSync.startIngestion.mockResolvedValue({ success: false, error: 'in-flight' });

      const result = await service.processPending();
      expect(result.skippedInFlight).toBe(true);
      expect(result.synced).toBe(0);
    });

    it('should handle ingestion trigger exception', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { document_id: 'doc-1', tenant_id: 't-1', file_name: 'a.pdf', kb_sync_status: 'prepared' },
      ]);
      mockKBSync.startIngestion.mockRejectedValue(new Error('AWS error'));

      const result = await service.processPending();
      expect(result.failed).toBe(1);
    });

    it('should limit to 20 documents per run', async () => {
      await service.processPending();
      const query = mockPrisma.$queryRawUnsafe.mock.calls[0][0];
      expect(query).toContain('LIMIT 20');
    });
  });

  describe('checkInFlightJobs', () => {
    it('should update completed jobs to indexed status', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { kb_ingestion_job_id: 'job-1' },
      ]);
      mockKBSync.getIngestionStatus.mockResolvedValue({ status: 'COMPLETE' });

      const result = await service.checkInFlightJobs();
      expect(result.completed).toBe(1);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("kb_sync_status = 'indexed'"),
        'job-1',
      );
    });

    it('should update failed jobs to sync_failed status', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { kb_ingestion_job_id: 'job-1' },
      ]);
      mockKBSync.getIngestionStatus.mockResolvedValue({ status: 'FAILED' });

      const result = await service.checkInFlightJobs();
      expect(result.failed).toBe(1);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("kb_sync_status = 'sync_failed'"),
        'job-1',
      );
    });

    it('should leave in-progress jobs as syncing', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { kb_ingestion_job_id: 'job-1' },
      ]);
      mockKBSync.getIngestionStatus.mockResolvedValue({ status: 'IN_PROGRESS' });

      const result = await service.checkInFlightJobs();
      expect(result.updated).toBe(1);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should handle status check failure gracefully', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { kb_ingestion_job_id: 'job-1' },
      ]);
      mockKBSync.getIngestionStatus.mockRejectedValue(new Error('timeout'));

      const result = await service.checkInFlightJobs();
      expect(result.updated).toBe(0);
    });
  });
});
