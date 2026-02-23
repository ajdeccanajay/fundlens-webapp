# FundLens RAG ChatBot — Master Engineering Spec
### Kiro Implementation Guide · February 2026 · Confidential

---

## KIRO SESSION INSTRUCTIONS

> Read this entire section before touching any code. Do not skip steps.

### Before You Write Any Code — Discover the Schema

**Step 1.** Find the actual table names:
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

**Step 2.** Find the actual column names for the financial metrics table (use the table name you found in Step 1):
```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = '<metrics_table_from_step_1>'
ORDER BY ordinal_position;
```

**Step 3.** Run the diagnostic using the real table and column names you found:
```sql
SELECT DISTINCT <metric_column>, <label_column>, COUNT(*) as count
FROM <metrics_table>
WHERE <ticker_column> = 'ABNB'
GROUP BY <metric_column>, <label_column>
ORDER BY <metric_column>;
```

**Step 3b.** Audit what raw metric labels are actually stored across all tickers — this reveals the synonym gap between what the MetricRegistry expects and what ingestion wrote:
```sql
SELECT <metric_column>, COUNT(DISTINCT <ticker_column>) as ticker_count
FROM <metrics_table>
WHERE <metric_column> IN (
  'revenue', 'revenues', 'total_revenue', 'net_revenue',
  'net_sales', 'sales', 'us-gaap:Revenues', 'us-gaap:SalesRevenueNet'
)
GROUP BY <metric_column>
ORDER BY ticker_count DESC;
```

**Step 4.** Confirm the Prisma field mapping:
```bash
grep -rn "normalizedMetric\|normalized_metric\|rawLabel\|raw_label" prisma/schema.prisma
```

**Step 5.** Check what synonyms the MetricRegistry currently has for revenue:
```bash
grep -A 20 "^revenue:" local-s3-storage/fundlens-documents-dev/metrics/universal/income_statement.yaml
```

Show me the output of all five steps before writing a single line of code.

---

### Implementation Rules

- Work one section at a time. Do not start a new section until I confirm the previous one is working with a real query test.
- Start with **Section 1.1 only** (db_column wiring in `structured-retriever.service.ts`).
- After Section 1.1, I will run: `"What is the latest Revenue for ABNB?"`
  - If the response contains an actual dollar figure → proceed to 1.1c.
  - If it returns "No Data Available" → stop and show me the exact DB query being executed.
- Never modify more than one service file per session unless the spec explicitly says the changes are in the same section.
- When the spec shows a BEFORE/AFTER code block, make exactly those changes and no others. Do not refactor surrounding code.

---

### Session Order

| Session | Scope | Gate |
|---------|-------|------|
| 1 | Schema discovery → Diagnostic → Section 1.1 (db_column + sort + computed routing) | T1.1, T1.5, T1.6 pass |
| 2 | Section 1.2 (ticker hardening) | T1.2, T1.3 pass |
| 3 | Section 1.3 (VisualizationPayload contract) | T1.1 response includes visualization object |
| 4 | Sections 2.1–2.4 (HybridSynthesisService) — only after Sessions 1–3 verified | T2.1 contains all 5 reasoning steps |
| 5 | Sections 3.1–3.3 (QueryDecomposer + retrieval loop) | T3.1, T3.2 pass |
| 6 | Sections 4.1–4.2 (PeerComparisonService) | T3.3 passes |

---

### Files Per Session

**Session 1 only:**
- `src/rag/structured-retriever.service.ts` (primary)
- `src/rag/metric-resolution/metric-registry.service.ts` (add `getSynonymsForDbColumn()` method)
- `local-s3-storage/fundlens-documents-dev/metrics/universal/income_statement.yaml` (add missing synonyms)
- `src/rag/metric-resolution/formula-resolution.service.ts` (only if `resolveForTicker` is missing)
- Do not touch any other files.

---

---

## RECONCILIATION: WHAT THIS SPEC RESOLVES

This document reconciles three prior analysis sessions into a single implementation plan. The decisions:

| Prior Document | What It Got Right | What This Spec Supersedes |
|---|---|---|
| Doc 1: Architecture | HybridSynthesisService design; PE extensibility via YAML overlays; ResponseType taxonomy; PeerComparisonService concept; graceful degradation framework | ChartIntelligenceService as a backend service (wrong layer); architecture defined before confirming root cause |
| Doc 2: Precise Fix | Exact failure sequence (step 10: MetricResolution→string type mismatch); db_column wiring; universal ticker pattern + companies table validation; VisualizationPayload frontend contract; fiscal period sort fix | Didn't address Level 3–4 query complexity; synthesis prompt architecture missing |
| Verbal Analysis | Agentic retrieval loop for L3–4; QueryDecomposer; structured synthesis prompt; provocation grounded in retrieved data; Level 5 scoped out | N/A — this spec implements all of it |

**Single governing principle:** The architecture was always correct. The MetricRegistry, FormulaResolutionService, ConceptRegistry, three-layer intent detection, and parallel hybrid retrieval are all sound. Every problem is plumbing — connections designed but not wired, synthesis with no financial reasoning structure, and query planning that is single-pass where it needs to be iterative.

---

---

## PART I — FOUNDATION FIXES
### Sprint 1 · ~10 hours · 1 engineer

These are not optional prerequisites. Nothing in Parts II–IV works correctly without them.

---

### Fix 1.1 — Wire MetricResolution.db_column
**File:** `src/rag/structured-retriever.service.ts` · **Effort:** 3h · **Risk:** Low

**Confirmed root cause:** `getLatestByFilingType()` receives a `MetricResolution` object at runtime but its signature declares `metric: string`. Calling `.toLowerCase()` on the object yields `[object Object]`. The DB query matches nothing. This is why ABNB Revenue returns "No Data Available" despite data existing in the database.

#### Change 1a — Fix method signature and use db_column

