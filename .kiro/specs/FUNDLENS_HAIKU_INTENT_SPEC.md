# FundLens RAG ChatBot — Haiku-First Intent Detection
### Kiro Implementation Guide · Sprint 0.5 (Pre-Sprint 1) · February 2026 · Confidential

---

## KIRO SESSION INSTRUCTIONS

> This spec is an **addendum** to the Master Engineering Spec (`fundlens_kiro_spec.md`).
> It replaces **Fix 1.2 (Ticker Resolution Hardening)** and modifies the **IntentDetectorService Layer 1**
> from regex-based extraction to Haiku-first structured extraction with deterministic validation.
>
> **Everything else in the Master Spec remains unchanged.** MetricRegistryService, FormulaResolutionService,
> StructuredRetriever db_column wiring, HybridSynthesisService, QueryDecomposerService,
> PeerComparisonService, VisualizationPayload — all untouched.
>
> Read the entire document before writing code. Implement in session order.

---

### What This Spec Changes

| Master Spec Section | What Changes | Why |
|---|---|---|
| Fix 1.2 — Ticker Resolution Hardening | **Replaced entirely.** Regex extraction (`extractTickersFromQuery()`) is eliminated as the primary extraction mechanism. Haiku becomes the front door. | Regex fails on: single-letter tickers ("C" → Citigroup), lowercase input ("abnb"), company-name-to-ticker resolution ("amazon" → AMZN), multi-entity comparative queries, ambiguous metric names, natural language time periods ("past five years"). These are open-world linguistic problems that regex cannot solve at scale. |
| IntentDetectorService Layer 1 | **Restructured.** Layer 1 becomes Haiku structured extraction. Layer 2 remains LRU cache (now caches Haiku JSON output). Layer 3 becomes deterministic validation (Postgres companies table + MetricRegistryService). | The old architecture made Haiku a fallback. The new architecture makes Haiku the primary parser and deterministic systems the validation/enrichment layer. |
| Architecture diagram (Part VI) | **Updated.** Planning section reflects new flow. | Reflects actual system. |

### What This Spec Does NOT Change

- Fix 1.1 — Wire MetricResolution.db_column (proceed as written)
- Fix 1.3 — VisualizationPayload contract (proceed as written)
- Part II — HybridSynthesisService (proceed as written)
- Part III — QueryDecomposerService + bounded retrieval loop (proceed as written)
- Part IV — PeerComparisonService (proceed as written)
- Part V — Reliability pillars (proceed as written)
- MetricRegistryService + YAML registries + `getSynonymsForDbColumn()` — still needed
- FormulaResolutionService — still needed
- ConceptRegistryService — still needed
- All Sprint 2 and Sprint 3 tasks — proceed as written

---

### Session Order (This Spec Only)

| Session | Scope | Gate |
|---|---|---|
| 0.5a | Schema discovery (same as Master Spec Step 1–5) → Create `HaikuIntentParserService` | Unit test: parse "What is C's revenue?" → ticker: C, company: Citigroup, metric: revenue |
| 0.5b | Wire `HaikuIntentParserService` into `IntentDetectorService` replacing regex Layer 1 | T0.1–T0.8 all pass (see Definition of Done below) |
| 0.5c | Add LRU cache for Haiku JSON output + Bedrock fallback | Cache hit returns same QIO; Bedrock failure returns fallback result |
| 0.5d | Run eval dataset (200+ queries) → tune system prompt | ≥95% accuracy on eval set |

After Session 0.5d passes, proceed to Master Spec Session 1 (Fix 1.1 — db_column wiring).

### Files Per Session

**Session 0.5a–0.5b only:**
- `src/rag/haiku-intent-parser.service.ts` (NEW — primary file)
- `src/rag/intent-detector.service.ts` (MODIFIED — rewire Layer 1)
- `src/rag/types/query-intent-object.ts` (NEW — QIO type definition)
- Do not touch any other files.

**Session 0.5c:**
- `src/rag/intent-detector.service.ts` (add cache + fallback logic)

---

---

## PART 0 — ARCHITECTURE DECISION: WHY HAIKU-FIRST

### The Problem With Regex-First

The current `IntentDetectorService` uses a regex fast-path as Layer 1:

```typescript
// Current Layer 1: regex extraction
const pattern = /(?:^|[\s,(.])([A-Z]{1,5})(?=[\s,.)!?\n]|$)/g;
```

This fails on the following classes of queries that FundLens analysts will routinely ask:

| Query | Expected | Regex Result | Failure Mode |
|---|---|---|---|
| "what is c's growth over past five years?" | Ticker: C (Citigroup) | No match — "c" is lowercase | Case sensitivity |
| "how does amazon compare to nvidia?" | Tickers: AMZN, NVDA | No match — company names, not tickers | Name-to-ticker resolution |
| "abnb revenue" | Ticker: ABNB | No match — lowercase | Case sensitivity |
| "What is V's PE ratio?" | Ticker: V (Visa) | Matches V but also matches PE | Single-letter + financial acronym collision |
| "compare ROIC and net sales for AMZN vs NVDA" | Metrics: ROIC, Net Sales; Tickers: AMZN, NVDA | Extracts ROIC as ticker candidate | Metric/ticker ambiguity |
| "what are revenues over the past 5 years for Airbnb?" | Ticker: ABNB; Period: 5Y lookback | No ticker match — "Airbnb" not a ticker | Company name resolution |
| "How does BKNG's take rate compare to peers?" | Ticker: BKNG; Query type: peer comparison | Extracts BKNG only; misses peer intent | Intent classification |

