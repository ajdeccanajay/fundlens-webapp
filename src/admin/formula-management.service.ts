import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialCalculatorService } from '../deals/financial-calculator.service';
import { MetricRegistryService } from '../rag/metric-resolution/metric-registry.service';

export interface CreateFormulaDto {
  canonicalId: string;
  displayName: string;
  dependencies: string[];
  formula: string;
  outputFormat: string;
  category: string;
  industry?: string;
  assetClass?: string[];
  interpretation?: Record<string, string>;
  synonyms?: string[];
  calculationNotes?: string;
  submittedBy: string;
}

@Injectable()
export class FormulaManagementService {
  private readonly logger = new Logger(FormulaManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financialCalculator: FinancialCalculatorService,
    private readonly metricRegistry: MetricRegistryService,
  ) {}

  /**
   * Create a new formula submission.
   * Validates the formula via Python /calculate before persisting.
   */
  async createFormula(dto: CreateFormulaDto) {
    // Build sample inputs from dependencies — use 1000000 for all deps
    const sampleInputs: Record<string, number> = {};
    for (const dep of dto.dependencies) {
      sampleInputs[dep] = 1000000;
    }

    // Validate formula via Python /calculate
    const validationResult = await this.financialCalculator.evaluateFormula(
      dto.formula,
      sampleInputs,
      dto.outputFormat,
    );

    if ('error' in validationResult && validationResult.error) {
      throw new BadRequestException(
        `Formula validation failed: ${validationResult.error}`,
      );
    }

    // Save to pending_formulas
    const formula = await this.prisma.pendingFormula.create({
      data: {
        canonicalId: dto.canonicalId,
        displayName: dto.displayName,
        formula: dto.formula,
        dependencies: dto.dependencies,
        outputFormat: dto.outputFormat,
        category: dto.category,
        industry: dto.industry || 'all',
        assetClass: dto.assetClass || ['public_equity'],
        interpretation: dto.interpretation || undefined,
        synonyms: dto.synonyms || undefined,
        calculationNotes: dto.calculationNotes || undefined,
        submittedBy: dto.submittedBy,
      },
    });

    this.logger.log(
      `Formula submitted: ${dto.canonicalId} (${formula.id}) by ${dto.submittedBy}`,
    );

    return formula;
  }

  /**
   * List all pending formulas ordered by submission date (newest first).
   */
  async listPending() {
    return this.prisma.pendingFormula.findMany({
      where: { status: 'pending_review' },
      orderBy: { submittedAt: 'desc' },
    });
  }

  /**
   * Get a single formula by ID.
   */
  async getById(id: string) {
    const formula = await this.prisma.pendingFormula.findUnique({
      where: { id },
    });

    if (!formula) {
      throw new NotFoundException(`Formula not found: ${id}`);
    }

    return formula;
  }

  /**
   * Approve a pending formula.
   * Updates status, triggers registry index rebuild.
   */
  async approve(id: string, reviewedBy: string) {
    const formula = await this.prisma.pendingFormula.findUnique({
      where: { id },
    });

    if (!formula) {
      throw new NotFoundException(`Formula not found: ${id}`);
    }

    const updated = await this.prisma.pendingFormula.update({
      where: { id },
      data: {
        status: 'approved',
        reviewedBy,
        reviewedAt: new Date(),
      },
    });

    // Trigger index rebuild so the new formula is available
    await this.metricRegistry.rebuildIndex();

    this.logger.log(
      `Formula approved: ${formula.canonicalId} (${id}) by ${reviewedBy}`,
    );

    return updated;
  }

  /**
   * Reject a pending formula with a reason.
   */
  async reject(id: string, rejectionReason: string, reviewedBy: string) {
    const formula = await this.prisma.pendingFormula.findUnique({
      where: { id },
    });

    if (!formula) {
      throw new NotFoundException(`Formula not found: ${id}`);
    }

    const updated = await this.prisma.pendingFormula.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectionReason,
        reviewedBy,
        reviewedAt: new Date(),
      },
    });

    this.logger.log(
      `Formula rejected: ${formula.canonicalId} (${id}) by ${reviewedBy} — ${rejectionReason}`,
    );

    return updated;
  }
}