```typescript
// BEFORE (line ~366):
private async getLatestByFilingType(
  ticker: string,
  metric: string,              // ← receives MetricResolution at runtime
  filingType: string,
): Promise<MetricResult | null> {
  const metricVariations = [metric.toLowerCase(), ...];  // ← '[object Object]'

// AFTER:
private async getLatestByFilingType(
  ticker: string,
  resolution: MetricResolution,
  filingType: string,
): Promise<MetricResult | null> {

  // Computed metrics never touch the DB directly
  if (resolution.type === 'computed') {
    return this.resolveComputedMetric(ticker, resolution, filingType);
  }

  // Unresolved: surface gracefully
  if (resolution.confidence === 'unresolved') {
    this.logger.warn(`Unresolved: ${resolution.original_query}`);
    return null;
  }

  // Atomic: query by all synonyms from MetricRegistry (single source of truth)
  // This handles cases where ingestion stored raw labels like 'net_sales' instead of 'revenue'
  const synonyms = this.metricRegistry.getSynonymsForDbColumn(resolution.canonical_id);
  // e.g. ['revenue', 'revenues', 'total_revenue', 'net_revenue', 'net_sales', ...]

  const results = await this.prisma.financialMetric.findMany({
    where: {
      ticker,
      normalizedMetric: { in: synonyms, mode: 'insensitive' },
      filingType,
    },
    orderBy: { statementDate: 'desc' },
  });
  if (!results.length) return null;
  const best = results.sort((a, b) =>
    this.parseFiscalPeriodSortKey(b.fiscalPeriod) - this.parseFiscalPeriodSortKey(a.fiscalPeriod)
  )[0];
  const result = this.formatMetric(best);
  result.displayName = resolution.display_name;
  return result;
}
```

> **Note:** Replace `normalizedMetric` with the actual Prisma field name confirmed in your schema discovery step.
> The `metricTranslation` hardcoded map that previously existed in `retrieve()` should be **deleted** — `getSynonymsForDbColumn()` replaces it entirely.

#### Change 1b — Fix retrieveLatest() caller to pass MetricResolution

```typescript
// BEFORE:
for (const metric of query.metrics) {
  const annual = await this.getLatestByFilingType(ticker, metric, '10-K');
}

// AFTER:
for (const resolution of query.metrics) {   // query.metrics is MetricResolution[]
  const annual    = await this.getLatestByFilingType(ticker, resolution, '10-K');
  const quarterly = await this.getLatestByFilingType(ticker, resolution, '10-Q');
  if (annual)    results.push(annual);
  if (quarterly) results.push(quarterly);
}
```

#### Change 1c — Fix fiscal period sort

```typescript
// BUG: parseInt('Q3FY2024'.replace(/[^\d]/g,'')) = 32024 > 2024 (annual ranks lower than quarterly)

private parseFiscalPeriodSortKey(period: string): number {
  const annual = period.match(/FY(\d{4})/i);
  if (annual) return parseInt(annual[1]) * 10000;           // FY2024 → 20240000

  const qtr = period.match(/Q([1-4])[\s\-]?(?:FY)?(\d{4})/i);
  if (qtr) return parseInt(qtr[2]) * 10000 + parseInt(qtr[1]) * 100;  // Q3FY2024 → 20240300

  if (/TTM/i.test(period)) return 99990000;

  const yr = period.match(/(\d{4})/);
  return yr ? parseInt(yr[1]) * 10000 : 0;
}
```

#### Change 1d — Wire computed metrics to FormulaResolutionService

```typescript
// Add to constructor: private readonly formulaResolver: FormulaResolutionService

private async resolveComputedMetric(
  ticker: string, resolution: MetricResolution, filingType: string,
): Promise<MetricResult | null> {
  try {
    const period = filingType === '10-K' ? 'latest_annual' : 'latest_quarterly';
    const result = await this.formulaResolver.resolveComputed(resolution, ticker, period);
    if (!result || result.value === null) return null;
    return {
      ticker, normalizedMetric: resolution.canonical_id,
      displayName: resolution.display_name, rawLabel: resolution.display_name,
      value: result.value,
      fiscalPeriod: result.resolved_inputs?.[Object.keys(result.resolved_inputs)[0]]?.period ?? 'latest',
      periodType: filingType === '10-K' ? 'annual' : 'quarterly',
      filingType, statementType: 'computed',
      statementDate: new Date(), filingDate: new Date(), confidenceScore: 1.0,
    };
  } catch (e) {
    this.logger.warn(`Computed resolution failed: ${ticker}/${resolution.canonical_id}: ${e.message}`);
    return null;
  }
}
```

#### Change 1e — Add getSynonymsForDbColumn() to MetricRegistryService
**File:** `src/rag/metric-resolution/metric-registry.service.ts`

This method is the single source of truth for synonym lookup at retrieval time. It replaces the hardcoded `metricTranslation` map in the retriever.

```typescript
/**
 * Returns all known storage synonyms for a canonical metric ID.
 * Used by StructuredRetriever to build the IN clause for DB queries.
 * Includes canonical_id + db_column + all synonyms from YAML definition.
 */
getSynonymsForDbColumn(canonicalId: string): string[] {
  const definition = this.getMetricById(canonicalId);
  if (!definition) return [canonicalId];

  const synonymSet = new Set<string>();
  // Always include canonical_id and db_column
  synonymSet.add(canonicalId);
  if (definition.db_column) synonymSet.add(definition.db_column);
  // Return original YAML synonyms — NOT normalized.
  // normalize-for-lookup.ts is for index building only, not DB queries.
  // The DB stores raw labels (e.g. 'net_sales', 'us-gaap:Revenues') as written by ingestion.
  for (const syn of definition.synonyms ?? []) {
    synonymSet.add(syn);
  }
  return Array.from(synonymSet);
}
```

---

#### Change 1f — Add missing synonyms to income_statement.yaml
**File:** `local-s3-storage/fundlens-documents-dev/metrics/universal/income_statement.yaml`