These are not edge cases — they represent how investment professionals naturally phrase questions. At 100+ firms, these patterns will appear in the first week of deployment.

### The Architecture

```
BEFORE (Master Spec):
  Query → Regex extraction (Layer 1) → LRU Cache (Layer 2) → Haiku fallback (Layer 3)

AFTER (This Spec):
  Query → Normalize + Cache check (Layer 1) → Haiku structured extraction (Layer 2) → Deterministic validation (Layer 3)
```

```
┌─────────────────────────────────────────────────────────────────────┐
│ INTENT DETECTION PIPELINE (REVISED)                                 │
│                                                                     │
│  Analyst Query                                                      │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────────────────┐                                           │
│  │ Layer 1: Pre-Filter   │  ~2ms                                    │
│  │ • Normalize whitespace│                                          │
│  │ • Compute query hash  │                                          │
│  │ • LRU cache lookup    │──── HIT ──→ Return cached QIO            │
│  └──────────┬───────────┘                                           │
│             │ MISS                                                   │
│             ▼                                                        │
│  ┌──────────────────────┐                                           │
│  │ Layer 2: Haiku        │  ~200-500ms                              │
│  │ Structured Extraction │                                          │
│  │ • Strict JSON schema  │                                          │
│  │ • Tickers, metrics,   │                                          │
│  │   time, query type    │                                          │
│  │ • Company→ticker map  │                                          │
│  └──────────┬───────────┘                                           │
│             │                                                        │
│             ▼                                                        │
│  ┌──────────────────────┐                                           │
│  │ Layer 3: Deterministic│  ~3-10ms                                 │
│  │ Validation + Enrich   │                                          │
│  │ • Postgres companies  │                                          │
│  │   table validation    │                                          │
│  │ • MetricRegistry      │                                          │
│  │   canonical resolution│                                          │
│  │ • Time period clamp   │                                          │
│  │ • Fuzzy ticker match  │                                          │
│  └──────────┬───────────┘                                           │
│             │                                                        │
│             ▼                                                        │
│  ┌──────────────────────┐                                           │
│  │ Validated QIO         │──→ Cache it ──→ Pass to QueryRouter      │
│  └──────────────────────┘                                           │
│                                                                     │
│  ┌──────────────────────┐                                           │
│  │ FALLBACK (Bedrock     │  Only if Layer 2 fails (timeout/error)   │
│  │ outage):              │                                          │
│  │ • Simplified regex    │                                          │
│  │ • Uppercase tickers   │                                          │
│  │ • Exact metric names  │                                          │
│  │ • Handles ~60% of     │                                          │
│  │   queries gracefully  │                                          │
│  └──────────────────────┘                                           │
└─────────────────────────────────────────────────────────────────────┘
```

### Latency Budget

| Component | p50 | p99 | Notes |
|---|---|---|---|
| Pre-filter + cache check | 1ms | 3ms | In-memory hash + LRU lookup |
| Cache hit path (total) | 1ms | 5ms | ~60-80% of queries at steady state |
| Haiku extraction (Bedrock) | 250ms | 600ms | Cache miss path only |
| Deterministic validation | 3ms | 10ms | Postgres lookup + MetricRegistry resolve |
| Cache miss path (total) | 260ms | 620ms | ~20-40% of queries |
| **Weighted average (70% hit)** | **~80ms** | **~190ms** | Invisible in 2-6s overall pipeline |

### Cost Budget

| Scale | Queries/Day | Haiku Calls/Day (30% miss) | Daily Cost | Monthly Cost |
|---|---|---|---|---|
| 10 firms (launch) | 5,000 | 1,500 | $0.60 | $18 |
| 50 firms | 25,000 | 7,500 | $3.00 | $90 |
| 100 firms | 50,000 | 15,000 | $6.00 | $180 |
| 500 firms | 250,000 | 75,000 | $30.00 | $900 |

At 500 firms, intent detection costs $900/month. This is negligible relative to the downstream Sonnet/Opus synthesis costs and the value of correct intent parsing.

---

---

## SECTION 0.1 — QueryIntentObject Type Definition

**New file:** `src/rag/types/query-intent-object.ts`

This is the contract between Haiku's extraction and the downstream validation + routing layers. Every field has a specific consumer.

