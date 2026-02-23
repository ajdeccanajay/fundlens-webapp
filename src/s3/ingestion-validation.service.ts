import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricRegistryService } from '../rag/metric-resolution/metric-registry.service';

/**
 * Result of running ingestion validation on a single metric before DB write.
 */
export interface ValidationResult {
  /** The normalized metric label for storage */
  normalizedMetric: string;
  /** The corrected value (sign-corrected if needed) */
  value: number;
  /** Adjusted confidence score (lowered if range check fails) */
  confidenceScore: number;
  /** Canonical ID mapped from XBRL tag, if applicable */
  canonicalId?: string;
  /** Original XBRL tag preserved for audit */
  xbrlTag?: string;
  /** Flags raised during validation */
  flags: ValidationFlag[];
}

export interface ValidationFlag {
  rule: 'range_check' | 'sign_convention' | 'cross_statement_reconciliation' | 'xbrl_mapping' | 'normalization';
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface MetricInput {
  ticker: string;
  normalizedMetric: string;
  rawLabel: string;
  value: number;
  fiscalPeriod: string;
  filingType: string;
  statementType: string;
  confidenceScore?: number;
  xbrlTag?: string;
}

/**
 * IngestionValidationService — Pre-write validation for financial metrics.
 *
 * Implements 5 validation rules from Requirement 19:
 * 1. normalizeForStorage() — normalization consistency
 * 2. Range check — flag values >5σ from historical mean (last 8 periods)
 * 3. Sign convention — verify/correct sign from YAML registry
 * 4. Cross-statement reconciliation — IS net income vs CF net income
 * 5. XBRL tag → canonical_id mapping
 */
@Injectable()
export class IngestionValidationService {
  private readonly logger = new Logger(IngestionValidationService.name);

  /** Sign conventions for metrics where sign matters.
   *  'positive' = value should be >= 0, 'negative' = value should be <= 0 */
  private static readonly SIGN_CONVENTIONS: Record<string, 'positive' | 'negative'> = {
    revenue: 'positive',
    gross_profit: 'positive',
    operating_income: 'positive',
    net_income: 'positive',
    total_assets: 'positive',
    cost_of_goods_sold: 'positive',
    interest_expense: 'positive',
    income_taxes: 'positive',
    depreciation_amortization: 'positive',
    operating_cash_flow: 'positive',
  };

  /** Rounding tolerance for cross-statement reconciliation (in absolute value) */
  private static readonly ROUNDING_TOLERANCE = 1_000_000; // $1M tolerance

  /** Low confidence score assigned when range check fails */
  private static readonly LOW_CONFIDENCE = 0.3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricRegistry: MetricRegistryService,
  ) {}

  /**
   * Run all validation rules on a metric before writing to the database.
   * Returns a ValidationResult with the corrected/normalized values and any flags.
   */
  async validate(input: MetricInput): Promise<ValidationResult> {
    const flags: ValidationFlag[] = [];

    // Rule 1: Normalize for storage
    const normalizedMetric = this.normalizeForStorage(input.normalizedMetric, input.rawLabel, flags);

    // Rule 5: XBRL tag → canonical_id mapping (run early so other rules can use canonical_id)
    const { canonicalId, xbrlTag } = this.mapXbrlTag(input.xbrlTag, normalizedMetric, flags);

    // Rule 3: Sign convention verification
    const signCorrectedValue = this.verifySignConvention(
      input.value,
      canonicalId || normalizedMetric,
      flags,
    );

    // Rule 2: Range check (>5σ from historical mean)
    let confidenceScore = input.confidenceScore ?? 1.0;
    const rangeCheckFailed = await this.checkRange(
      input.ticker,
      normalizedMetric,
      signCorrectedValue,
      flags,
    );
    if (rangeCheckFailed) {
      confidenceScore = IngestionValidationService.LOW_CONFIDENCE;
    }

    // Rule 4: Cross-statement reconciliation (only for net_income)
    if (this.isNetIncomeMetric(normalizedMetric)) {
      await this.reconcileCrossStatement(
        input.ticker,
        input.fiscalPeriod,
        signCorrectedValue,
        input.statementType,
        flags,
      );
    }

    return {
      normalizedMetric,
      value: signCorrectedValue,
      confidenceScore,
      canonicalId: canonicalId || undefined,
      xbrlTag: xbrlTag || undefined,
      flags,
    };
  }