> **Before making this change:** Run Step 3b from the schema discovery section to see what raw labels are actually in your DB. Add every value you find to the synonyms list below. The list here is a starting point — your DB output is authoritative.

```yaml
revenue:
  display_name: Revenue
  db_column: revenue
  type: atomic
  statement: income_statement
  synonyms:
    - revenue
    - revenues
    - total_revenue
    - net_revenue
    - net_sales          # ← confirmed missing for ABNB
    - sales
    - total_net_revenue
    - us-gaap:Revenues
    - us-gaap:SalesRevenueNet
    - us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax  # ABNB's actual XBRL tag
```

After updating the YAML, verify the MetricRegistry reloads it (check startup logs for "Loaded N metrics"). If it doesn't reload automatically, restart the service.

---

### Fix 1.2 — Ticker Resolution Hardening
**File:** `src/rag/intent-detector.service.ts` · **Effort:** 3h · **Risk:** Low

ABNB is already caught by LLM Layer 3 after Fix 1.1. This fix moves ABNB and every future ticker to the sub-10ms regex fast-path, eliminating LLM fallback cost for known tickers.

**Why not a word filter:** Financial text is saturated with uppercase abbreviations — EBITDA, GAAP, Q4, FY, CEO would all become false-positive tickers. The correct Stage 2 is validation against your `companies` table, not a word list. Every future IPO is handled automatically — just add to the table, no code change.

#### Change 2a — Universal pattern + companies table validation set

```typescript
private knownTickers = new Set<string>(); // loaded from DB at startup

async onModuleInit(): Promise<void> {
  await this.loadKnownTickers();
}

private async loadKnownTickers(): Promise<void> {
  const companies = await this.prisma.company.findMany({ select: { ticker: true } });
  this.knownTickers = new Set(companies.map(c => c.ticker.toUpperCase()));
  this.fastPathCache?.setKnownTickers(this.knownTickers);
  this.logger.log(`Loaded ${this.knownTickers.size} tickers into validation set`);
}

@Cron('0 2 * * *')
async refreshTickerSet(): Promise<void> {
  await this.loadKnownTickers();
}

private extractTickersFromQuery(query: string): string[] {
  const candidates = new Set<string>();

  // Stage 1: Universal pattern — whitespace/punctuation bounded, 1-5 uppercase letters
  // Boundary requirement eliminates 'K' from '10-K', 'Q' from '10-Q'
  const pattern = /(?:^|[\s,(.])([A-Z]{1,5})(?=[\s,.)!?\n]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(query)) !== null) {
    candidates.add(m[1]);
  }

  // Stage 2: Validate against companies table — eliminates GAAP, EBITDA, CEO, FY, Q4
  return Array.from(candidates).filter(c => this.knownTickers.has(c));
}
```

---

### Fix 1.3 — VisualizationPayload Contract
**Files:** `src/rag/visualization.ts` · `src/rag/response-enrichment.service.ts` · **Effort:** 2.5h · **Risk:** Low

`RAGResponse.visualization` already exists as a stub. This defines it precisely and populates it from `MetricResult[]` data. The backend provides structured data and a chart type hint only — the frontend owns all rendering decisions.

#### Change 3a — Define VisualizationPayload (replace stub in visualization.ts)

```typescript
export type ChartType =
  | 'line' | 'bar' | 'grouped_bar' | 'stacked_bar' | 'waterfall' | 'table' | 'pie';

export interface VisualizationPayload {
  suggestedChartType: ChartType | null;     // hint from LLM — frontend decides final render
  data: {
    rows: Array<{
      ticker: string;
      period: string;
      filingType: string;
      metrics: Record<string, number | null>;  // canonical_id → value
    }>;
    columns: Array<{
      canonical_id: string;
      display_name: string;
      format: 'currency' | 'percentage' | 'ratio' | 'integer';
      unit_scale: 'ones' | 'thousands' | 'millions' | 'billions';
    }>;
  };
  meta: {
    title: string;
    tickers: string[];
    periods: string[];       // sorted ascending
    source: string;
    freshnessWarning?: string;
  };
}
```

#### Change 3b — Populate in ResponseEnrichmentService.enrichResponse()

```typescript
buildVisualizationPayload(
  metrics: MetricResult[],
  intent: QueryIntent,
): VisualizationPayload | undefined {

  if (!metrics.length || !intent.suggestedChart || intent.type === 'semantic')
    return undefined;

  // Merge rows by ticker+period (multiple metrics per data point)
  const rowMap = new Map<string, any>();
  for (const m of metrics) {
    const key = `${m.ticker}|${m.fiscalPeriod}`;
    if (!rowMap.has(key)) rowMap.set(key, {
      ticker: m.ticker, period: m.fiscalPeriod,
      filingType: m.filingType, metrics: {}
    });
    rowMap.get(key).metrics[m.normalizedMetric] = m.value;
  }

  const periods = [...new Set(metrics.map(m => m.fiscalPeriod))]
    .sort((a, b) => this.parseSortKey(a) - this.parseSortKey(b));

  return {
    suggestedChartType: intent.suggestedChart as ChartType,
    data: {
      rows: Array.from(rowMap.values()),
      columns: [...new Set(metrics.map(m => m.normalizedMetric))].map(id => ({
        canonical_id: id,
        display_name: metrics.find(m => m.normalizedMetric === id)?.displayName ?? id,
        format: this.inferFormat(id),
        unit_scale: this.inferScale(metrics, id),
      })),
    },
    meta: {
      title: this.buildTitle(intent, metrics),
      tickers: [...new Set(metrics.map(m => m.ticker))],
      periods,
      source: 'SEC 10-K / 10-Q filings',
      freshnessWarning: this.buildFreshnessWarning(metrics),
    },
  };
}
```

---

---

## PART II — HYBRID SYNTHESIS SERVICE
### Sprint 2 · ~1 week · 2 engineers