```typescript
/**
 * QueryIntentObject (QIO) — the structured output from Haiku intent parsing.
 * This is the intermediate representation between raw query text and the
 * validated QueryIntent that feeds into QueryRouter.
 *
 * Haiku produces this. The validation layer confirms and enriches it.
 * QueryRouter consumes the validated version.
 */

export interface QueryIntentEntity {
  ticker: string;           // e.g. "AMZN" — Haiku resolves company names to tickers
  company: string;          // e.g. "Amazon" — original company reference from query
  confidence: number;       // 0.0-1.0 — Haiku's self-assessed confidence on this resolution
}

export interface QueryIntentMetric {
  raw_name: string;         // e.g. "revenue growth", "ROIC", "net sales" — as stated in query
  canonical_guess: string;  // e.g. "revenue", "roic", "net_sales" — Haiku's best guess at canonical
  is_computed: boolean;     // Haiku flags if this likely requires formula resolution (e.g. margins, ratios)
}

export interface QueryIntentTimePeriod {
  type: 'latest' | 'specific_year' | 'specific_quarter' | 'range' | 'ttm' | 'ytd';
  value: number | null;     // e.g. 5 for "past 5 years", 2024 for "FY2024", null for "latest"
  unit: 'years' | 'quarters' | 'months' | null;
  raw_text: string;         // e.g. "past five years", "FY2024", "latest"
}

export type QueryType =
  | 'single_metric'         // "What is ABNB's revenue?"
  | 'multi_metric'          // "What are ABNB's revenue and EBITDA?"
  | 'comparative'           // "Compare AMZN vs NVDA on revenue"
  | 'peer_benchmark'        // "How does ABNB compare to peers?"
  | 'trend_analysis'        // "Revenue trend over 5 years"
  | 'concept_analysis'      // "How levered is ABNB?"
  | 'narrative_only'        // "What did management say about risks?"
  | 'modeling'              // "Model ABNB's path to 30% margins"
  | 'sentiment'             // "What is the market sentiment on TSLA?"
  | 'screening';            // "Which online travel companies have highest margins?"

export interface QueryIntentObject {
  entities: QueryIntentEntity[];
  metrics: QueryIntentMetric[];
  time_period: QueryIntentTimePeriod;
  query_type: QueryType;
  needs_narrative: boolean;         // Does this query need MD&A / qualitative context?
  needs_peer_comparison: boolean;   // Should we expand to peer universe?
  needs_computation: boolean;       // Are any metrics computed (formulas)?
  original_query: string;           // Preserved for downstream logging
}
```

---

## SECTION 0.2 — HaikuIntentParserService

**New file:** `src/rag/haiku-intent-parser.service.ts`

This service is a **pure extraction service**. It calls Haiku, gets JSON back, validates the JSON shape, and returns a `QueryIntentObject`. It does NOT validate tickers against Postgres or resolve metrics via MetricRegistry — that happens in the validation layer (Section 0.3).

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../bedrock/bedrock.service';
import { QueryIntentObject, QueryIntentEntity, QueryIntentMetric, QueryIntentTimePeriod, QueryType } from './types/query-intent-object';

const HAIKU_MODEL = 'anthropic.claude-3-5-haiku-20241022-v1:0';
const HAIKU_MAX_TOKENS = 500;
const HAIKU_TIMEOUT_MS = 3000; // hard timeout — fall back to regex if exceeded

@Injectable()
export class HaikuIntentParserService {
  private readonly logger = new Logger(HaikuIntentParserService.name);

  constructor(private readonly bedrock: BedrockService) {}

  /**
   * Parse a raw analyst query into a structured QueryIntentObject via Claude Haiku.
   * Returns null if Haiku fails or returns invalid JSON — caller must handle fallback.
   */
  async parse(query: string): Promise<QueryIntentObject | null> {
    try {
      const prompt = this.buildExtractionPrompt(query);
      const response = await this.bedrock.invokeClaude({
        prompt,
        modelId: HAIKU_MODEL,
        max_tokens: HAIKU_MAX_TOKENS,
        temperature: 0,           // Deterministic — minimize output variance
        // timeout: HAIKU_TIMEOUT_MS, // Wire to your Bedrock client's timeout config
      });

      const parsed = this.parseResponse(response, query);
      if (!parsed) {
        this.logger.warn(`Haiku returned unparseable response for: "${query}"`);
        return null;
      }

      return parsed;
    } catch (error) {
      this.logger.error(`Haiku intent parsing failed: ${error.message}`, error.stack);
      return null; // Caller falls back to simplified regex
    }
  }