  /**
   * Rule 1: Normalize metric label for consistent storage.
   * Converts to lowercase snake_case, strips special characters.
   * Logs the original label if it differs from the normalized form.
   *
   * Validates: Requirement 19.1
   */
  normalizeForStorage(
    normalizedMetric: string,
    rawLabel: string,
    flags: ValidationFlag[],
  ): string {
    const original = normalizedMetric;
    const normalized = normalizedMetric
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (normalized !== original) {
      flags.push({
        rule: 'normalization',
        message: `Normalized "${original}" (raw: "${rawLabel}") → "${normalized}"`,
        severity: 'info',
      });
      this.logger.debug(`Normalization: "${original}" → "${normalized}" (raw: "${rawLabel}")`);
    }

    return normalized;
  }

  /**
   * Rule 2: Range check — flag values >5σ from historical mean of last 8 periods.
   * Returns true if the value is an outlier.
   *
   * Validates: Requirement 19.2
   */
  async checkRange(
    ticker: string,
    normalizedMetric: string,
    value: number,
    flags: ValidationFlag[],
  ): Promise<boolean> {
    try {
      const historicalValues = await this.prisma.financialMetric.findMany({
        where: {
          ticker,
          normalizedMetric: { equals: normalizedMetric, mode: 'insensitive' },
        },
        orderBy: { statementDate: 'desc' },
        take: 8,
        select: { value: true },
      });

      if (historicalValues.length < 3) {
        // Not enough history for meaningful statistical check
        return false;
      }

      const values = historicalValues.map((h) => Number(h.value));
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance =
        values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev === 0) {
        // All historical values are identical — any different value is suspicious
        // but we only flag if the new value actually differs
        if (value !== mean) {
          flags.push({
            rule: 'range_check',
            message: `Value ${value} differs from constant historical value ${mean} for ${ticker}/${normalizedMetric}`,
            severity: 'warning',
          });
          this.logger.warn(
            `Range check: ${ticker}/${normalizedMetric} value=${value} differs from constant historical=${mean}`,
          );
          return true;
        }
        return false;
      }

      const deviations = Math.abs(value - mean) / stdDev;

      if (deviations > 5) {
        flags.push({
          rule: 'range_check',
          message: `Value ${value} is ${deviations.toFixed(1)}σ from historical mean ${mean.toFixed(2)} for ${ticker}/${normalizedMetric}. Flagged for review.`,
          severity: 'warning',
        });
        this.logger.warn(
          `Range check FAILED: ${ticker}/${normalizedMetric} value=${value}, mean=${mean.toFixed(2)}, σ=${stdDev.toFixed(2)}, deviations=${deviations.toFixed(1)}`,
        );
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Range check error for ${ticker}/${normalizedMetric}: ${error.message}`);
      return false; // Don't block ingestion on range check errors
    }
  }

  /**
   * Rule 3: Sign convention verification.
   * Checks if the metric has a defined sign convention and corrects if needed.
   *
   * Validates: Requirement 19.3
   */
  verifySignConvention(
    value: number,
    metricId: string,
    flags: ValidationFlag[],
  ): number {
    // Check YAML registry first via MetricRegistryService
    const definition = this.metricRegistry.getMetricById(metricId);
    const convention =
      (definition as any)?.sign_convention ??
      IngestionValidationService.SIGN_CONVENTIONS[metricId];

    if (!convention) {
      return value; // No sign convention defined
    }

    if (convention === 'positive' && value < 0) {
      flags.push({
        rule: 'sign_convention',
        message: `Sign correction: ${metricId} value ${value} inverted to ${-value} (expected positive)`,
        severity: 'warning',
      });
      this.logger.warn(
        `Sign convention correction: ${metricId} value=${value} → ${-value} (convention: positive)`,
      );
      return -value;
    }

    if (convention === 'negative' && value > 0) {
      flags.push({
        rule: 'sign_convention',
        message: `Sign correction: ${metricId} value ${value} inverted to ${-value} (expected negative)`,
        severity: 'warning',
      });
      this.logger.warn(
        `Sign convention correction: ${metricId} value=${value} → ${-value} (convention: negative)`,
      );
      return -value;
    }

    return value;
  }

  /**
   * Rule 4: Cross-statement reconciliation.
   * Checks if net income from IS matches net income from CF within rounding tolerance.
   * Prefers the income statement value when they differ.
   *
   * Validates: Requirement 19.4
   */
  async reconcileCrossStatement(
    ticker: string,
    fiscalPeriod: string,
    value: number,
    statementType: string,
    flags: ValidationFlag[],
  ): Promise<number> {
    try {
      // Find the counterpart net income from the other statement
      const counterpartStatement =
        statementType === 'income_statement' ? 'cash_flow' : 'income_statement';

      const counterpart = await this.prisma.financialMetric.findFirst({
        where: {
          ticker,
          fiscalPeriod,
          statementType: counterpartStatement,
          normalizedMetric: { in: ['net_income', 'netincome', 'net_earnings'], mode: 'insensitive' },
        },
        select: { value: true, statementType: true },
      });

      if (!counterpart) {
        return value; // No counterpart to reconcile against
      }

      const counterpartValue = Number(counterpart.value);
      const difference = Math.abs(value - counterpartValue);

      if (difference > IngestionValidationService.ROUNDING_TOLERANCE) {
        flags.push({
          rule: 'cross_statement_reconciliation',
          message: `Net income discrepancy: ${statementType}=${value}, ${counterpartStatement}=${counterpartValue}, diff=${difference.toFixed(2)}. Preferring income statement value.`,
          severity: 'warning',
        });
        this.logger.warn(
          `Cross-statement reconciliation: ${ticker}/${fiscalPeriod} net income IS=${statementType === 'income_statement' ? value : counterpartValue} vs CF=${statementType === 'cash_flow' ? value : counterpartValue}, diff=${difference.toFixed(2)}`,
        );

        // Prefer income statement value
        if (statementType === 'cash_flow') {
          return counterpartValue;
        }
      }

      return value;
    } catch (error) {
      this.logger.error(
        `Cross-statement reconciliation error for ${ticker}/${fiscalPeriod}: ${error.message}`,
      );
      return value; // Don't block ingestion on reconciliation errors
    }
  }

  /**
   * Rule 5: XBRL tag → canonical_id mapping.
   * Maps XBRL tags to canonical metric IDs using the MetricRegistry.
   *
   * Validates: Requirement 19.5
   */
  mapXbrlTag(
    xbrlTag: string | undefined,
    normalizedMetric: string,
    flags: ValidationFlag[],
  ): { canonicalId: string | null; xbrlTag: string | null } {
    if (!xbrlTag) {
      return { canonicalId: null, xbrlTag: null };
    }

    // Try to resolve the XBRL tag through the metric registry
    const resolution = this.metricRegistry.resolve(xbrlTag);

    if (resolution.confidence !== 'unresolved') {
      flags.push({
        rule: 'xbrl_mapping',
        message: `XBRL tag "${xbrlTag}" mapped to canonical_id "${resolution.canonical_id}"`,
        severity: 'info',
      });
      this.logger.debug(
        `XBRL mapping: "${xbrlTag}" → canonical_id="${resolution.canonical_id}"`,
      );
      return { canonicalId: resolution.canonical_id, xbrlTag };
    }

    // XBRL tag not found in registry — store the raw tag anyway
    flags.push({
      rule: 'xbrl_mapping',
      message: `XBRL tag "${xbrlTag}" not found in registry, storing raw tag only`,
      severity: 'info',
    });
    return { canonicalId: null, xbrlTag };
  }

  /**
   * Check if a metric name refers to net income (for cross-statement reconciliation).
   */
  private isNetIncomeMetric(normalizedMetric: string): boolean {
    const netIncomeVariants = [
      'net_income',
      'netincome',
      'net_earnings',
      'net_profit',
    ];
    return netIncomeVariants.includes(normalizedMetric.toLowerCase());
  }
}
