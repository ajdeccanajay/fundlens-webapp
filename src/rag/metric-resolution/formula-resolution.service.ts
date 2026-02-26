/**
 * FormulaResolutionService — Dispatcher for computed metric evaluation.
 *
 * This service does NOT evaluate formulas itself. It:
 * 1. Resolves the dependency DAG (which metrics are needed, in what order)
 * 2. Fetches all atomic values from the DB in a single batch query
 * 3. Packages { formula, inputs, output_format } as a JSON payload
 * 4. Sends to Python calculator via FinancialCalculatorService.evaluateFormula()
 * 5. Caches resolved dependency values per (ticker, period) to avoid redundant DB hits
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MetricRegistryService } from './metric-registry.service';
import { FinancialCalculatorService } from '../../deals/financial-calculator.service';
import type {
  MetricResolution,
  MetricDefinition,
  ComputedMetricResult,
  ResolvedValue,
} from './types';

@Injectable()
export class FormulaResolutionService {
  private readonly logger = new Logger(FormulaResolutionService.name);

  /** Cache keyed by `${ticker}:${period}:${metricId}` to avoid redundant DB/compute hits */
  private resolutionCache = new Map<string, ResolvedValue>();

  constructor(
    private readonly registry: MetricRegistryService,
    private readonly prisma: PrismaService,
    private readonly calculator: FinancialCalculatorService,
  ) {}

  /**
   * Resolve a computed metric by walking its dependency DAG,
   * fetching atomic values, and dispatching to Python for evaluation.
   */
  async resolveComputed(
    resolution: MetricResolution,
    ticker: string,
    period?: string,
  ): Promise<ComputedMetricResult> {
    const metric = this.registry.getMetricById(resolution.canonical_id);
    if (!metric) {
      return this.buildNullResult(
        resolution.canonical_id,
        resolution.display_name,
        resolution.formula || '',
        `Metric definition not found for "${resolution.canonical_id}"`,
      );
    }

    if (metric.type !== 'computed' || !metric.formula || !metric.dependencies) {
      return this.buildNullResult(
        metric.canonical_id,
        metric.display_name,
        metric.formula || '',
        `"${metric.display_name}" is not a computed metric or has no formula`,
      );
    }

    const effectivePeriod = period || 'latest';

    // Collect all dependencies (including transitive) using topological order
    const resolvedInputs: Record<string, ResolvedValue> = {};
    const missingDeps: string[] = [];

    // Resolve each dependency — atomic from DB, computed recursively
    for (const depId of metric.dependencies) {
      const resolved = await this.resolveDependency(depId, ticker, effectivePeriod, new Set());
      resolvedInputs[depId] = resolved;

      if (resolved.value === null) {
        missingDeps.push(depId);
      }
    }

    // If ANY dependency is null, short-circuit — do NOT dispatch to Python
    if (missingDeps.length > 0) {
      const missingNames = missingDeps
        .map((id) => {
          const def = this.registry.getMetricById(id);
          return def ? def.display_name : id;
        })
        .join(', ');

      return this.buildNullResult(
        metric.canonical_id,
        metric.display_name,
        metric.formula,
        `Cannot calculate ${metric.display_name}: missing ${missingNames} for ${effectivePeriod}`,
        resolvedInputs,
      );
    }

    // Build numeric inputs map from resolved values
    const numericInputs: Record<string, number> = {};
    for (const [depId, rv] of Object.entries(resolvedInputs)) {
      numericInputs[depId] = rv.value!;
    }

    // Dispatch to Python /calculate
    const calcResult = await this.calculator.evaluateFormula(
      metric.formula,
      numericInputs,
      metric.output_format || 'ratio',
    );

    if ('error' in calcResult && calcResult.result === null) {
      return this.buildNullResult(
        metric.canonical_id,
        metric.display_name,
        metric.formula,
        `Formula evaluation failed: ${calcResult.error}`,
        resolvedInputs,
      );
    }

    // Wire interpretation thresholds from YAML
    const interpretation = this.interpretValue(calcResult.result as number, metric);

    return {
      canonical_id: metric.canonical_id,
      display_name: metric.display_name,
      value: calcResult.result as number,
      formula: metric.formula,
      resolved_inputs: resolvedInputs,
      explanation: null,
      audit_trail: 'audit_trail' in calcResult ? calcResult.audit_trail : null,
      interpretation,
    };
  }

  /**
   * Recursively resolve a single dependency metric.
   * Checks cache first, then fetches from DB (atomic) or recurses (computed).
   */
  private async resolveDependency(
    metricId: string,
    ticker: string,
    period: string,
    visited: Set<string>,
  ): Promise<ResolvedValue> {
    // Cycle guard
    if (visited.has(metricId)) {
      this.logger.warn(`Cycle detected resolving "${metricId}" — returning null`);
      return this.buildNullValue(metricId, period, 'Circular dependency detected');
    }
    visited.add(metricId);

    // Cache check
    const cacheKey = `${ticker}:${period}:${metricId}`;
    const cached = this.resolutionCache.get(cacheKey);
    if (cached) {
      return { ...cached, source: 'cache' };
    }

    const metric = this.registry.getMetricById(metricId);
    if (!metric) {
      return this.buildNullValue(metricId, period, 'Metric not found in registry');
    }

    let resolved: ResolvedValue;

    if (metric.type === 'atomic') {
      // Fetch from database
      const dbValues = await this.batchFetchAtomicValues([metricId], ticker, period);
      const dbValue = dbValues.get(metricId);
      resolved = dbValue || this.buildNullValue(metricId, period, 'No data in database');
    } else if (metric.type === 'computed' && metric.formula && metric.dependencies) {
      // Recurse for computed dependencies
      const depInputs: Record<string, number> = {};
      let hasMissing = false;

      for (const depId of metric.dependencies) {
        const depResolved = await this.resolveDependency(depId, ticker, period, new Set(visited));
        if (depResolved.value === null) {
          hasMissing = true;
          break;
        }
        depInputs[depId] = depResolved.value;
      }

      if (hasMissing) {
        resolved = this.buildNullValue(metricId, period, 'Missing sub-dependency');
      } else {
        const calcResult = await this.calculator.evaluateFormula(
          metric.formula,
          depInputs,
          metric.output_format || 'ratio',
        );

        if ('error' in calcResult && calcResult.result === null) {
          resolved = this.buildNullValue(metricId, period, `Calculation failed: ${(calcResult as any).error}`);
        } else {
          resolved = {
            metric_id: metricId,
            display_name: metric.display_name,
            value: calcResult.result as number,
            source: 'computed',
            period,
          };
        }
      }
    } else {
      resolved = this.buildNullValue(metricId, period, 'Invalid metric definition');
    }

    // Cache the result
    this.resolutionCache.set(cacheKey, resolved);
    return resolved;
  }

  /**
   * Batch fetch atomic metric values from the database in a single query.
   * Returns a Map of metricId → ResolvedValue.
   */
  async batchFetchAtomicValues(
    metricIds: string[],
    ticker: string,
    period?: string,
  ): Promise<Map<string, ResolvedValue>> {
    const result = new Map<string, ResolvedValue>();
    if (metricIds.length === 0) return result;

    const effectivePeriod = period || 'latest';

    // Map canonical_ids to db_columns (they're the same for universal metrics)
    const dbColumns = metricIds.filter((id) => {
      const def = this.registry.getMetricById(id);
      return def?.db_column;
    });

    if (dbColumns.length === 0) return result;

    // Build synonym-expanded lookup: for each metric, get all known synonyms
    // so we can match against whatever label the XBRL parser stored in the DB.
    // E.g., "revenue" might be stored as "net_sales" for some tickers.
    const allSynonyms: string[] = [];
    const synonymToCanonical = new Map<string, string>();
    for (const metricId of dbColumns) {
      const synonyms = this.registry.getSynonymsForDbColumn(metricId);
      for (const syn of synonyms) {
        const lower = syn.toLowerCase();
        allSynonyms.push(lower);
        synonymToCanonical.set(lower, metricId);
      }
      // Always include the canonical_id itself
      allSynonyms.push(metricId.toLowerCase());
      synonymToCanonical.set(metricId.toLowerCase(), metricId);
    }

    // Deduplicate
    const uniqueSynonyms = [...new Set(allSynonyms)];

    try {
      let rows: any[];

      if (effectivePeriod === 'latest') {
        // Fetch the most recent value for each metric using synonym expansion
        rows = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT DISTINCT ON (normalized_metric)
             normalized_metric, value, fiscal_period, period_type, filing_type
           FROM financial_metrics
           WHERE ticker = $1
             AND LOWER(normalized_metric) = ANY($2::text[])
           ORDER BY normalized_metric, fiscal_period DESC`,
          ticker.toUpperCase(),
          uniqueSynonyms,
        );
      } else {
        // Fetch for a specific period using synonym expansion
        rows = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT normalized_metric, value, fiscal_period, period_type, filing_type
           FROM financial_metrics
           WHERE ticker = $1
             AND LOWER(normalized_metric) = ANY($2::text[])
             AND fiscal_period = $3
           ORDER BY normalized_metric`,
          ticker.toUpperCase(),
          uniqueSynonyms,
          effectivePeriod,
        );
      }

      for (const row of rows) {
        // Map the DB label back to the canonical_id
        const dbLabel = (row.normalized_metric || '').toLowerCase();
        const canonicalId = synonymToCanonical.get(dbLabel) || row.normalized_metric;
        const def = this.registry.getMetricById(canonicalId);

        // Only set if we haven't already resolved this canonical_id
        // (first match wins — DISTINCT ON already gives us the latest)
        if (!result.has(canonicalId)) {
          result.set(canonicalId, {
            metric_id: canonicalId,
            display_name: def?.display_name || canonicalId,
            value: parseFloat(row.value),
            source: 'database',
            period: row.fiscal_period,
            filing_type: row.filing_type,
          });

          // Also cache this value
          const cacheKey = `${ticker}:${effectivePeriod}:${canonicalId}`;
          this.resolutionCache.set(cacheKey, result.get(canonicalId)!);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to batch fetch atomic values: ${(err as Error).message}`);
    }

    return result;
  }

  /**
   * Clear the resolution cache. Call between different ticker/period contexts.
   */
  clearCache(): void {
    this.resolutionCache.clear();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Interpret a computed value against YAML-defined thresholds.
   * Returns a label like "Strong (> 15%)" or null if no thresholds defined.
   */
  private interpretValue(value: number, metric: MetricDefinition): string | null {
    if (!metric.interpretation) return null;

    // Interpretation entries are like: { strong: "> 15%", adequate: "10% - 15%", weak: "< 10%" }
    for (const [label, condition] of Object.entries(metric.interpretation)) {
      const match = condition.match(/^([<>]=?)\s*([\d.]+)/);
      if (match) {
        const op = match[1];
        const threshold = parseFloat(match[2]);
        const passes =
          op === '>' ? value > threshold :
          op === '>=' ? value >= threshold :
          op === '<' ? value < threshold :
          op === '<=' ? value <= threshold :
          false;
        if (passes) {
          return `${label.charAt(0).toUpperCase() + label.slice(1)} (${condition})`;
        }
      }

      // Range format: "10% - 15%" or "2.0x - 4.0x"
      const rangeMatch = condition.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
      if (rangeMatch) {
        const low = parseFloat(rangeMatch[1]);
        const high = parseFloat(rangeMatch[2]);
        if (value >= low && value <= high) {
          return `${label.charAt(0).toUpperCase() + label.slice(1)} (${condition})`;
        }
      }
    }

    return null;
  }

  private buildNullResult(
    canonicalId: string,
    displayName: string,
    formula: string,
    explanation: string,
    resolvedInputs?: Record<string, ResolvedValue>,
  ): ComputedMetricResult {
    return {
      canonical_id: canonicalId,
      display_name: displayName,
      value: null,
      formula,
      resolved_inputs: resolvedInputs || {},
      explanation,
      audit_trail: null,
      interpretation: null,
    };
  }

  private buildNullValue(metricId: string, period: string, reason?: string): ResolvedValue {
    const def = this.registry.getMetricById(metricId);
    return {
      metric_id: metricId,
      display_name: def?.display_name || metricId,
      value: null,
      source: reason || 'unavailable',
      period,
    };
  }
}