This is the intelligence layer that separates FundLens from a Bloomberg Terminal search box. Without it, the system retrieves correctly but synthesizes poorly — numbers without context, context without grounding.

`RAGService.buildAnswer()` currently has three branches that concatenate data into markdown. The Bedrock `generate()` call receives metrics and narratives as blobs with no financial reasoning structure. `HybridSynthesisService` replaces both with a prompt that forces the LLM to reason in a defined five-step sequence.

---

### 2.1 Service Architecture

**New file:** `src/rag/hybrid-synthesis.service.ts`

```typescript
@Injectable()
export class HybridSynthesisService {
  constructor(
    private readonly bedrock: BedrockService,
    private readonly performanceOptimizer: PerformanceOptimizerService,
  ) {}

  async synthesize(context: FinancialAnalysisContext): Promise<SynthesisResult> {
    const prompt = this.buildStructuredPrompt(context);
    const modelId = this.performanceOptimizer.getModelId(context.modelTier);
    const response = await this.bedrock.invokeClaude({ prompt, modelId, max_tokens: 1200 });
    return this.parseSynthesisResponse(response, context);
  }
}

export interface FinancialAnalysisContext {
  originalQuery:    string;
  intent:           QueryIntent;
  metrics:          MetricResult[];
  narratives:       ChunkResult[];
  computedResults:  ComputedMetricResult[];
  peerData?:        PeerComparisonResult;
  subQueryResults?: SubQueryResult[];     // from QueryDecomposer (Part III)
  modelTier:        'haiku' | 'sonnet' | 'opus';
  tenantId?:        string;
}
```

---

### 2.2 The Structured Synthesis Prompt

The current `bedrock.generate()` passes metrics and narratives as raw data. This prompt replaces it with five explicit reasoning steps the LLM must complete in sequence. This is the single highest-leverage change for response quality.

```typescript
private buildStructuredPrompt(ctx: FinancialAnalysisContext): string {
  return `You are a senior equity analyst at a top-tier investment bank.
Your answers are cited, precise, and direct. You never pad.

═══ SECTION 1: QUANTITATIVE DATA (treat as ground truth) ═══
${this.formatMetricsTable(ctx.metrics, ctx.computedResults)}

═══ SECTION 2: MANAGEMENT NARRATIVE (SEC Filing Excerpts) ═══
${ctx.narratives.map(n =>
  `[${n.metadata.ticker} | ${n.metadata.sectionType} | ${n.metadata.fiscalPeriod}]\n${n.content}`
).join('\n\n')}

${ctx.peerData ? `═══ SECTION 3: PEER COMPARISON ═══\n${this.formatPeerTable(ctx.peerData)}` : ''}

═══ ANALYST REQUEST ═══
${ctx.originalQuery}

═══ REQUIRED REASONING STEPS ═══
Complete these steps in order. Do not skip any step.

STEP 1 — QUANTITATIVE FACTS
State the numbers. Cite ticker, metric, period, value.
Do not interpret yet. Numbers only.

STEP 2 — NARRATIVE SUMMARY
Summarize what management says about the subject.
One paragraph. Direct attribution to filing section.

STEP 3 — RECONCILIATION
Where do the numbers and the narrative align?
Where do they diverge or contradict? Be explicit.
If they fully align, say so and explain why that increases confidence.

STEP 4 — CONCLUSION
State your analytical conclusion in one sentence.
Name the single most important assumption it rests on.

STEP 5 — PROVOCATION
Generate exactly one analyst-grade challenge question.
It must be grounded in a specific tension from Steps 1–4.
It must be a question a fund manager would actually ask.
Not generic. Not "what are the risks?"`;
}
```

---

### 2.3 ResponseType Taxonomy

Add to `query-intent.ts`:

```typescript
export type ResponseType =
  | 'STRUCTURED_ONLY'     // single metric, single company, no narrative needed
  | 'COMPUTED_ONLY'       // computed metric — show formula audit trail
  | 'HYBRID_SYNTHESIS'    // data + narrative, single company — 5-step output
  | 'PEER_COMPARISON'     // multiple tickers, same metric(s)
  | 'TIME_SERIES'         // single metric, N periods
  | 'CONCEPT_ANALYSIS'    // ConceptRegistry match (leverage, liquidity, profitability)
  | 'DECOMPOSED_HYBRID'   // multi-part query — tabbed response per sub-query
  | 'NARRATIVE_ONLY';     // semantic only, no metrics returned
```

Frontend rendering contract per type:

| ResponseType | Frontend Render |
|---|---|
| STRUCTURED_ONLY | Metric card + source citation + optional bar chart |
| COMPUTED_ONLY | Metric card + formula audit trail expanded by default |
| HYBRID_SYNTHESIS | Left: data table. Right: 5-step prose output |
| PEER_COMPARISON | Comparison table + grouped bar + rank callout |
| TIME_SERIES | Line chart + table + YoY growth column |
| CONCEPT_ANALYSIS | Multi-metric dashboard + 5-step synthesis |
| DECOMPOSED_HYBRID | Tabbed: one tab per sub-query + unified conclusion tab |
| NARRATIVE_ONLY | Prose with SEC filing citations |

---

### 2.4 Wire HybridSynthesisService into RAGService

Replace the `bedrock.generate()` call and `buildAnswer()` branches in `rag.service.ts`:

```typescript
// BEFORE:
// const generated = await this.bedrock.generate(query, { metrics, narratives, ... });
// answer = generated.answer;

// AFTER:
const context: FinancialAnalysisContext = {
  originalQuery: query,
  intent,
  metrics,
  narratives,
  computedResults,
  peerData: peerResult ?? undefined,
  modelTier: optimizationDecisions.modelTier,
  tenantId: options?.tenantId,
};

const synthesis = await this.hybridSynthesis.synthesize(context);
answer    = synthesis.answer;
usage     = synthesis.usage;
citations = synthesis.citations;
```

