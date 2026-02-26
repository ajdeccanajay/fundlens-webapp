/**
 * Model Formulas Persistence Service — Spec §9.4
 *
 * Persists Excel formula graph to the model_formulas table.
 * Preserves cell references, dependencies, and resolved metric IDs
 * for transparency and formula engine integration.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FormulaRelation } from './excel-extractor.service';

@Injectable()
export class ModelFormulasPersistenceService {
  private readonly logger = new Logger(ModelFormulasPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist formula graph from an Excel extraction.
   * Idempotent: clears existing formulas for the document first.
   */
  async persist(
    documentId: string,
    tenantId: string,
    formulas: FormulaRelation[],
  ): Promise<{ persisted: number }> {
    if (formulas.length === 0) return { persisted: 0 };

    try {
      // Idempotent
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM model_formulas WHERE document_id = $1::uuid`,
        documentId,
      );

      let persisted = 0;
      for (const f of formulas) {
        try {
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO model_formulas (
              tenant_id, document_id,
              sheet_name, cell_reference, formula_text,
              resolved_metric, dependencies
            ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::jsonb)`,
            tenantId,
            documentId,
            f.sheet,
            f.cell,
            f.formula,
            null, // resolved_metric populated later by metric resolution pass
            JSON.stringify(f.dependsOn),
          );
          persisted++;
        } catch (insertErr) {
          // Continue on individual insert failure
        }
      }

      this.logger.log(`[${documentId}] Persisted ${persisted}/${formulas.length} model formulas`);
      return { persisted };
    } catch (err) {
      this.logger.error(`[${documentId}] Model formulas persistence failed: ${err.message}`);
      return { persisted: 0 };
    }
  }
}
