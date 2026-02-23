# FundLens Metric Resolution Architecture — Implementation Spec

## Context for the Implementer

FundLens is an AI-powered equity research platform used by professional financial analysts at institutional investment firms (hedge funds, value funds, PE firms). Analysts use it to analyze SEC filings, earnings calls, and financial statements. Trust and accuracy are existential — a single wrong number or misresolved metric destroys credibility with a client permanently.

The current metric resolution system is broken. There are multiple parallel synonym systems (a regex map in the intent detector and a YAML-based MetricMappingService) that use different naming conventions and don't agree with each other. The normalize() function strips underscores but doesn't account for spaces, ampersands, or abbreviations, causing lookups to fail silently. When resolution fails, the system falls back to raw metric keys that don't match the database, returning empty results with no explanation.

This spec defines the replacement architecture. The goal: an analyst types anything — a formal metric name, shorthand, a financial concept, a natural language question — and the system deterministically resolves it to the correct metric(s), calculates derived values using a Python calculation engine (which already exists and should not be modified), and returns results with full source transparency.

---

## Architecture Overview: Three-Layer Resolution Stack

The system has three layers, each handling a different type of analyst query. Every query enters through a single entry point (the Intent Router) and is classified into one of three types before being dispatched to the appropriate resolution path.

```
Analyst Query
      ↓
┌──────────────────────────────────────────────────────┐
│  INTENT ROUTER                                        │
│  Classifies every query into one of three types:      │
│                                                       │
│  TYPE A: Direct/Atomic Metric                         │
│    "Show me revenue" / "What's cash on hand?"         │
│    → Resolve to single canonical metric → DB lookup   │
│                                                       │
│  TYPE B: Computed/Derived Metric                      │
│    "What's net debt?" / "Free cash flow yield?"       │
│    → Resolve to formula → Resolve dependencies        │
│    → Execute via Calculation Engine → Return           │
│                                                       │
│  TYPE C: Analytical Concept                           │
│    "How levered is this company?"                     │
│    → Map to concept → Resolve primary + secondary     │
│      metrics (filtered by sector and asset class)     │
│    → Execute all via Calculation Engine                │
│    → Assemble composite analysis profile              │
│                                                       │
│  TYPE D: Narrative/Qualitative Search                 │
│    "What did management say about margins?"           │
│    → Route to RAG pipeline (out of scope here)        │
└──────────────────────────────────────────────────────┘
```

The Intent Router should be lightweight and deterministic where possible. Use pattern matching and keyword detection first, fall back to an LLM classification call only for genuinely ambiguous queries. The router must be fast — sub-10ms for the common case.

---

## Layer 1: The Canonical Metric Registry

This is the single source of truth for every metric in the system. It replaces both the existing regex map in the intent detector AND the current YAML MetricMappingService. Delete both. There should be exactly one place where metrics are defined.

### Structure

Organize as multiple YAML files by statement type, asset class, and domain. At application startup, load all files and build a single in-memory inverted index.

**Directory structure:**
```
metrics/
  universal/
    income_statement.yaml
    balance_sheet.yaml
    cash_flow_statement.yaml
    per_share.yaml
  sector/
    saas.yaml
    energy.yaml
    insurance.yaml
    banking.yaml
    real_estate.yaml
  pe_specific/
    return_metrics.yaml
    fund_metrics.yaml
    credit_metrics.yaml
    operating_metrics.yaml
  computed/
    leverage.yaml
    profitability.yaml
    liquidity.yaml
    valuation.yaml
    efficiency.yaml
  clients/
    # Client-specific synonym overlays (added per engagement)
    # e.g., third_avenue.yaml, apollo.yaml
```

### Metric Entry Schema

Every metric (atomic or computed) follows this schema:

```yaml
cash_and_cash_equivalents:
  display_name: "Cash & Cash Equivalents"
  type: atomic                        # atomic | computed
  statement: balance_sheet            # income_statement | balance_sheet | cash_flow | null
  category: current_assets
  asset_class: [public_equity, private_equity]
  industry: all                       # all | saas | energy | insurance | banking | real_estate
  synonyms:                           # Human-curated, exhaustive
    - cash
    - cash balance
    - cash on hand
    - cash position
    - total cash
    - cash and equivalents
    - cash & equivalents
    - cash at end of period
    - cash at period end
    - cash on balance sheet
    - liquid assets
  xbrl_tags:                          # For SEC filing ingestion mapping
    - us-gaap:CashAndCashEquivalentsAtCarryingValue
    - us-gaap:CashCashEquivalentsAndShortTermInvestments
    - ifrs-full:Cash
  db_column: cash_and_cash_equivalents  # Exact column name in the database
  calculation_notes: "Most liquid assets including money market funds"
```

