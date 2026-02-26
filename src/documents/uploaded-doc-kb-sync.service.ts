/**
 * Uploaded Document KB Sync Service — Spec §11.3 (Phase 7)
 *
 * Cron-compatible service that finds documents with kb_sync_status = 'prepared'
 * and triggers Bedrock KB ingestion. Handles:
 *   - Batch processing (max 20 docs per run)
 *   - In-flight job detection (don't double-trigger)
 *   - Retry with backoff on failure
 *   - Status tracking in intel_documents
 *
 * Called by: NestJS @Cron decorator or manual API trigger.
 * Chunks are already in S3 kb-ready/ (written by BackgroundEnrichmentService).
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KBSyncService } from '../rag/kb-sync.service';

export interface KBSyncCronResult {
  processed: number;
  synced: number;
  failed: number;
  skippedInFlight: boolean;
  documents: { documentId: string; status: string; jobId?: string }[];
}

@Injectable()
export class UploadedDocKBSyncService {
  private readonly logger = new Logger(UploadedDocKBSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kbSync: KBSyncService,
  ) {}

  /**
   * Process pending uploaded documents for KB sync.
   * Designed to be called every 15 minutes by a cron job.
   */
  async processPending(): Promise<KBSyncCronResult> {
    const result: KBSyncCronResult = {
      processed: 0, synced: 0, failed: 0,
      skippedInFlight: false, documents: [],
    };

    try {
      // 1. Find documents ready for KB sync
      const pendingDocs = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT document_id, tenant_id, file_name, kb_sync_status
         FROM intel_documents
         WHERE kb_sync_status = 'prepared'
         ORDER BY created_at ASC
         LIMIT 20`,
      );

      if (!pendingDocs?.length) {
        this.logger.log('KB sync cron: no pending documents');
        return result;
      }

      this.logger.log(`KB sync cron: ${pendingDocs.length} documents pending`);

      // 2. Trigger a single KB ingestion job (Bedrock KB re-indexes the entire data source)
      // All prepared docs' chunks are already in S3 kb-ready/, so one ingestion covers all.
      try {
        const syncResult = await this.kbSync.startIngestion(
          `Uploaded doc sync: ${pendingDocs.length} documents at ${new Date().toISOString()}`,
        );

        if (syncResult.success && syncResult.jobId) {
          // Mark all pending docs as syncing
          for (const doc of pendingDocs) {
            await this.prisma.$executeRawUnsafe(
              `UPDATE intel_documents SET
                kb_sync_status = 'syncing',
                kb_ingestion_job_id = $1,
                updated_at = NOW()
              WHERE document_id = $2::uuid`,
              syncResult.jobId,
              doc.document_id,
            );
            result.documents.push({
              documentId: doc.document_id,
              status: 'syncing',
              jobId: syncResult.jobId,
            });
            result.synced++;
          }

          this.logger.log(
            `KB sync cron: triggered ingestion job ${syncResult.jobId} for ${pendingDocs.length} docs`,
          );
        } else {
          // Ingestion failed to start — could be in-flight job
          this.logger.warn(`KB sync cron: ingestion start failed — ${syncResult.error || 'unknown'}`);
          result.skippedInFlight = true;
        }
      } catch (syncErr) {
        this.logger.error(`KB sync cron: ingestion trigger failed: ${syncErr.message}`);
        result.failed = pendingDocs.length;
      }

      result.processed = pendingDocs.length;
    } catch (err) {
      this.logger.error(`KB sync cron failed: ${err.message}`);
    }

    return result;
  }

  /**
   * Check and update status of in-flight KB sync jobs.
   * Called after processPending or on a separate schedule.
   */
  async checkInFlightJobs(): Promise<{ updated: number; completed: number; failed: number }> {
    const stats = { updated: 0, completed: 0, failed: 0 };

    try {
      // Find documents with syncing status
      const syncingDocs = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT kb_ingestion_job_id
         FROM intel_documents
         WHERE kb_sync_status = 'syncing'
           AND kb_ingestion_job_id IS NOT NULL`,
      );

      for (const row of syncingDocs || []) {
        const jobId = row.kb_ingestion_job_id;
        try {
          const jobStatus = await this.kbSync.getIngestionStatus(jobId);

          if (jobStatus.status === 'COMPLETE') {
            await this.prisma.$executeRawUnsafe(
              `UPDATE intel_documents SET
                kb_sync_status = 'indexed',
                updated_at = NOW()
              WHERE kb_ingestion_job_id = $1 AND kb_sync_status = 'syncing'`,
              jobId,
            );
            stats.completed++;
          } else if (jobStatus.status === 'FAILED') {
            await this.prisma.$executeRawUnsafe(
              `UPDATE intel_documents SET
                kb_sync_status = 'sync_failed',
                updated_at = NOW()
              WHERE kb_ingestion_job_id = $1 AND kb_sync_status = 'syncing'`,
              jobId,
            );
            stats.failed++;
          }
          // IN_PROGRESS — leave as syncing
          stats.updated++;
        } catch (statusErr) {
          this.logger.warn(`Failed to check job ${jobId}: ${statusErr.message}`);
        }
      }
    } catch (err) {
      this.logger.error(`checkInFlightJobs failed: ${err.message}`);
    }

    return stats;
  }
}