---

### 2.5 PE Extensibility — Tenant Overlay

No code changes required for Third Avenue Management — YAML only:

```typescript
// In buildStructuredPrompt(), inject PE context when tenant overlay detected:
const overlay = this.tenantOverlayLoader.getOverlay(ctx.tenantId);
if (overlay?.asset_class === 'private_equity') {
  prompt += `\n\nPE CONTEXT:\n${overlay.synthesis_instructions}`;
}
```

```yaml
# yaml-registries/third_avenue.yaml (synthesis_instructions field)
synthesis_instructions: |
  - Use LTM EBITDA, not trailing fiscal year
  - Reference leverage at entry vs current leverage in all credit discussions
  - Flag covenant headroom when debt metrics are present
  - Use 'distributable cash' instead of 'free cash flow' per client terminology
```

---

---

## PART III — LEVEL 3–4 QUERY COMPLEXITY
### Sprint 3 · ~1 week · 2 engineers

**Level 3:** queries where the right follow-up retrieval depends on what was initially found.
**Level 4:** multi-part questions requiring decomposition, ordered execution, and unified synthesis.

**Level 5 (sector screening) is explicitly out of scope for this sprint.** It requires a peer universe registry and batch retrieval optimization. Documented separately.

---

### 3.1 QueryDecomposer

A single LLM call that decides: is this one coherent question, or 2–3 distinct information needs that should be answered separately and unified?

#### When Decomposition Is Triggered

| Query Pattern | Decompose? |
|---|---|
| "What is ABNB latest revenue?" | No — single information need |
| "Compare ABNB and BKNG gross margins over 3 years" | No — multi-ticker but single question |
| "What are ABNB's margins AND what does management say drives them?" | Yes → 2 sub-queries |
| "Model ABNB path to 30% EBITDA: what assumptions, what are the risks?" | Yes → 3 sub-queries |
| "How does ABNB's take rate compare to peers, and is it sustainable?" | Yes → 2 sub-queries |

#### Implementation

**New file:** `src/rag/query-decomposer.service.ts`

```typescript
@Injectable()
export class QueryDecomposerService {

  async decompose(query: string, intent: QueryIntent): Promise<DecomposedQuery> {
    // Fast-path: single-intent queries skip the LLM call entirely
    if (this.isSingleIntent(intent)) {
      return { isDecomposed: false, subQueries: [], originalQuery: query };
    }

    const prompt = this.buildDecompositionPrompt(query, intent);
    const response = await this.bedrock.invokeClaude({
      prompt, modelId: HAIKU_MODEL, max_tokens: 400,
    });

    return this.parseDecomposition(response, query);
  }

  private isSingleIntent(intent: QueryIntent): boolean {
    const hasCompoundMarkers = /\b(and|also|as well as|additionally|plus|both)\b/i
      .test(intent.originalQuery);
    const isCompound = intent.needsNarrative && intent.needsComputation;
    return !hasCompoundMarkers && !isCompound;
  }

  private buildDecompositionPrompt(query: string, intent: QueryIntent): string {
    return `You are a query planner for a financial research platform.
Given this analyst query, determine if it contains multiple distinct information needs.

QUERY: "${query}"

RULES:
- If the query has 1 information need: respond { "isDecomposed": false, "subQueries": [] }
- If the query has 2-3 information needs: extract each as a standalone query.
  Each sub-query must be independently answerable.
  Preserve company names and periods from the original query in each sub-query.
  Order sub-queries by dependency: quantitative data before qualitative analysis.
- Maximum 3 sub-queries. If more are needed, compress into 3.

RESPOND ONLY WITH JSON:
{
  "isDecomposed": boolean,
  "subQueries": string[],
  "unifyingInstruction": string
}`;
  }
}

export interface DecomposedQuery {
  isDecomposed: boolean;
  subQueries: string[];
  unifyingInstruction?: string;
  originalQuery: string;
}
```

---

### 3.2 Bounded Agentic Retrieval Loop

For Level 3–4 queries, the right follow-up retrieval depends on what was found. The loop is bounded at **3 iterations maximum**.

```typescript
// In RAGService.query(), after initial retrieval:

const MAX_RETRIEVAL_ITERATIONS = 3;
let iteration = 0;
let retrievalComplete = false;

while (!retrievalComplete && iteration < MAX_RETRIEVAL_ITERATIONS) {
  iteration++;

  if (iteration > 1) {
    const replanPrompt = this.buildReplanPrompt(query, intent, metrics, narratives);
    const replanResult = await this.bedrock.invokeClaude({
      prompt: replanPrompt, modelId: HAIKU_MODEL, max_tokens: 300,
    });
    const additionalPlan = this.parseReplanResult(replanResult);

    if (!additionalPlan.needsMoreData) {
      retrievalComplete = true;
      break;
    }

    const additionalMetrics    = await this.structuredRetriever.retrieve(additionalPlan.structuredQuery);
    const additionalNarratives = additionalPlan.semanticQuery
      ? await this.semanticRetriever.retrieveWithContext(additionalPlan.semanticQuery)
      : { narratives: [] };

    metrics    = [...metrics, ...additionalMetrics.metrics];
    narratives = [...narratives, ...additionalNarratives.narratives];
  } else {
    retrievalComplete = this.isRetrievalComplete(intent, metrics, narratives);
  }
}

this.logger.log(`Retrieval complete after ${iteration} iteration(s)`);
```

#### Completeness Evaluator and Replanner

```typescript
private buildReplanPrompt(
  query: string, intent: QueryIntent,
  metrics: MetricResult[], narratives: ChunkResult[],
): string {
  return `You are a financial research assistant evaluating retrieval completeness.

ORIGINAL QUERY: "${query}"