  /**
   * THE SYSTEM PROMPT
   *
   * This is the single most critical artifact in the intent detection pipeline.
   * Every change must be tested against the eval dataset (200+ queries).
   * Version this prompt. Log it with every API call for reproducibility.
   */
  private buildExtractionPrompt(query: string): string {
    return `You are a financial query parser for FundLens, an institutional equity research platform used by investment analysts and portfolio managers. Your job is to decompose analyst queries into structured JSON for downstream retrieval systems.

QUERY: "${query}"

RULES — follow these exactly:

1. TICKERS: Resolve company names to their PRIMARY US-listed ticker symbol.
   - "Amazon" → AMZN, "Google" or "Alphabet" → GOOGL, "Meta" or "Facebook" → META
   - "Airbnb" → ABNB, "Booking" → BKNG, "Citigroup" or "Citi" → C
   - Single-letter tickers are valid: C (Citigroup), V (Visa), F (Ford), X (US Steel)
   - If the query contains an explicit ticker (e.g. "ABNB"), use it directly.
   - If the query says "its peers" or "peers", set needs_peer_comparison: true.

2. METRICS: Extract every financial metric mentioned or implied.
   - "growth" alone → revenue_growth (default interpretation)
   - "margins" alone → gross_margin, operating_margin, net_margin (return all three)
   - "returns" alone → return_on_equity (default interpretation)
   - "leverage" or "how levered" → net_debt_to_ebitda, debt_to_equity, interest_coverage
   - Flag metrics that require calculation as is_computed: true (e.g., margins, ratios, growth rates)
   - Keep raw_name as the analyst wrote it. Put your best canonical guess in canonical_guess.

3. TIME PERIODS: Parse natural language time references.
   - "past 5 years" or "over the last five years" → type: "range", value: 5, unit: "years"
   - "FY2024" or "fiscal year 2024" → type: "specific_year", value: 2024
   - "Q3 2024" or "third quarter 2024" → type: "specific_quarter", value: 3
   - "latest" or "most recent" or no time specified → type: "latest", value: null
   - "trailing twelve months" or "TTM" → type: "ttm", value: null
   - "year to date" or "YTD" → type: "ytd", value: null

4. QUERY TYPE: Classify the overall intent.
   - single_metric: One metric, one company (e.g., "ABNB revenue")
   - multi_metric: Multiple metrics, one company (e.g., "ABNB revenue and EBITDA")
   - comparative: Explicit comparison of 2+ named companies (e.g., "AMZN vs NVDA")
   - peer_benchmark: One company vs sector peers (e.g., "how does ABNB compare to peers")
   - trend_analysis: Time series focus (e.g., "revenue trend over 5 years")
   - concept_analysis: Financial concept query (e.g., "how levered is ABNB?")
   - narrative_only: Qualitative only (e.g., "what did management say about risks?")
   - modeling: Forward-looking projections (e.g., "model path to 30% margins")
   - sentiment: Market or management sentiment (e.g., "what is sentiment on TSLA?")
   - screening: Filter across multiple companies (e.g., "which tech companies have highest margins?")

5. FLAGS:
   - needs_narrative: true if the query asks about management commentary, risks, strategy, outlook, guidance, or "what did they say"
   - needs_peer_comparison: true if the query mentions "peers", "competitors", "industry", "sector comparison", or "benchmark"
   - needs_computation: true if ANY metric requires a formula (margins, ratios, growth rates, ROIC, etc.)

RESPOND WITH VALID JSON ONLY. No markdown, no backticks, no preamble, no explanation.

{
  "entities": [
    { "ticker": "string", "company": "string", "confidence": 0.0-1.0 }
  ],
  "metrics": [
    { "raw_name": "string", "canonical_guess": "string", "is_computed": boolean }
  ],
  "time_period": {
    "type": "latest|specific_year|specific_quarter|range|ttm|ytd",
    "value": number_or_null,
    "unit": "years|quarters|months|null",
    "raw_text": "string"
  },
  "query_type": "string",
  "needs_narrative": boolean,
  "needs_peer_comparison": boolean,
  "needs_computation": boolean,
  "original_query": "string"
}`;
  }