For computed metrics:

```yaml
net_debt:
  display_name: "Net Debt"
  type: computed
  statement: null
  category: leverage
  asset_class: [public_equity, private_equity]
  industry: all
  formula: "total_debt - cash_and_cash_equivalents"
  dependencies:
    - total_debt
    - cash_and_cash_equivalents
  synonyms:
    - net debt
    - net borrowings
    - net leverage amount
    - debt net of cash
    - debt minus cash
  output_format: currency
  calculation_notes: "Total debt less cash and cash equivalents"

net_debt_to_ebitda:
  display_name: "Net Debt / EBITDA"
  type: computed
  statement: null
  category: leverage
  asset_class: [public_equity, private_equity]
  industry: all
  formula: "net_debt / ebitda"
  dependencies:
    - net_debt       # This is itself computed — engine must resolve recursively
    - ebitda
  synonyms:
    - net debt to ebitda
    - net leverage ratio
    - leverage ratio
    - leverage multiple
    - nd ebitda
    - net debt ebitda
  output_format: ratio
  output_suffix: "x"
  interpretation:
    healthy: "< 2.0x"
    moderate: "2.0x - 4.0x"
    elevated: "> 4.0x"
  calculation_notes: "Primary leverage metric; uses LTM EBITDA"
```

### Client Overlay Files

Client-specific synonyms extend (never replace) the universal registry:

```yaml
# clients/third_avenue.yaml
client: third_avenue_management
overrides:
  net_income:
    additional_synonyms:
      - owner earnings
      - real economic earnings
  ebitda:
    additional_synonyms:
      - cash operating profit
  free_cash_flow:
    additional_synonyms:
      - distributable cash
```

At startup, the client overlay is merged on top of the universal registry based on the authenticated user's firm.

---

## Layer 1A: The Inverted Synonym Index

At application startup, build an inverted index from the entire metric registry. This is the primary lookup structure — all resolution starts here.

### Normalization Function

Replace the existing normalize() with an aggressive normalizer that strips everything non-alphanumeric for index keys:

```
normalize_for_lookup(text) → lowercase, strip all non-alphanumeric characters

Examples:
  "Cash & Cash Equivalents" → "cashandcashequivalents"
  "Cash_and_Cash_Equivalents" → "cashandcashequivalents"
  "cash and cash equivalents" → "cashandcashequivalents"
  "SG&A" → "sga"
  "D&A" → "da"
  "R&D" → "rd"
  "Net Debt / EBITDA" → "netdebtebitda"
  "EBITDA" → "ebitda"
```

### Index Construction

At startup, iterate through every metric in the registry. For each metric:

1. Index the canonical_id itself (normalized)
2. Index the display_name (normalized)
3. Index every synonym (normalized)
4. Index every XBRL tag label (normalized, without the namespace prefix)
5. If a client overlay is active, index the additional_synonyms

Every entry in the index maps to the canonical metric ID. If there's a collision (two metrics have a synonym that normalizes to the same string), log a warning at startup and keep the first one — this is a data quality issue in the YAML that must be resolved by a human.

Also build a secondary index that preserves the original synonym text (for fuzzy matching and display purposes).

### LRU Cache

Wrap the resolution pipeline in an LRU cache keyed on the normalized query string. Size: 10,000 entries. This means repeated queries (which are extremely common — analysts ask about the same metrics constantly) are sub-millisecond.

Log every cache miss for analytics. Cache misses are your feedback signal for missing synonyms.

---

## Layer 1B: The Resolution Pipeline

This is the core of the system. Every metric query (whether from a direct user question, from the Intent Router, or from a dependency resolution in the Calculation Engine) flows through this pipeline.

```
Input: raw metric string (from analyst or from internal system)
      ↓
Step 1: normalize_for_lookup(input)
      ↓
Step 2: LRU cache check → if hit, return MetricResolution immediately
      ↓
Step 3: Exact match in inverted synonym index → O(1) hash lookup
      ↓ (miss)
Step 4: Fuzzy match against all synonym keys
        Use token-level comparison, not just character-level
        Library: rapidfuzz (or equivalent)
        Threshold: 85 for auto-resolve, 70-84 for suggestion candidates
        Return top 3 candidates with scores
      ↓ (miss or below auto-resolve threshold)
Step 5: DO NOT call an LLM or embedding model here
        Instead: return the top 3 fuzzy candidates as suggestions
        Flag this as "unresolved" in the response
      ↓
Step 6: Log the unresolved query for offline review
        Batch unresolved queries weekly
        Use LLM offline to suggest new synonym additions
        Human reviews and approves before they go live
      ↓
Output: MetricResolution object
```