DATA RETRIEVED SO FAR:
Metrics: ${metrics.map(m => `${m.ticker} ${m.normalizedMetric} ${m.fiscalPeriod}: ${m.value}`).join(', ')}
Narrative sections: ${narratives.map(n => n.metadata.sectionType).join(', ')}

QUESTION: Is there specific additional data needed to fully answer the query?
Be conservative — only request more data if clearly necessary.

RESPOND WITH JSON ONLY:
{
  "needsMoreData": boolean,
  "reason": string,
  "additionalMetrics": string[],
  "additionalTickers": string[],
  "additionalSections": string[]
}`;
}

private isRetrievalComplete(
  intent: QueryIntent, metrics: MetricResult[], narratives: ChunkResult[],
): boolean {
  if (intent.needsComputation && metrics.length === 0) return false;
  if (intent.needsNarrative && narratives.length === 0) return false;
  const requestedTickers = Array.isArray(intent.ticker) ? intent.ticker : [intent.ticker];
  const foundTickers = new Set(metrics.map(m => m.ticker));
  if (requestedTickers.some(t => t && !foundTickers.has(t))) return false;
  return true;
}
```

---

### 3.3 Wire QueryDecomposer into RAGService

```typescript
// In RAGService.query(), between Step 1 (route) and Step 2 (retrieve):

const decomposed = await this.queryDecomposer.decompose(query, intent);

if (decomposed.isDecomposed) {
  const subResults = await this.executeSubQueries(
    decomposed.subQueries, options, intent,
  );
  context.subQueryResults = subResults;
  context.unifyingInstruction = decomposed.unifyingInstruction;

  // HybridSynthesisService detects subQueryResults and uses unifying synthesis prompt
  return this.hybridSynthesis.synthesize(context);
}

// Single-intent: continue with standard bounded retrieval loop (Section 3.2)
```

---

### 3.4 Grounded Provocation

When `peerData` is present, Step 5 of the synthesis prompt becomes:

```
STEP 5 — PROVOCATION (PEER-GROUNDED)
Generate exactly one challenge question.
It must reference a specific divergence between [SUBJECT] and a named peer.
It must be a question a portfolio manager would ask at an investment committee.
Example format: "Given that [PEER] achieved [X] while [SUBJECT] achieved [Y] in [PERIOD],
what explains the gap and is it structural or cyclical?"
```

---

---

## PART IV — PEER COMPARISON ENGINE
### Sprint 3 · concurrent · 2 engineers

---

### 4.1 Peer Universe Registry

**New file:** `yaml-registries/peer_universes.yaml`

```yaml
online_travel:
  display_name: Online Travel & Experiences
  gics_subindustry: Hotels, Resorts & Cruise Lines
  members: [ABNB, BKNG, EXPE, TRIP]
  primary_metrics: [revenue, gross_profit_margin, take_rate]
  normalization_basis: LTM

us_mega_cap_tech:
  display_name: US Mega-Cap Technology
  members: [AAPL, MSFT, GOOGL, AMZN, META, NVDA]
  primary_metrics: [revenue, operating_income_margin, free_cash_flow, rd_expense]
  normalization_basis: FY

third_avenue_portfolio:
  display_name: Third Avenue Active Portfolio
  members: []                    # populated dynamically from third_avenue.yaml
  primary_metrics: [net_debt_to_ebitda, interest_coverage, free_cash_flow]
  normalization_basis: LTM
```

---

### 4.2 PeerComparisonService

**New file:** `src/rag/peer-comparison.service.ts`

```typescript
@Injectable()
export class PeerComparisonService {

  async compare(
    tickers: string[],
    metrics: MetricResolution[],
    period: string,
    normalizationBasis: 'FY' | 'LTM' | 'CY',
  ): Promise<PeerComparisonResult> {

    // Fetch all tickers × all metrics in parallel
    const fetchTasks = tickers.flatMap(ticker =>
      metrics.map(m =>
        this.structuredRetriever.getLatestByFilingType(ticker, m, '10-K')
          .then(r => ({ ticker, metric: m.canonical_id, result: r }))
      )
    );
    const raw = await Promise.all(fetchTasks);

    const normalized = this.normalizePeriods(raw, normalizationBasis);
    return this.buildComparisonResult(normalized, tickers, metrics);
  }

  private normalizePeriods(raw: any[], basis: string): any[] {
    if (basis === 'FY') return raw;
    if (basis === 'LTM') {
      // Sum trailing 4 quarters per company
      // Flag when FY ends differ by > 60 days in freshnessWarning
      return raw.map(r => this.computeLTM(r));
    }
    return raw;
  }
}

export interface PeerComparisonResult {
  metric:              string;
  normalizationBasis:  'FY' | 'LTM' | 'CY';
  period:              string;
  rows:                Array<{ ticker: string; value: number | null; rank: number }>;
  median:              number;
  mean:                number;
  subjectTicker?:      string;
  subjectRank?:        number;
  subjectVsMedianPct?: number;
  fyMismatchWarning?:  string;
}
```

---

### 4.3 QueryRouter — Peer Universe Resolution

```typescript
// In QueryRouterService.buildStructuredPlan(), after normalizeTickers():

if (intent.needsPeerComparison && tickers.length <= 1) {
  const universe = this.peerRegistry.findUniverse(tickers[0], intent.originalQuery);
  if (universe) {
    tickers = universe.members;
    this.logger.log(`Peer universe resolved: ${universe.display_name} (${tickers.join(', ')})`);
  }
}
```

---

---

## PART V — RELIABILITY PILLARS

---

### 5.1 Pre-Write Validation at Ingestion

Apply in `sec-processing.service.ts` and `metrics.service.ts` before every `financialMetric.create()`:

