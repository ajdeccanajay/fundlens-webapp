/**
 * Call Analysis Persistence Service — Spec §9.4
 *
 * Persists structured earnings call analysis to the call_analysis table.
 * One row per call — stores tone, guidance, red flags, participant counts.
 * Queryable by ticker for cross-call trend analysis.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EarningsCallResult } from './earnings-call-extractor.service';

@Injectable()
export class CallAnalysisPersistenceService {
  private readonly logger = new Logger(CallAnalysisPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist structured earnings call analysis.
   * Idempotent: deletes existing analysis for the document before inserting.
   */
  async persist(
    documentId: string,
    tenantId: string,
    result: EarningsCallResult,
  ): Promise<{ success: boolean; id?: string }> {
    if (!result.callMetadata.ticker) {
      this.logger.warn(`[${documentId}] No ticker — skipping call analysis persistence`);
      return { success: false };
    }

    try {
      // Idempotent: remove previous analysis for this document
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM call_analysis WHERE document_id = $1::uuid`,
        documentId,
      );

      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO call_analysis (
          tenant_id, document_id, ticker, quarter, call_date,
          overall_confidence, confidence_rationale,
          guidance_changed, guidance_direction, guidance_items,
          tone_analysis, red_flags, topics_not_discussed,
          participant_count, qa_exchange_count
        ) VALUES (
          $1, $2::uuid, $3, $4, $5::date,
          $6, $7,
          $8, $9, $10::jsonb,
          $11::jsonb, $12::jsonb, $13::jsonb,
          $14, $15
        ) RETURNING id`,
        tenantId,
        documentId,
        result.callMetadata.ticker.toUpperCase(),
        result.callMetadata.quarter || 'unknown',
        result.callMetadata.date || null,
        result.toneAnalysis.overallConfidence,
        result.toneAnalysis.confidenceRationale,
        result.guidanceSummary.guidanceChanged,
        result.guidanceSummary.direction,
        JSON.stringify(result.guidanceSummary.items),
        JSON.stringify(result.toneAnalysis),
        JSON.stringify(result.redFlags),
        JSON.stringify(result.toneAnalysis.topicsAvoided || []),
        (result.callMetadata.managementParticipants?.length || 0) +
          (result.callMetadata.analystParticipants?.length || 0),
        result.qaExchanges.length,
      );

      const id = rows?.[0]?.id;
      this.logger.log(
        `[${documentId}] Call analysis persisted: ${result.callMetadata.ticker} ` +
        `${result.callMetadata.quarter}, confidence=${result.toneAnalysis.overallConfidence}/10`,
      );
      return { success: true, id };
    } catch (err) {
      this.logger.error(`[${documentId}] Call analysis persistence failed: ${err.message}`);
      return { success: false };
    }
  }
}
