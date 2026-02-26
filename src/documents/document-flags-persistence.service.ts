/**
 * Document Flags Persistence Service — Spec §9.4
 *
 * Persists red flags and notable items from any extraction path
 * (vision, earnings call, Excel) to the document_flags table.
 * Feeds the provocation engine and analyst review workflows.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface DocumentFlag {
  flagType: string;
  severity: 'info' | 'watch' | 'flag' | 'low' | 'medium' | 'high';
  description: string;
  evidence?: string;
  sourcePageNumber?: number;
}

@Injectable()
export class DocumentFlagsPersistenceService {
  private readonly logger = new Logger(DocumentFlagsPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist document flags. Idempotent: clears existing flags for the document first.
   */
  async persist(
    documentId: string,
    tenantId: string,
    ticker: string | null,
    flags: DocumentFlag[],
  ): Promise<{ persisted: number }> {
    if (flags.length === 0) return { persisted: 0 };

    try {
      // Idempotent
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM document_flags WHERE document_id = $1::uuid`,
        documentId,
      );

      let persisted = 0;
      for (const flag of flags) {
        // Normalize severity: earnings call uses low/medium/high, spec uses info/watch/flag
        const normalizedSeverity = this.normalizeSeverity(flag.severity);

        try {
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO document_flags (
              tenant_id, document_id, ticker,
              flag_type, severity, description, evidence, source_page_number
            ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8)`,
            tenantId,
            documentId,
            ticker?.toUpperCase() || null,
            flag.flagType,
            normalizedSeverity,
            flag.description,
            flag.evidence || null,
            flag.sourcePageNumber || null,
          );
          persisted++;
        } catch (insertErr) {
          this.logger.warn(`[${documentId}] Failed to persist flag: ${insertErr.message}`);
        }
      }

      this.logger.log(`[${documentId}] Persisted ${persisted}/${flags.length} document flags`);
      return { persisted };
    } catch (err) {
      this.logger.error(`[${documentId}] Document flags persistence failed: ${err.message}`);
      return { persisted: 0 };
    }
  }

  private normalizeSeverity(severity: string): string {
    const map: Record<string, string> = {
      low: 'info', medium: 'watch', high: 'flag',
      info: 'info', watch: 'watch', flag: 'flag',
    };
    return map[severity] || 'info';
  }
}