  /**
   * Parse Haiku's JSON response into a validated QueryIntentObject.
   * Returns null if the JSON is malformed or missing required fields.
   */
  private parseResponse(response: string, originalQuery: string): QueryIntentObject | null {
    try {
      // Strip markdown fences if Haiku wraps them (it shouldn't with temperature=0, but defensive)
      const cleaned = response
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      // Validate required fields exist
      if (!parsed.entities || !Array.isArray(parsed.entities)) return null;
      if (!parsed.metrics || !Array.isArray(parsed.metrics)) return null;
      if (!parsed.time_period || typeof parsed.time_period !== 'object') return null;
      if (!parsed.query_type || typeof parsed.query_type !== 'string') return null;

      // Normalize entity tickers to uppercase
      const entities: QueryIntentEntity[] = parsed.entities.map((e: any) => ({
        ticker: (e.ticker || '').toUpperCase().trim(),
        company: (e.company || '').trim(),
        confidence: typeof e.confidence === 'number' ? e.confidence : 0.5,
      }));

      const metrics: QueryIntentMetric[] = parsed.metrics.map((m: any) => ({
        raw_name: (m.raw_name || '').trim(),
        canonical_guess: (m.canonical_guess || '').toLowerCase().trim(),
        is_computed: Boolean(m.is_computed),
      }));

      const time_period: QueryIntentTimePeriod = {
        type: parsed.time_period.type || 'latest',
        value: parsed.time_period.value ?? null,
        unit: parsed.time_period.unit ?? null,
        raw_text: parsed.time_period.raw_text || '',
      };

      return {
        entities,
        metrics,
        time_period,
        query_type: parsed.query_type as QueryType,
        needs_narrative: Boolean(parsed.needs_narrative),
        needs_peer_comparison: Boolean(parsed.needs_peer_comparison),
        needs_computation: Boolean(parsed.needs_computation),
        original_query: originalQuery,
      };
    } catch (e) {
      this.logger.warn(`JSON parse failed for Haiku response: ${e.message}`);
      return null;
    }
  }
}
```

---

## SECTION 0.3 — Validation Layer

**New file:** `src/rag/intent-validator.service.ts`

This service takes the raw `QueryIntentObject` from Haiku and validates/enriches it against deterministic data sources. It is the safety net that catches Haiku's non-determinism.

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MetricRegistryService } from './metric-resolution/metric-registry.service';
import { QueryIntentObject, QueryIntentEntity, QueryIntentMetric } from './types/query-intent-object';
import { MetricResolution } from './metric-resolution/types';

@Injectable()
export class IntentValidatorService implements OnModuleInit {
  private readonly logger = new Logger(IntentValidatorService.name);
  private knownTickers = new Set<string>();
  private tickerToCompany = new Map<string, string>(); // for fuzzy matching

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricRegistry: MetricRegistryService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadTickerData();
  }

  @Cron('0 2 * * *')
  async refreshTickerData(): Promise<void> {
    await this.loadTickerData();
  }

  private async loadTickerData(): Promise<void> {
    const companies = await this.prisma.company.findMany({
      select: { ticker: true, name: true },
    });
    this.knownTickers = new Set(companies.map(c => c.ticker.toUpperCase()));
    this.tickerToCompany = new Map(companies.map(c => [c.ticker.toUpperCase(), c.name]));
    this.logger.log(`Loaded ${this.knownTickers.size} tickers into validation set`);
  }

  /**
   * Validate and enrich a Haiku-produced QIO against deterministic sources.
   *
   * 1. Validate each entity ticker against Postgres companies table
   * 2. Fuzzy-match company names if ticker not found
   * 3. Resolve each metric via MetricRegistryService
   * 4. Log any ticker/metric misses for observability
   *
   * Returns the enriched QIO with:
   * - Only validated tickers (invalid ones removed + logged)
   * - Metrics enriched with canonical_id from MetricRegistry
   */
  async validate(qio: QueryIntentObject): Promise<ValidatedQueryIntent> {
    // 1. Validate tickers
    const validatedEntities: ValidatedEntity[] = [];
    for (const entity of qio.entities) {
      if (this.knownTickers.has(entity.ticker)) {
        validatedEntities.push({
          ...entity,
          validated: true,
          source: 'exact_match',
        });
      } else {
        // Haiku might have returned a ticker not in our DB — try fuzzy match by company name
        const fuzzyTicker = this.fuzzyMatchByCompanyName(entity.company);
        if (fuzzyTicker) {
          this.logger.log(
            `Haiku ticker "${entity.ticker}" not in DB, fuzzy matched "${entity.company}" → ${fuzzyTicker}`,
          );
          validatedEntities.push({
            ticker: fuzzyTicker,
            company: entity.company,
            confidence: entity.confidence * 0.8, // Reduce confidence for fuzzy match
            validated: true,
            source: 'fuzzy_match',
          });
        } else {
          this.logger.warn(
            `Ticker "${entity.ticker}" (company: "${entity.company}") not found in companies table`,
          );
          // Log to ticker_miss_log for observability
          this.logTickerMiss(entity.ticker, entity.company, qio.original_query);
        }
      }
    }

    // 2. Resolve metrics via MetricRegistryService
    const resolvedMetrics: MetricResolution[] = [];
    for (const metric of qio.metrics) {
      // Try canonical_guess first, then raw_name
      let resolution = this.metricRegistry.resolve(metric.canonical_guess);
      if (!resolution || resolution.confidence === 'unresolved') {
        resolution = this.metricRegistry.resolve(metric.raw_name);
      }

      if (resolution) {
        resolvedMetrics.push(resolution);
      } else {
        // Metric not in registry — attempt resolveMultiple with the raw name
        // This will return an 'unresolved' MetricResolution with suggestions
        const unresolvedResolution = this.metricRegistry.resolve(metric.raw_name);
        if (unresolvedResolution) {
          resolvedMetrics.push(unresolvedResolution);
        } else {
          resolvedMetrics.push({
            canonical_id: metric.canonical_guess,
            db_column: metric.canonical_guess,
            display_name: metric.raw_name,
            type: metric.is_computed ? 'computed' : 'atomic',
            confidence: 'unresolved',
            original_query: metric.raw_name,
            synonyms: [],
            suggestions: [],
          } as MetricResolution);
        }
      }
    }

    // 3. Map time period to existing PeriodType enum (compatible with Master Spec)
    const periodMapping = this.mapTimePeriod(qio.time_period);

    return {
      tickers: validatedEntities.filter(e => e.validated).map(e => e.ticker),
      entities: validatedEntities,
      metrics: resolvedMetrics,
      rawMetrics: qio.metrics,
      timePeriod: periodMapping,
      queryType: qio.query_type,
      needsNarrative: qio.needs_narrative,
      needsPeerComparison: qio.needs_peer_comparison,
      needsComputation: qio.needs_computation,
      originalQuery: qio.original_query,
    };
  }

  /**
   * Fuzzy match a company name against the companies table.
   * Uses case-insensitive substring matching.
   * Returns the ticker if a match is found, null otherwise.
   */
  private fuzzyMatchByCompanyName(companyName: string): string | null {
    if (!companyName) return null;
    const lower = companyName.toLowerCase();
    for (const [ticker, name] of this.tickerToCompany.entries()) {
      if (name.toLowerCase().includes(lower) || lower.includes(name.toLowerCase())) {
        return ticker;
      }
    }
    return null;
  }

  /**
   * Map Haiku's time period output to the PeriodType system used by the Master Spec.
   * This ensures compatibility with StructuredRetriever and QueryRouter.
   */
  private mapTimePeriod(tp: QueryIntentObject['time_period']): MappedTimePeriod {
    switch (tp.type) {
      case 'latest':
        return { periodType: 'LATEST_BOTH', specificPeriod: null };
      case 'specific_year':
        return { periodType: 'SPECIFIC_YEAR', specificPeriod: `FY${tp.value}` };
      case 'specific_quarter':
        return { periodType: 'SPECIFIC_QUARTER', specificPeriod: `Q${tp.value}` };
      case 'range':
        return {
          periodType: 'RANGE',
          specificPeriod: null,
          rangeValue: tp.value,
          rangeUnit: tp.unit,
        };
      case 'ttm':
        return { periodType: 'TTM', specificPeriod: 'TTM' };
      case 'ytd':
        return { periodType: 'YTD', specificPeriod: 'YTD' };
      default:
        return { periodType: 'LATEST_BOTH', specificPeriod: null };
    }
  }

  private logTickerMiss(ticker: string, company: string, query: string): void {
    // Wire to your observability/logging system
    // This feeds the Intent Analytics dashboard
    this.logger.warn(`TICKER_MISS: ticker=${ticker}, company=${company}, query="${query}"`);
  }
}

// Types for validated output
export interface ValidatedEntity {
  ticker: string;
  company: string;
  confidence: number;
  validated: boolean;
  source: 'exact_match' | 'fuzzy_match';
}

export interface MappedTimePeriod {
  periodType: string;
  specificPeriod: string | null;
  rangeValue?: number | null;
  rangeUnit?: string | null;
}

export interface ValidatedQueryIntent {
  tickers: string[];
  entities: ValidatedEntity[];
  metrics: MetricResolution[];
  rawMetrics: QueryIntentObject['metrics'];
  timePeriod: MappedTimePeriod;
  queryType: QueryIntentObject['query_type'];
  needsNarrative: boolean;
  needsPeerComparison: boolean;
  needsComputation: boolean;
  originalQuery: string;
}
```