| Validation Rule | Implementation | Action on Fail |
|---|---|---|
| Normalization consistency | Apply shared `normalizeForStorage()` before write | Write normalized form, log original |
| Range check (>5σ from historical mean) | Compare to last 8 periods same company/metric | Flag for review, write with low confidence score |
| Sign convention | Check `metric.sign_convention` from YAML registry | Invert if needed, log correction |
| Cross-statement reconciliation | Net income IS = Net income CF ± rounding | Flag discrepancy, prefer IS value |
| XBRL tag validation | Map `us-gaap:Revenues` → `revenue` canonical_id | Store both raw tag and canonical_id |

---

### 5.2 Post-Retrieval Validation

```typescript
// In StructuredRetrieverService, before returning any MetricResult:

private validateResult(result: MetricResult, resolution: MetricResolution): boolean {
  if (result.value === null || result.value === undefined) return false;
  if (!this.parseFiscalPeriodSortKey(result.fiscalPeriod)) return false;
  if ((result.confidenceScore ?? 0) < 0.70) return false;
  if (resolution.statement === 'income_statement' && result.filingType === '8-K') {
    result.displayName = `${result.displayName} ⚠️ (press release, unaudited)`;
  }
  return true;
}
```

---

### 5.3 Graceful Degradation — Never Silent Failure

Replace `buildNoDataMessage()` with a context-aware response:

```typescript
buildDegradationResponse(
  intent: QueryIntent,
  resolvedMetrics: MetricResolution[],
  foundMetrics: MetricResult[],
): string {
  const found      = resolvedMetrics.filter(r => r.confidence !== 'unresolved' &&
    foundMetrics.some(m => m.normalizedMetric === r.canonical_id));
  const missing    = resolvedMetrics.filter(r => r.confidence !== 'unresolved' &&
    !foundMetrics.some(m => m.normalizedMetric === r.canonical_id));
  const unresolved = resolvedMetrics.filter(r => r.confidence === 'unresolved');

  const lines: string[] = [];

  if (found.length > 0)
    lines.push(`Found: ${found.map(r => r.display_name).join(', ')}.`);

  for (const m of missing)
    lines.push(`${m.display_name}: recognized but not found in filings for ${
      Array.isArray(intent.ticker) ? intent.ticker.join('/') : intent.ticker}. ` +
      `This metric may not be separately reported by this company.`);

  for (const m of unresolved)
    lines.push(`"${m.original_query}": not recognized. ` +
      (m.suggestions?.length
        ? `Did you mean: ${m.suggestions.map(s => s.display_name).join(', ')}?`
        : ''));

  return lines.join('\n');
}
```

---

### 5.4 Observability Signals

| Signal | Where Emitted | Action |
|---|---|---|
| Metric not found in DB | `structuredRetriever` → null return | Log to `metric_misses`; trigger MetricLearningService |
| Unresolved metric query | MetricRegistry confidence=unresolved | Log + suggest YAML synonym addition |
| Retrieval loop > 1 iteration | RAGService loop counter | Log query + iteration count |
| Decomposed query executed | QueryDecomposer output | Log sub-query count + unifyingInstruction |
| Analyst thumbs-down | Frontend feedback event | Store in `accuracy_feedback`; flag for review |
| Ticker extracted but not in companies table | `extractTickersFromQuery()` | Log to `ticker_miss_log` |

---

---

## PART VI — SPRINT PLAN

### Sprint 1 — Foundation (~10 hours, 1 engineer)
Goal: ABNB query works. All tickers work at regex speed. Charts have a stable frontend contract.

| # | Task | File | Hours | Risk |
|---|---|---|---|---|
| 1 | db_column wiring: MetricResolution signature, synonym-based IN clause, sort fix, computed routing | `structured-retriever.service.ts` | 3h | Low |
| 1b | Add getSynonymsForDbColumn() to MetricRegistryService; delete metricTranslation map | `metric-registry.service.ts` | 1h | Low |
| 1c | Add net_sales + missing synonyms to income_statement.yaml (audit DB first) | `income_statement.yaml` | 30m | Low |
| 2 | Universal ticker pattern + companies table validation set | `intent-detector.service.ts` | 3h | Low |
| 3 | VisualizationPayload contract + ResponseEnrichment population | `visualization.ts` + `response-enrichment.service.ts` | 2.5h | Low |
| 4 | Context-aware degradation response builder | `response-enrichment.service.ts` | 1h | Low |
| 5 | Post-retrieval validation gate | `structured-retriever.service.ts` | 30m | Low |

### Sprint 2 — Intelligence Layer (~1 week, 2 engineers)
Goal: Hybrid synthesis replaces freeform generation. ResponseType drives frontend rendering. PE overlay wired for Third Avenue.

| # | Task | File | Hours | Risk |
|---|---|---|---|---|
| 6 | HybridSynthesisService with 5-step structured prompt | `hybrid-synthesis.service.ts` (NEW) | 1d | Medium |
| 7 | FinancialAnalysisContext interface + wire into RAGService | `rag.service.ts` | 4h | Medium |
| 8 | ResponseType enum + enrichResponse() | `query-intent.ts` + `response-enrichment.service.ts` | 4h | Low |
| 9 | PE tenant overlay (third_avenue.yaml) | `hybrid-synthesis.service.ts` | 2h | Low |
| 10 | Pre-write ingestion validation | `sec-processing.service.ts` + `metrics.service.ts` | 1d | Medium |

### Sprint 3 — Level 3–4 Complexity + Peer Comparison (~1 week, 2 engineers)
Goal: Multi-part queries decompose and execute correctly. Peer comparison is sector-aware. Retrieval adapts to what was found.

| # | Task | File | Hours | Risk |
|---|---|---|---|---|
| 11 | QueryDecomposerService + isSingleIntent() fast-path | `query-decomposer.service.ts` (NEW) | 1d | Medium |
| 12 | Bounded agentic retrieval loop (max 3 iterations) | `rag.service.ts` | 1d | Medium |
| 13 | Sub-query execution + unified synthesis wiring | `rag.service.ts` + `hybrid-synthesis.service.ts` | 4h | Medium |
| 14 | PeerComparisonService + peer_universes.yaml | `peer-comparison.service.ts` (NEW) | 1.5d | Medium |
| 15 | QueryRouter peer universe resolution | `query-router.service.ts` | 3h | Low |
| 16 | Grounded provocation (peer-aware Step 5) | `hybrid-synthesis.service.ts` | 2h | Low |

