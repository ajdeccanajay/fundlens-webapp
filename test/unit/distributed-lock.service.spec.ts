import { Test, TestingModule } from '@nestjs/testing';
import { DistributedLockService } from '../../src/common/distributed-lock.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DistributedLockService', () => {
  let service: DistributedLockService;

  const mockPrismaService = {
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DistributedLockService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<DistributedLockService>(DistributedLockService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('tryAcquire', () => {
    it('should return true when lock is acquired', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ pg_try_advisory_lock: true }]);

      const result = await service.tryAcquire('test-lock');

      expect(result).toBe(true);
      expect(mockPrismaService.$queryRaw).toHaveBeenCalled();
    });

    it('should return false when lock is already held', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ pg_try_advisory_lock: false }]);

      const result = await service.tryAcquire('test-lock');

      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(new Error('Connection lost'));

      const result = await service.tryAcquire('test-lock');

      expect(result).toBe(false);
    });
  });

  describe('release', () => {
    it('should release the lock without error', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ pg_advisory_unlock: true }]);

      await expect(service.release('test-lock')).resolves.not.toThrow();
    });

    it('should not throw on release failure', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(new Error('Connection lost'));

      await expect(service.release('test-lock')).resolves.not.toThrow();
    });
  });

  describe('withLock', () => {
    it('should execute callback when lock is acquired', async () => {
      // First call: tryAcquire, second call: release
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
        .mockResolvedValueOnce([{ pg_advisory_unlock: true }]);

      const callback = jest.fn().mockResolvedValue('result');

      const result = await service.withLock('test-lock', callback);

      expect(result).toBe('result');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should return null and skip callback when lock is not acquired', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ pg_try_advisory_lock: false }]);

      const callback = jest.fn().mockResolvedValue('result');

      const result = await service.withLock('test-lock', callback);

      expect(result).toBeNull();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should release lock even if callback throws', async () => {
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
        .mockResolvedValueOnce([{ pg_advisory_unlock: true }]);

      const callback = jest.fn().mockRejectedValue(new Error('Callback failed'));

      await expect(service.withLock('test-lock', callback)).rejects.toThrow('Callback failed');

      // Release should still be called (2 $queryRaw calls total)
      expect(mockPrismaService.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('should produce consistent hash for same key', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ pg_try_advisory_lock: true }]);

      await service.tryAcquire('filing-detection-daily');
      const firstCall = mockPrismaService.$queryRaw.mock.calls[0];

      jest.clearAllMocks();
      mockPrismaService.$queryRaw.mockResolvedValue([{ pg_try_advisory_lock: true }]);

      await service.tryAcquire('filing-detection-daily');
      const secondCall = mockPrismaService.$queryRaw.mock.calls[0];

      // Both calls should use the same lock ID (same hash)
      expect(firstCall).toEqual(secondCall);
    });

    it('should produce different hashes for different keys', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ pg_try_advisory_lock: true }]);

      await service.tryAcquire('lock-a');
      const callA = mockPrismaService.$queryRaw.mock.calls[0];

      jest.clearAllMocks();
      mockPrismaService.$queryRaw.mockResolvedValue([{ pg_try_advisory_lock: true }]);

      await service.tryAcquire('lock-b');
      const callB = mockPrismaService.$queryRaw.mock.calls[0];

      // Different keys should produce different lock IDs
      expect(callA).not.toEqual(callB);
    });
  });
});