### MetricResolution Object

Every resolution returns a structured object, never a raw string:

```
MetricResolution:
  canonical_id: string           # e.g., "cash_and_cash_equivalents"
  display_name: string           # e.g., "Cash & Cash Equivalents"
  type: string                   # "atomic" | "computed"
  confidence: string             # "exact" | "fuzzy_auto" | "unresolved"
  fuzzy_score: float | null      # only for fuzzy matches
  original_query: string         # what the analyst typed
  match_source: string           # which synonym or method matched
  suggestions: list | null       # top 3 alternatives if unresolved
  formula: string | null         # if computed
  dependencies: list | null      # if computed
```

### Critical Design Constraints

1. **No SLM/embedding model in the resolution path.** The all-MiniLM-L6-v2 model (or any embedding model) must not be used for metric resolution. Embeddings produce confident wrong answers for short financial terms — "cash" can match "total assets" because they're semantically adjacent in general English. This is unacceptable for a product where trust is paramount. Embedding models are useful elsewhere in the stack (document retrieval, RAG) but not here.

2. **No LLM calls in the synchronous resolution path.** An API call to Claude/GPT adds 500ms-2s of latency and a network dependency. For an analyst running 50 queries during IC prep, this is unacceptable. LLM classification belongs in the offline learning loop, not in the hot path.

3. **Silent failures are forbidden.** The current system falls back to using the raw metric key when resolution fails, which returns empty results with no explanation. This must never happen. Every query must return either a resolved metric OR explicit suggestions with a clear message. An analyst should never see an empty table without understanding why.

4. **The inverted index is the primary resolution mechanism.** The goal is that 95%+ of queries resolve via exact match. Fuzzy matching handles the next 4%. The remaining 1% surfaces as suggestions, gets logged, and feeds the learning loop.

---

## Layer 2: The Concept Registry

Analysts often don't ask for specific metrics. They ask analytical questions: "How levered is this company?", "What's the margin profile?", "Is this a capital-light business?" These map to multiple metrics that together answer the question.

The Concept Registry maps analytical questions to metric bundles, filtered by sector and asset class.

### Concept Entry Schema

```yaml
# concepts/leverage.yaml
leverage:
  display_name: "Leverage Analysis"
  description: "Comprehensive view of debt levels, coverage, and capacity"
  triggers:
    - how levered
    - leverage
    - how much debt
    - debt load
    - gearing
    - balance sheet risk
    - how indebted
    - debt situation
    - debt profile
    - capital structure
  primary_metrics:
    all:
      - net_debt_to_ebitda
      - debt_to_equity
    energy:
      - net_debt_to_ebitdax
    real_estate:
      - debt_to_gross_asset_value
    private_equity:
      - net_debt_to_ltm_ebitda
      - total_leverage_ratio
  secondary_metrics:
    all:
      - interest_coverage
      - debt_to_total_assets
      - total_debt
      - net_debt
    private_equity:
      - fixed_charge_coverage
      - debt_service_coverage
  context_prompt: >
    From the most recent 10-K, 10-Q, and earnings call transcripts,
    summarize management's discussion of leverage targets, debt covenants,
    refinancing plans, and any commentary on the company's ability to
    service its debt. Note any covenant compliance issues or upcoming
    maturities mentioned.
  presentation:
    layout: profile         # profile | single_value | comparison
    include_peer_comparison: true
    include_historical_trend: true
```

### How Concepts Route Through the Calculation Engine

When the Intent Router classifies a query as TYPE C (analytical concept):

1. Match the query to a concept via trigger keywords (exact and fuzzy match on triggers, same pattern as metric resolution)
2. Determine the sector/industry of the company being analyzed
3. Determine the asset class (public equity vs PE)
4. Collect primary_metrics for [all + sector-specific], then secondary_metrics for [all + asset-class-specific]
5. For each metric in the bundle:
   a. If type is "atomic" → resolve to DB column, fetch value
   b. If type is "computed" → resolve formula, resolve dependencies (recursively), execute via Calculation Engine