---

---

## PART VII — DEFINITION OF DONE

### Sprint 1 Tests

```
T1.1  Query: "What is the latest Revenue for ABNB?"
      Expected: MetricResult{ ticker:'ABNB', value:<non-null>, fiscalPeriod:'FY2024' }
      Expected: RAGResponse.answer contains actual dollar figure (not "No Data Available")
      Expected: visualization.suggestedChartType = 'bar'
      Expected: DB query used IN clause with synonyms (check logs — should show 'net_sales' in the list)
      Failure:  "No Data Available" OR answer with null value OR synonym list missing 'net_sales'
      Debug:    If still failing, run Step 3b query and check that the matched synonym
                exists in getSynonymsForDbColumn('revenue') output

T1.2  Query: "What is COIN gross margin FY2024?"
      Expected: intent.ticker = 'COIN' via regex fast-path, confidence >= 0.9

T1.3  Query: "GAAP vs non-GAAP operating income for MSFT"
      Expected: intent.ticker = 'MSFT' only (GAAP rejected by companies table validation)

T1.4  Query: "What did the 10-K say about risks?"
      Expected: intent.ticker = undefined (K not extracted — bounded by hyphen)

T1.5  DB has ABNB: FY2024 (annual), Q1FY2025, Q2FY2025, Q3FY2025
      Query: "Latest ABNB quarterly revenue"
      Expected: Returns Q3FY2025 (not FY2024 — fiscal period sort fix)

T1.6  Query: "ABNB EBITDA margin FY2024" (computed metric)
      Expected: FormulaResolutionService called (not DB direct lookup)
      Expected: MetricResult.statementType = 'computed' with audit trail
```

### Sprint 2 Tests

```
T2.1  Query: "How is ABNB's revenue trending and what does management say drives it?"
      Expected: responseType = 'HYBRID_SYNTHESIS'
      Expected: answer contains STEP 1 (numbers), STEP 2 (narrative), STEP 3 (reconciliation)
      Expected: answer ends with a specific provocation (not generic)

T2.2  Query: "How levered is ABNB?" (ConceptRegistry match)
      Expected: responseType = 'CONCEPT_ANALYSIS'
      Expected: metrics include net_debt_to_ebitda, debt_to_equity, interest_coverage

T2.3  Third Avenue query: "What is portfolio company X's distributable cash?"
      Expected: Resolved to free_cash_flow via third_avenue.yaml overlay
      Expected: synthesis prompt includes PE context instructions
```

### Sprint 3 Tests

```
T3.1  Query: "What are ABNB's EBITDA margins AND what does management say drives them?"
      Expected: QueryDecomposer produces 2 sub-queries
      Expected: responseType = 'DECOMPOSED_HYBRID'

T3.2  Query: "Model ABNB's path to 30% EBITDA margins — what assumptions are needed?"
      Expected: QueryDecomposer produces 3 sub-queries
      Expected: Retrieval loop iterates <= 3 times

T3.3  Query: "How does ABNB compare to its online travel peers on margins?"
      Expected: PeerComparisonService resolves online_travel universe [ABNB, BKNG, EXPE, TRIP]
      Expected: PeerComparisonResult includes subjectRank and subjectVsMedianPct
      Expected: visualization.suggestedChartType = 'grouped_bar'
```

### Latency Targets

```
Simple structured query (T1.1 class):      p50 < 800ms,  p99 < 1500ms
Hybrid single-intent (T2.1 class):         p50 < 2500ms, p99 < 4000ms
Decomposed multi-part (T3.1 class):        p50 < 4000ms, p99 < 6000ms
(All p99 targets exclude Bedrock cold start)
```

---

---

## ARCHITECTURE AT COMPLETION

```
ENTRY
  Analyst Query

PLANNING
  IntentDetectorService
    Layer 1: Regex fast-path [universal pattern + companies table validation]
    Layer 2: FastPathCache [LRU, 5000 entries]
    Layer 3: Claude Haiku classifier

  [NEW] QueryDecomposerService
    → DecomposedQuery { isDecomposed, subQueries[], unifyingInstruction }

  QueryRouterService
    → MetricRegistryService.resolveMultiple() → MetricResolution[db_column]
    → [WIRED] ConceptRegistryService → sector-filtered metric bundle
    → [NEW] PeerRegistryService → peer universe when needsPeerComparison=true

RETRIEVAL  (parallel execution, bounded loop ≤ 3 iterations)
  ├── [FIXED] StructuredRetriever → db_column WHERE, sort fix, computed routing → MetricResult[]
  ├── [WIRED] FormulaResolutionService → DAG → Python /calculate → ComputedMetricResult[]
  ├── SemanticRetriever → Bedrock KB → ChunkResult[]
  ├── [NEW] PeerComparisonService → LTM normalization → PeerComparisonResult
  └── [NEW] Completeness evaluator → replan if incomplete → iterate

SYNTHESIS
  [NEW] HybridSynthesisService
    → FinancialAnalysisContext
    → 5-step structured prompt (facts → narrative → reconciliation → conclusion → provocation)
    → Sonnet / Opus (complexity-tiered)
    → [NEW] PE tenant overlay from third_avenue.yaml

RESPONSE
  RAGResponse {
    answer
    responseType          ← NEW
    metrics
    narratives
    visualization         ← FIXED (VisualizationPayload contract)
    peerComparison        ← NEW
    computedAuditTrail    ← NEW
    provocations[]        ← GROUNDED in retrieved data
    dataFreshness
    citations[]
  }
```

---

*FundLens Platform · Master Engineering Spec · February 2026 · Confidential*
