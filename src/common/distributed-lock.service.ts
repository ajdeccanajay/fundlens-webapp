import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Distributed Lock Service using PostgreSQL Advisory Locks
 *
 * Prevents duplicate cron job execution across multiple ECS containers.
 * Uses pg_try_advisory_lock() which is non-blocking — if another instance
 * already holds the lock, this returns false immediately (no waiting).
 *
 * Lock IDs are stable integers derived from a string key via a simple hash.
 * Advisory locks are session-scoped and auto-release on disconnect.
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Try to acquire a lock. Returns true if acquired, false if another instance holds it.
   * The lock is held for the duration of the DB session (connection).
   */
  async tryAcquire(lockKey: string): Promise<boolean> {
    const lockId = this.hashKey(lockKey);
    try {
      const result = await this.prisma.$queryRaw<[{ pg_try_advisory_lock: boolean }]>`
        SELECT pg_try_advisory_lock(${lockId})
      `;
      const acquired = result[0]?.pg_try_advisory_lock === true;
      if (acquired) {
        this.logger.log(`Lock acquired: ${lockKey} (id=${lockId})`);
      } else {
        this.logger.log(`Lock already held by another instance: ${lockKey} (id=${lockId})`);
      }
      return acquired;
    } catch (error) {
      this.logger.error(`Failed to acquire lock ${lockKey}: ${error.message}`);
      return false;
    }
  }

  /**
   * Release a previously acquired lock.
   */
  async release(lockKey: string): Promise<void> {
    const lockId = this.hashKey(lockKey);
    try {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(${lockId})`;
      this.logger.log(`Lock released: ${lockKey} (id=${lockId})`);
    } catch (error) {
      this.logger.error(`Failed to release lock ${lockKey}: ${error.message}`);
    }
  }

  /**
   * Execute a callback while holding a distributed lock.
   * If the lock can't be acquired, the callback is skipped and null is returned.
   */
  async withLock<T>(lockKey: string, callback: () => Promise<T>): Promise<T | null> {
    const acquired = await this.tryAcquire(lockKey);
    if (!acquired) {
      this.logger.log(`Skipping ${lockKey} — another instance is running it`);
      return null;
    }

    try {
      return await callback();
    } finally {
      await this.release(lockKey);
    }
  }

  /**
   * Convert a string key to a stable 32-bit integer for pg_advisory_lock.
   * Uses a simple DJB2 hash — deterministic across all instances.
   */
  private hashKey(key: string): number {
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash + key.charCodeAt(i)) & 0x7fffffff;
    }
    return hash;
  }
}
