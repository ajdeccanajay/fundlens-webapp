/**
 * Core TypeScript interfaces for the Metric Resolution Architecture.
 *
 * These types define the data structures used across the three-layer
 * resolution stack: Canonical Metric Registry, Formula Resolution,
 * and Graceful Degradation.
 */

// ---------------------------------------------------------------------------
// Layer 1 — Canonical Metric Registry
// ---------------------------------------------------------------------------

/**
 * A single metric definition as parsed from the YAML registry files.
 * Covers both atomic metrics (direct DB column) and computed metrics (formula-based).
 */
export interface MetricDefinition {
  /** Unique snake_case identifier, e.g. "cash_and_cash_equivalents" */
  canonical_id: string;

  /** Human-readable name, e.g. "Cash and Cash Equivalents" */
  display_name: string;

  /** Whether the metric is read directly from the DB or calculated from other metrics */
  type: 'atomic' | 'computed';

  /** Financial statement this metric belongs to, null for computed/supplemental */
  statement:
    | 'income_statement'
    | 'balance_sheet'
    | 'cash_flow'
    | 'equity_statement'
    | 'supplemental'
    | null;

  /** Functional category, e.g. "current_assets", "leverage", "profitability" */
  category: string;

  /** Asset classes this metric applies to, e.g. ["public_equity", "private_equity"] */
  asset_class: string[];

  /** Industry scope — "all" or a specific sector name */
  industry: string;

  /** Alternative names analysts may use for this metric */
  synonyms: string[];

  /** XBRL taxonomy tags associated with this metric */
  xbrl_tags: string[];

  /** Database column name — derived at load time for atomic metrics; undefined for supplemental/PE */
  db_column?: string;

  /** Formula expression for computed metrics, e.g. "gross_profit / revenue * 100" */
  formula?: string;

  /** Canonical IDs of metrics this computed metric depends on */
  dependencies?: string[];

  /** Display format hint: "percentage" | "currency" | "ratio" | "days" | "currency_per_share" */
  output_format?: string;

  /** Suffix appended to displayed values, e.g. "%" | "x" | " days" */
  output_suffix?: string;

  /** Interpretation thresholds, e.g. { strong: "> 15%", adequate: "10% - 15%" } */
  interpretation?: Record<string, string>;

  /** Free-text notes on how this metric is calculated or sourced */
  calculation_notes?: string;
}

// ---------------------------------------------------------------------------
// Layer 1 — Resolution Pipeline Output
// ---------------------------------------------------------------------------

/**
 * The structured result of resolving a raw metric query through the
 * Resolution Pipeline. Every query produces one of these — never a raw string.
 */
export interface MetricResolution {
  /** Canonical ID of the resolved metric (empty string when unresolved) */
  canonical_id: string;

  /** Human-readable name (empty string when unresolved) */
  display_name: string;

  /** Whether the resolved metric is atomic or computed */
  type: 'atomic' | 'computed';

  /** How the resolution was achieved */
  confidence: 'exact' | 'fuzzy_auto' | 'unresolved';

  /** Fuzzy match score when applicable, null for exact matches and unresolved with no candidates */
  fuzzy_score: number | null;

  /** The original query string submitted by the caller */
  original_query: string;

  /** Which synonym, method, or index key produced the match */
  match_source: string;

  /** Up to 3 alternative metrics when unresolved, null otherwise */
  suggestions: MetricSuggestion[] | null;

  /** Database column for atomic metrics */
  db_column?: string;

  /** Formula expression for computed metrics */
  formula?: string;

  /** Dependency canonical IDs for computed metrics */
  dependencies?: string[];
}

/**
 * A single suggestion offered when a metric query cannot be auto-resolved.
 */
export interface MetricSuggestion {
  /** Canonical ID of the suggested metric */
  canonical_id: string;

  /** Human-readable name of the suggested metric */
  display_name: string;

  /** Fuzzy similarity score (0–1) */
  fuzzy_score: number;
}

// ---------------------------------------------------------------------------
// Layer 1 — Registry Management
// ---------------------------------------------------------------------------

/** Result returned after building or rebuilding the inverted synonym index. */
export interface IndexBuildResult {
  /** Total number of metric definitions loaded from YAML */
  metricsLoaded: number;

  /** Total number of synonym entries indexed (includes canonical_id, display_name, synonyms, XBRL tags) */
  synonymsIndexed: number;

  /** Number of synonym collisions detected (same normalized key for different metrics) */
  collisions: number;

  /** Wall-clock time in milliseconds to complete the build */
  loadTimeMs: number;
}

/** Live statistics exposed by MetricRegistryService for monitoring. */
export interface RegistryStats {
  /** Total metric definitions currently loaded */
  metricsLoaded: number;

  /** Total synonym entries in the inverted index */
  synonymsIndexed: number;

  /** Synonym collisions detected during last build */
  collisions: number;

  /** Current number of entries in the LRU resolution cache */
  cacheSize: number;

  /** Duration of the last index build in milliseconds */
  lastBuildTimeMs: number;
}

// ---------------------------------------------------------------------------
// Layer 2 — Formula Resolution (Python Calculation Bridge)
// ---------------------------------------------------------------------------

/**
 * The full result of resolving a computed metric, including the Python-evaluated
 * value and a complete audit trail for transparency.
 */
export interface ComputedMetricResult {
  /** Canonical ID of the computed metric */
  canonical_id: string;

  /** Human-readable name */
  display_name: string;

  /** Computed value, or null if a dependency is missing */
  value: number | null;

  /** The formula expression that was evaluated */
  formula: string;

  /** Every input metric with its resolved value and source */
  resolved_inputs: Record<string, ResolvedValue>;

  /** Non-null when value is null — explains which dependency is missing */
  explanation: string | null;

  /** Audit trail from the Python calculation engine, null when value is null */
  audit_trail: AuditTrail | null;

  /** Interpretation label from YAML thresholds, e.g. "Moderate (2.0x - 4.0x)" */
  interpretation: string | null;
}

/**
 * A single resolved dependency value used as input to a computed metric formula.
 */
export interface ResolvedValue {
  /** Canonical ID of the dependency metric */
  metric_id: string;

  /** Human-readable name of the dependency metric */
  display_name: string;

  /** The numeric value, or null if unavailable */
  value: number | null;

  /** Where the value came from: "database" | "computed" | "cache" */
  source: string;

  /** Fiscal period the value belongs to */
  period: string;

  /** Filing type if applicable (e.g. "10-K", "10-Q") */
  filing_type?: string;
}

/**
 * Raw result returned by the Python `/calculate` endpoint.
 */
export interface PythonCalculationResult {
  /** The computed numeric result */
  result: number;

  /** Full audit trail of the calculation */
  audit_trail: AuditTrail;
}

/**
 * Detailed audit trail produced by the Python calculation engine
 * for full transparency and reproducibility.
 */
export interface AuditTrail {
  /** The formula expression that was evaluated */
  formula: string;

  /** Input variable names mapped to their numeric values */
  inputs: Record<string, number>;

  /** Human-readable intermediate calculation steps */
  intermediate_steps: string[];

  /** Final computed result */
  result: number;

  /** Wall-clock execution time in milliseconds */
  execution_time_ms: number;
}