---

## SECTION 0.4 — Rewire IntentDetectorService

**Modified file:** `src/rag/intent-detector.service.ts`

This is the integration point. Replace the existing Layer 1 regex extraction with the Haiku pipeline while preserving the cache layer and adding a robust fallback.

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HaikuIntentParserService } from './haiku-intent-parser.service';
import { IntentValidatorService, ValidatedQueryIntent } from './intent-validator.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricRegistryService } from './metric-resolution/metric-registry.service';
import { LRUCache } from 'lru-cache'; // or your existing FastPathCache
import * as crypto from 'crypto';

// Cache configuration
const CACHE_MAX_ENTRIES = 5000;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

@Injectable()
export class IntentDetectorService implements OnModuleInit {
  private readonly logger = new Logger(IntentDetectorService.name);
  private cache: LRUCache<string, ValidatedQueryIntent>;
  private knownTickers = new Set<string>(); // For fallback regex only

  constructor(
    private readonly haikuParser: HaikuIntentParserService,
    private readonly intentValidator: IntentValidatorService,
    private readonly prisma: PrismaService,
    private readonly metricRegistry: MetricRegistryService,
  ) {
    this.cache = new LRUCache<string, ValidatedQueryIntent>({
      max: CACHE_MAX_ENTRIES,
      ttl: CACHE_TTL_MS,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.loadKnownTickers();
  }

  @Cron('0 2 * * *')
  async refreshTickerSet(): Promise<void> {
    await this.loadKnownTickers();
  }

  private async loadKnownTickers(): Promise<void> {
    const companies = await this.prisma.company.findMany({ select: { ticker: true } });
    this.knownTickers = new Set(companies.map(c => c.ticker.toUpperCase()));
  }

  /**
   * PRIMARY ENTRY POINT — replaces the old detect() method.
   *
   * Flow:
   * 1. Normalize query → compute cache key
   * 2. Check LRU cache → return on hit
   * 3. Call Haiku for structured extraction
   * 4. Validate + enrich via deterministic layer
   * 5. Cache the result
   * 6. If Haiku fails → fallback to simplified regex
   */
  async detect(query: string): Promise<ValidatedQueryIntent> {
    // Layer 1: Normalize + cache
    const normalizedQuery = this.normalizeQuery(query);
    const cacheKey = this.computeCacheKey(normalizedQuery);

    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache HIT for: "${query.substring(0, 50)}..."`);
      return cached;
    }

    // Layer 2: Haiku structured extraction
    const qio = await this.haikuParser.parse(normalizedQuery);

    if (qio) {
      // Layer 3: Deterministic validation
      const validated = await this.intentValidator.validate(qio);

      // Cache the validated result
      this.cache.set(cacheKey, validated);
      this.logger.debug(
        `Haiku parsed: tickers=[${validated.tickers}], metrics=[${validated.metrics.map(m => m.canonical_id)}], type=${validated.queryType}`,
      );

      return validated;
    }

    // FALLBACK: Haiku failed (timeout, error, unparseable response)
    this.logger.warn(`Haiku failed for "${query.substring(0, 80)}..." — using regex fallback`);
    const fallbackResult = await this.regexFallback(normalizedQuery);

    // Cache fallback too (prevents re-calling Haiku on retry for the same broken query)
    this.cache.set(cacheKey, fallbackResult);
    return fallbackResult;
  }

  /**
   * Simplified regex fallback — handles ~60% of queries gracefully.
   * Only fires when Bedrock is unavailable or Haiku returns garbage.
   *
   * This is intentionally simple. It handles:
   * - Explicit uppercase tickers (AAPL, ABNB, MSFT)
   * - Direct metric name matches
   * - Basic time period patterns
   *
   * It does NOT handle:
   * - Company names ("Amazon")
   * - Lowercase tickers ("abnb")
   * - Single-letter tickers ("C" for Citigroup)
   * - Ambiguous metrics ("growth", "returns")
   * - Complex multi-entity queries
   */
  private async regexFallback(query: string): Promise<ValidatedQueryIntent> {
    const tickers: string[] = [];
    const pattern = /(?:^|[\s,(.])([A-Z]{1,5})(?=[\s,.)!?\n]|$)/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(query)) !== null) {
      if (this.knownTickers.has(m[1])) {
        tickers.push(m[1]);
      }
    }

    // Basic metric extraction — exact matches only
    const metrics = this.metricRegistry.resolveMultiple
      ? this.metricRegistry.resolveMultiple(query)
      : [];

    return {
      tickers,
      entities: tickers.map(t => ({
        ticker: t,
        company: '',
        confidence: 0.7,
        validated: true,
        source: 'exact_match' as const,
      })),
      metrics: Array.isArray(metrics) ? metrics : [],
      rawMetrics: [],
      timePeriod: { periodType: 'LATEST_BOTH', specificPeriod: null },
      queryType: 'single_metric',
      needsNarrative: false,
      needsPeerComparison: false,
      needsComputation: false,
      originalQuery: query,
    };
  }

  /**
   * Normalize query for cache key consistency.
   * Queries that are semantically identical should produce the same cache key.
   */
  private normalizeQuery(query: string): string {
    return query
      .trim()
      .replace(/\s+/g, ' ')     // Collapse whitespace
      .toLowerCase();             // Case-insensitive cache matching
  }

  private computeCacheKey(normalizedQuery: string): string {
    return crypto.createHash('sha256').update(normalizedQuery).digest('hex').substring(0, 16);
  }
}
```

---

## SECTION 0.5 — Integration with Existing QueryRouter

The `ValidatedQueryIntent` from the new `IntentDetectorService.detect()` must feed into the existing `QueryRouterService`. The key mapping:

```typescript
// In QueryRouterService or RAGService, after calling detect():

const intent = await this.intentDetector.detect(query);

// Map ValidatedQueryIntent → existing QueryIntent interface
// (preserving backward compatibility with the rest of the pipeline)
const queryIntent: QueryIntent = {
  ticker: intent.tickers.length === 1 ? intent.tickers[0] : intent.tickers,
  metrics: intent.metrics,                    // MetricResolution[] — already resolved
  type: this.mapQueryType(intent.queryType),  // Map to existing intent type enum
  needsNarrative: intent.needsNarrative,
  needsComputation: intent.needsComputation,
  needsPeerComparison: intent.needsPeerComparison,
  suggestedChart: this.inferChartType(intent),
  originalQuery: intent.originalQuery,
  timePeriod: intent.timePeriod,
};

// This QueryIntent feeds into:
// → QueryDecomposerService (Part III)
// → QueryRouterService.buildStructuredPlan()
// → StructuredRetriever (Fixed in 1.1)
// → HybridSynthesisService (Part II)
// → PeerComparisonService (Part IV)
// All unchanged from Master Spec.
```

---

## SECTION 0.6 — Module Registration

Register the new services in your NestJS module:

```typescript
// In rag.module.ts (or wherever IntentDetectorService is registered):

import { HaikuIntentParserService } from './haiku-intent-parser.service';
import { IntentValidatorService } from './intent-validator.service';

@Module({
  providers: [
    HaikuIntentParserService,    // NEW
    IntentValidatorService,       // NEW
    IntentDetectorService,        // MODIFIED (rewired internals)
    // ... all existing services unchanged
  ],
})
export class RagModule {}
```

---

---

## DEFINITION OF DONE — SPRINT 0.5

### Core Extraction Tests

```
T0.1  Query: "What is ABNB's latest revenue?"
      Expected: entities[0].ticker = 'ABNB', metrics[0].canonical_guess = 'revenue'
      Expected: query_type = 'single_metric'
      Expected: time_period.type = 'latest'
      Expected: Validated ticker exists in companies table

T0.2  Query: "what is c's growth over past five years?"
      Expected: entities[0].ticker = 'C', entities[0].company = 'Citigroup'
      Expected: metrics[0].raw_name contains 'growth'
      Expected: time_period = { type: 'range', value: 5, unit: 'years' }
      Expected: needs_computation = true

T0.3  Query: "compare amazon and nvidia roic and net sales over 5 years"
      Expected: entities = [ {ticker:'AMZN'}, {ticker:'NVDA'} ]
      Expected: metrics = [ {canonical_guess:'roic'}, {canonical_guess:'net_sales'} ]
      Expected: query_type = 'comparative'
      Expected: time_period = { type: 'range', value: 5, unit: 'years' }
      Expected: needs_computation = true (ROIC is computed)

T0.4  Query: "GAAP vs non-GAAP operating income for MSFT"
      Expected: entities[0].ticker = 'MSFT' only
      Expected: GAAP NOT extracted as a ticker

T0.5  Query: "What did the 10-K say about risks?"
      Expected: entities = [] (no tickers)
      Expected: needs_narrative = true
      Expected: query_type = 'narrative_only'

T0.6  Query: "How does ABNB compare to its online travel peers on margins?"
      Expected: entities[0].ticker = 'ABNB'
      Expected: needs_peer_comparison = true
      Expected: query_type = 'peer_benchmark'
      Expected: metrics include gross_margin, operating_margin

T0.7  Query: "abnb revenue" (all lowercase)
      Expected: entities[0].ticker = 'ABNB'
      Expected: metrics[0].canonical_guess = 'revenue'

T0.8  Query: "What is V's PE ratio?"
      Expected: entities[0].ticker = 'V' (Visa)
      Expected: entities[0].company = 'Visa'
      Expected: metrics[0].canonical_guess contains 'pe_ratio' or 'price_to_earnings'
      Expected: PE NOT extracted as a ticker
```

### Cache Tests

```
T0.9  Run T0.1 twice. Second call should return from cache (verify via log output).
      Expected: "Cache HIT" logged on second call.
      Expected: Identical ValidatedQueryIntent returned.

T0.10 Run "ABNB revenue" and "abnb revenue" and "  ABNB  revenue  ".
      Expected: All three produce the same cache key (normalization).
      Expected: Only one Haiku call made.
```

### Fallback Tests

```
T0.11 Simulate Bedrock timeout/failure.
      Expected: regexFallback fires.
      Expected: "AAPL revenue" still extracts ticker AAPL.
      Expected: "amazon revenue" returns empty tickers (regex can't resolve names).
      Expected: Log contains "Haiku failed ... using regex fallback".

T0.12 Haiku returns invalid JSON (e.g., truncated response).
      Expected: parseResponse returns null.
      Expected: regexFallback fires.
      Expected: No exception thrown to caller.
```

### Latency Tests

```
T0.13 Simple query cache miss: "AAPL revenue"
      Expected: Total detect() time < 800ms (including Haiku + validation)

T0.14 Simple query cache hit: "AAPL revenue" (second call)
      Expected: Total detect() time < 10ms

T0.15 Complex query cache miss: "compare amazon and nvidia roic and net sales over 5 years"
      Expected: Total detect() time < 1000ms
```

---

---

## UPDATED ARCHITECTURE AT COMPLETION

This replaces the "ARCHITECTURE AT COMPLETION" section in the Master Spec:

```
ENTRY
  Analyst Query

PLANNING
  IntentDetectorService (REVISED)
    Layer 1: Normalize + LRU Cache [hash-based, 5000 entries, 24h TTL]
    Layer 2: HaikuIntentParserService [Claude Haiku, structured JSON, temperature=0]
    Layer 3: IntentValidatorService [Postgres companies table + MetricRegistryService]
    Fallback: Simplified regex [Bedrock outage only, ~60% coverage]

  [UNCHANGED] QueryDecomposerService
    → DecomposedQuery { isDecomposed, subQueries[], unifyingInstruction }

  [UNCHANGED] QueryRouterService
    → MetricRegistryService.resolveMultiple() → MetricResolution[db_column]
    → ConceptRegistryService → sector-filtered metric bundle
    → PeerRegistryService → peer universe when needsPeerComparison=true

RETRIEVAL  (parallel execution, bounded loop ≤ 3 iterations)
  ├── [FIXED] StructuredRetriever → db_column WHERE, sort fix, computed routing → MetricResult[]
  ├── [WIRED] FormulaResolutionService → DAG → Python /calculate → ComputedMetricResult[]
  ├── SemanticRetriever → Bedrock KB → ChunkResult[]
  ├── [NEW] PeerComparisonService → LTM normalization → PeerComparisonResult
  └── [NEW] Completeness evaluator → replan if incomplete → iterate

SYNTHESIS
  [UNCHANGED] HybridSynthesisService
    → FinancialAnalysisContext
    → 5-step structured prompt (facts → narrative → reconciliation → conclusion → provocation)
    → Sonnet / Opus (complexity-tiered)
    → PE tenant overlay from third_avenue.yaml

RESPONSE
  [UNCHANGED] RAGResponse {
    answer
    responseType
    metrics
    narratives
    visualization         ← VisualizationPayload contract
    peerComparison
    computedAuditTrail
    provocations[]        ← GROUNDED in retrieved data
    dataFreshness
    citations[]
  }
```

---

---

## MIGRATION CHECKLIST

Before implementing, confirm:

- [ ] Bedrock access configured for `anthropic.claude-3-5-haiku-20241022-v1:0` in your AWS account
- [ ] Bedrock timeout configuration supports the `HAIKU_TIMEOUT_MS` (3000ms) setting
- [ ] `companies` table populated with all tickers your platform covers
- [ ] `lru-cache` npm package installed (or equivalent cache library)
- [ ] Eval dataset created (see companion file: `FUNDLENS_EVAL_DATASET.md`)
- [ ] Master Spec Fix 1.1 (db_column wiring) is NOT yet started — this spec runs first as Sprint 0.5

### Implementation Order (Complete Picture)

```
Sprint 0.5: This spec (Haiku-first intent detection)
  → Session 0.5a: HaikuIntentParserService + QIO types
  → Session 0.5b: IntentValidatorService + rewire IntentDetectorService
  → Session 0.5c: Cache + fallback
  → Session 0.5d: Eval dataset → prompt tuning

Sprint 1: Master Spec Part I (Foundation Fixes)
  → Session 1: Fix 1.1 (db_column wiring) — now feeds off validated intent
  → Session 2: Fix 1.2 — SKIPPED (replaced by this spec)
  → Session 3: Fix 1.3 (VisualizationPayload)

Sprint 2: Master Spec Part II (HybridSynthesisService)

Sprint 3: Master Spec Parts III + IV (QueryDecomposer + PeerComparison)
```

---

*FundLens Platform · Haiku-First Intent Detection Spec · February 2026 · Confidential*