6. If concept has a context_prompt → pass it to the RAG pipeline for narrative context (async, don't block the numbers)
7. Assemble the composite response

The Calculation Engine already exists and handles the actual math. The new work is the routing layer that translates concepts into metric bundles and feeds them to the engine in the right order.

---

## Layer 2A: The Formula Registry and Dependency Resolution

Computed metrics have formulas that reference other metrics, which may themselves be computed. The system must resolve dependencies recursively.

### Dependency Resolution Algorithm

```
resolve(metric_id):
  metric = registry.get(metric_id)
  
  if metric.type == "atomic":
    return fetch_from_db(metric.db_column, company, period)
  
  if metric.type == "computed":
    resolved_values = {}
    for dep in metric.dependencies:
      resolved_values[dep] = resolve(dep)     # Recursive
      if resolved_values[dep] is null:
        return null with explanation: "Missing dependency: {dep.display_name}"
    
    return calculation_engine.execute(metric.formula, resolved_values)
```

### Critical Constraints for Dependency Resolution

1. **Detect circular dependencies at startup.** When loading the registry, build the full dependency graph and verify it's a DAG. If a cycle exists, fail loudly with a clear error message identifying the cycle. Do not catch this at query time.

2. **Handle missing atomic values gracefully.** If the DB doesn't have a value for an atomic metric (e.g., company hasn't filed yet, or the filing doesn't include that line item), the computed metric should return null with a specific explanation: "Cannot calculate Net Debt / EBITDA: missing EBITDA for Q3 2025." Never return 0 as a default.

3. **Preserve formula transparency.** Every computed result must carry its formula and the resolved input values, so the UI can show the analyst exactly how the number was calculated. Analysts must be able to verify. Example response:

```
Net Debt / EBITDA: 3.2x

  Net Debt:      $2.4B
    Total Debt:              $3.8B  (10-Q, filed 11/14/2025)
    Less: Cash & Equiv:     -$1.4B  (10-Q, filed 11/14/2025)
  EBITDA (LTM):  $750M      (Calculated from last 4 quarters)

  [View Sources]  [Save to Scratchpad]
```

This transparency is non-negotiable. Analysts will not trust a black-box number.

---

## Layer 3: Graceful Degradation and the Feedback Loop

### UX for Unresolved Metrics

When the resolution pipeline cannot confidently resolve a metric, the response must never feel like an error. It should feel like a helpful colleague asking for clarification.

**If fuzzy match returns candidates (score 70-84):**
```
Showing results for "Cash & Cash Equivalents" — is that what you meant?
  [Cash & Cash Equivalents]  [Cash from Operations]  [Cash Flow from Investing]
```
The analyst clicks the correct one. That mapping (their input → selected metric) is logged.

**If no reasonable candidates exist:**
```
I don't have a metric mapped for "reserve replacement ratio" yet.
The closest I have are:
  [Reserve Life Index]  [Proved Reserves]  [Production Rate]
Or you can describe what you're looking for and I'll help find it.
```

**Never show:**
- Empty tables with no explanation
- Raw error messages
- Technical metric IDs like "cash_and_cash_equivalents" in user-facing text

### The Learning Loop (Async, Offline)

Every interaction feeds back into the system:

1. **Every cache miss** → logged with the raw query and what it resolved to (or didn't)
2. **Every analyst correction** (clicking a suggestion) → logged as a candidate synonym mapping
3. **Every unresolved query** → queued for review

Weekly batch process:
- Aggregate all unresolved queries and corrections
- Use an LLM to suggest new synonyms grouped by canonical metric
- Present suggestions in an admin dashboard for human review
- Approved synonyms are added to the YAML files and the index is rebuilt

This is how the system improves over time without manual synonym curation becoming a bottleneck. The first client pilot generates the training signal for the second.

### Client-Specific Learning

Corrections from Third Avenue analysts go into the Third Avenue overlay file. Corrections from a PE client go into their overlay. The universal registry only gets updated when a synonym is clearly universal (e.g., "cash" should always map to cash_and_cash_equivalents regardless of client).

---

## Seeding Strategy: How to Bootstrap the Registry

Do not hand-curate 500 metrics from scratch. Instead:

1. **Extract every unique XBRL tag** from your existing SEC filing corpus. You likely have thousands of unique tags across all ingested filings.

2. **One-time LLM batch job**: For each XBRL tag, generate:
   - A canonical metric ID (snake_case)
   - A display name
   - 10-15 synonyms including common analyst shorthand, abbreviations, and plain-English variants
   - Statement classification (income statement, balance sheet, cash flow)
   - Category classification

3. **Human review pass** (2-3 hours): Scan the output for obvious errors, merge duplicates, fix misclassifications. Pay special attention to metrics that are commonly confused (e.g., operating income vs EBIT vs EBITDA).

4. **Map to DB columns**: For each canonical metric, verify the corresponding column exists in the database. Flag any mismatches — these are the normalization bugs you're fixing.

5. **Deploy and iterate**: The learning loop catches what the seed missed. The first few client sessions will generate dozens of synonym additions.

For PE-specific metrics, curate manually — there's no XBRL taxonomy to bootstrap from, and there are only ~50-80 PE-specific metrics that matter. Use an LLM to generate synonym candidates, then review.

---

## Integration Points

### With the Existing Calculation Engine

The Calculation Engine is not being modified. The new system feeds it structured inputs:
- For atomic metrics: resolved DB column name + company + period → engine fetches and returns
- For computed metrics: formula string + dictionary of resolved dependency values → engine evaluates and returns

The Formula Registry (YAML) is the bridge between the resolution pipeline and the calculation engine. The engine doesn't need to know about synonyms, concepts, or fuzzy matching — it just receives clean inputs and computes.

### With the Database

The `db_column` field in each metric entry must exactly match the column name in the database. At startup, validate that every metric with type "atomic" has a corresponding column in the DB. Log warnings for any mismatches. This catches the exact bug described in the problem statement (where the normalized key didn't match the actual DB column).

### With the RAG Pipeline

Concepts have a `context_prompt` field that can be passed to the RAG pipeline for narrative context. This is an async call — the numbers from the Calculation Engine should render immediately, and the narrative context fills in when ready. The RAG pipeline is out of scope for this spec but the interface point is: pass the context_prompt string + the company identifier + the relevant filing period, receive narrative text with source citations.

### With the UI

The resolution pipeline returns MetricResolution objects that the UI uses to:
- Show the display_name (never the canonical_id) in tables and charts
- Show confidence indicators for fuzzy matches
- Show clickable suggestion chips for unresolved queries
- Show formula breakdowns for computed metrics
- Show source filing citations for atomic values

---

## What to Delete

1. **The entire extractMetrics() regex map** in the intent detector. All of it. Every regex pattern, every PascalCase_Underscore key. Gone.

2. **The existing MetricMappingService** YAML and its resolution logic. Replaced by the new Canonical Metric Registry and Resolution Pipeline.

3. **The normalize() function** that only strips underscores. Replaced by normalize_for_lookup() that strips all non-alphanumeric characters.

4. **Any direct calls to the SLM (all-MiniLM-L6-v2) for metric resolution.** The SLM should only be used in the RAG pipeline for document chunk retrieval, not for metric name matching.

5. **Any fallback logic that silently uses a raw metric key when resolution fails.** Replace with the explicit graceful degradation described above.

---

## Testing Requirements

Because trust and accuracy are paramount:

1. **Resolution accuracy test suite**: Build a test set of 500+ query → expected_metric_id pairs covering:
   - Exact canonical names
   - Common synonyms and abbreviations
   - Analyst shorthand (e.g., "lev ratio" → net_debt_to_ebitda)
   - Ambiguous terms that should resolve correctly (e.g., "margin" in different contexts)
   - Terms that should NOT match (e.g., "revenue" should not match "cost of revenue")
   - Edge cases: empty strings, nonsense input, SQL injection attempts

2. **Circular dependency detection**: Test that the startup validation catches cycles in computed metric dependencies.

3. **Missing value handling**: Test that computed metrics with missing atomic dependencies return null with an explanation, never 0 or NaN.

4. **Formula accuracy**: For every computed metric formula, verify the output against a hand-calculated expected value using known inputs.

5. **Client overlay isolation**: Verify that synonyms from Client A's overlay don't leak into Client B's resolution.

6. **Performance**: Resolution must complete in <10ms for exact matches, <50ms for fuzzy matches. Cache hits must be <1ms. Test under concurrent load.

7. **Index integrity at startup**: Verify no synonym collisions across metrics. Verify all atomic metrics have valid DB columns. Verify the dependency graph is a DAG.

---

## Success Criteria

The system is working when:

- An analyst can type any reasonable variant of a financial metric and get the correct result on the first try, at least 95% of the time, within the first week of a pilot
- Computed metrics show full formula transparency — every number is traceable to a source filing
- Analytical concepts return composite profiles that save the analyst 15-30 minutes vs manual assembly
- Unresolved queries never produce empty results — they always produce helpful suggestions
- The learning loop turns unresolved queries into new synonyms within one weekly review cycle
- Adding support for a new sector or asset class requires only adding YAML files, no code changes
- Adding support for a new client requires only adding an overlay YAML file, no code changes
