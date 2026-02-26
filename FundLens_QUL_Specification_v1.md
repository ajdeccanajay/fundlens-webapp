# FundLens — Query Understanding Layer (QUL)
## Universal Intent Disambiguation Specification

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Date | February 25, 2026 |
| Author | Ajay + Claude (Architect) |
| Status | Implementation Spec |
| Priority | P0 — Prerequisite for all RAG reliability |

---

# 1. The Problem

Every query failure in FundLens traces back to the same root cause: the system does not understand what the user is asking before it starts retrieving data. The current regex-based ticker extraction and heuristic intent detection create a cascade of failures that no amount of downstream fixing can solve.

> **THE FAILURE CASCADE**
>
> Query: `"What does the analyst say about Apple's services segment?"`
>
> 1. `extractTickers()` finds no regex match for "Apple" → returns `[]`
> 2. No ticker found → prepends workspace ticker (`ABNB`)
> 3. Intent detector sees `ABNB` first → routes to ABNB data
> 4. Structured retrieval pulls ABNB metrics
> 5. Semantic retrieval pulls ABNB narratives
> 6. **User gets a confident, wrong answer about Apple using ABNB data**

This is not fixable with a company-name lookup table. Consider the range of expressions a single analyst might use in one session:

| Query | What It Means | Regex Can Handle? |
|-------|---------------|-------------------|
| "What's Apple's services revenue?" | AAPL, not workspace ticker | No — "Apple" isn't a ticker |
| "How does their services segment compare?" | Workspace ticker (ABNB) | No — needs coreference |
| "Compare Apple and Google's growth" | AAPL + GOOGL, not workspace | No — two company names |
| "What's the revenue?" | Workspace ticker | No — needs context default |
| "What does the iPhone maker spend on R&D?" | AAPL via product reference | No — indirect reference |
| "Revenue for the company in the CIM" | PE uploaded doc entity | No — needs doc context |
| "How does TargetCo compare to public comps?" | Private company + public peers | No — mixed universe |
| "asdfghjkl" | Gibberish — reject | No — gets workspace ticker |

The solution is a lightweight LLM call (Haiku) at the query entrance that provides semantic understanding before any retrieval begins. This is the **Query Understanding Layer (QUL)**.

---

# 2. Architecture Overview

The QUL replaces the current regex + heuristic ticker extraction with a Haiku-first architecture. Every query runs through Haiku for semantic understanding, with a thin cache layer to avoid redundant LLM calls for repeated queries.

> **REVISED DESIGN PRINCIPLE:** The "deterministic when you can" principle applies to *data retrieval and computation*, not to query understanding. Understanding natural language is fundamentally a language model task. Regex cannot reliably parse "the iPhone maker" or "their revenue" or distinguish gibberish from valid input. Haiku can, for $0.001/query and 50-100ms. That's the right trade.

## 2.1 Two-Tier Resolution (Revised from Three-Tier)

| Tier | Method | Latency | Handles |
|------|--------|---------|---------|
| Tier 1: Haiku | Claude Haiku LLM disambiguation — runs on every query | 50-150ms | Everything: entity resolution, intent, temporal, decomposition, gibberish detection (~100%) |
| Tier 2: Cache | LRU cache with aggressive invalidation | < 1ms | Repeated identical queries within same workspace context (~30-40% hit rate) |

**Why regex was removed as Tier 1:** The original spec proposed regex for ~30% of queries (explicit ticker patterns like `$AAPL`). But this creates two code paths to maintain, two sets of bugs to chase, and edge cases where regex and Haiku disagree. Regex also cannot detect gibberish, resolve coreference, or classify intent — so even when it "succeeds" at ticker extraction, every other field in `QueryUnderstanding` still needs Haiku. Running Haiku universally means one code path, one debug surface, one set of logs, and zero regex/Haiku disagreement bugs.

**Cache invalidation rules:** The cache uses a composite key of `(query_normalized, workspace_ticker, workspace_domain, uploaded_doc_ids_hash)`. Any of these changing invalidates relevant entries. TTL is 15 minutes. Workspace switches clear all entries. Document uploads clear all entries. This prevents the stale-context bug where an analyst switches companies and the cache serves the old resolution.

---

# 3. QUL Output Schema

The QUL produces a single structured object that every downstream service consumes. This is the contract between query understanding and query execution.

```typescript
interface QueryUnderstanding {

  // === ENTITY RESOLUTION ===
  entities: ResolvedEntity[];        // All companies/entities referenced
  primaryEntity: ResolvedEntity;     // The main subject of the query
  useWorkspaceContext: boolean;       // Should workspace ticker be applied?

  // === QUERY CLASSIFICATION ===
  intent: QueryIntent;               // What the user wants (see enum below)
  domain: 'public_equity' | 'private_equity' | 'cross_domain' | 'uploaded_doc';
  complexity: 'simple' | 'multi_part' | 'comparative' | 'screening';

  // === QUERY QUALITY ===
  isValidQuery: boolean;             // False for gibberish/incomplete
  queryQualityScore: number;          // 0.0 - 1.0
  rejectionReason?: string;           // Why query was rejected

  // === TEMPORAL RESOLUTION ===
  temporalScope: TemporalScope;       // Period(s) the query covers

  // === DECOMPOSITION ===
  subQueries?: SubQuery[];            // For multi-part queries
  unifyingInstruction?: string;       // How to merge sub-results

  // === ROUTING HINTS ===
  suggestedRetrievalPaths: RetrievalPath[];  // Ordered by priority
  suggestedChart?: ChartType;         // If visual output is appropriate
  needsPeerComparison: boolean;
  peerContext?: string;               // e.g., 'online travel', 'mega-cap tech'

  // === METADATA ===
  resolvedBy: 'tier1_haiku' | 'tier2_cache';
  confidence: number;                 // 0.0 - 1.0
  rawQuery: string;                   // Original user input
  normalizedQuery: string;            // Cleaned/expanded query for retrieval
}
```

### ResolvedEntity

```typescript
interface ResolvedEntity {
  name: string;                    // Display name: 'Apple Inc.'
  ticker?: string;                 // 'AAPL' (null for private companies)
  entityType: 'public_company'     // SEC-filing indexed company
    | 'private_company'            // PE target from uploaded docs
    | 'subsidiary'                 // Maps to parent ticker
    | 'fund'                       // PE fund / LP entity
    | 'uploaded_entity';           // Entity from user-uploaded doc
  source: 'explicit'               // User typed 'AAPL' or 'Apple'
    | 'workspace_context'          // Inherited from workspace ticker
    | 'coreference'               // Resolved from 'their', 'the company'
    | 'uploaded_document'          // Extracted from uploaded CIM/doc
    | 'peer_resolution';           // Added via peer universe lookup
  parentTicker?: string;           // For subsidiaries: AWS -> AMZN
  documentId?: string;             // For uploaded_entity: which doc
}
```

### QueryIntent Enum

This enum covers every query type across both public equity and private equity workflows.

| Intent | Description | Domain | Example |
|--------|-------------|--------|---------|
| `METRIC_LOOKUP` | Single/multi metric for one company | Both | "What's AAPL's revenue?" |
| `METRIC_TREND` | Metric over time range | Both | "Revenue growth last 5 years" |
| `METRIC_COMPARISON` | Same metric across companies | Both | "Compare margins: AAPL vs MSFT" |
| `NARRATIVE_SEARCH` | Qualitative info from filings/docs | Both | "What does mgmt say about AI?" |
| `HYBRID_ANALYSIS` | Metrics + narrative synthesis | Both | "Why did margins decline?" |
| `SEGMENT_ANALYSIS` | Business segment deep-dive | Public | "Break down cloud revenue" |
| `PEER_SCREENING` | Screen universe by criteria | Public | "Tech cos with FCF yield > 5%" |
| `CROSS_TRANSCRIPT` | Search across earnings calls | Public | "How has guidance evolved?" |
| `DEAL_ANALYSIS` | CIM/deal document Q&A | PE | "What are the key risks in the CIM?" |
| `DEAL_COMPARISON` | Compare deal to comps/benchmarks | PE | "How does EBITDA compare to comps?" |
| `MANAGEMENT_ASSESSMENT` | Team/org evaluation from docs | PE | "Key person risk factors?" |
| `RED_FLAG_DETECTION` | Anomaly/risk identification | Both | "Any accounting irregularities?" |
| `PROVOCATION` | Challenge investment thesis | Both | "What could break this thesis?" |
| `IC_MEMO_GENERATION` | Generate investment committee memo | Both | "Generate IC memo from scratchpad" |
| `DOCUMENT_INTAKE` | Process newly uploaded document | Both | "Summarize the uploaded 10-K" |
| `UPLOADED_DOC_QUERY` | Q&A against uploaded documents | Both | "What does the CIM say about revenue?" |
| `CLARIFICATION_NEEDED` | Query too ambiguous to route | Both | "Tell me about the company" |
| `INVALID` | Gibberish, too short, nonsensical | N/A | "asdfghjkl" |

### TemporalScope

```typescript
interface TemporalScope {
  type: 'latest'              // Most recent available
    | 'specific_period'       // e.g., FY2024, Q3 2025
    | 'range'                 // e.g., FY2020-FY2024
    | 'trailing'             // e.g., LTM, TTM
    | 'all_available';       // Full history
  periods?: string[];         // Resolved: ['FY2024'], ['Q1-2025','Q2-2025',...]
  rangeStart?: string;
  rangeEnd?: string;
  fiscalYearEndMonth?: number; // Company's FY end (for normalization)
}
```

### RetrievalPath

```typescript
type RetrievalPath =
  | 'structured_db'         // PostgreSQL metric lookup
  | 'semantic_kb'           // Bedrock Knowledge Base (SEC filings)
  | 'uploaded_doc_rag'      // RAG over user-uploaded documents
  | 'earnings_transcript'   // Cross-transcript search
  | 'peer_comparison'       // PeerComparisonService
  | 'formula_engine'        // Python calculation engine
  | 'deal_library';         // PE deal document store
```

---

# 4. Haiku Prompt Specification

This is the core prompt for Tier 3 resolution. It must be versioned, externalized (not hardcoded in a service file), and loaded from a prompt registry.

> **PROMPT DESIGN PRINCIPLES**
>
> 1. **Exhaustive context:** The prompt receives the full workspace state, not just the query.
> 2. **Structured output:** JSON only, parseable without cleanup.
> 3. **Fail-safe:** When uncertain, output `CLARIFICATION_NEEDED` rather than guess.
> 4. **Domain-aware:** Understands both public equity (SEC filings) and private equity (CIM, deal docs) contexts.

## 4.1 System Prompt

```
You are a financial query disambiguation engine for FundLens, an investment
research platform used by hedge funds and private equity firms.

Your job: Given a user query and workspace context, produce a structured
JSON object that tells the retrieval system exactly what to fetch.

## WORKSPACE CONTEXT

You will receive:
- workspace_ticker: The ticker/company the workspace is scoped to (may be null)
- workspace_domain: 'public_equity' | 'private_equity' | 'uploaded_docs'
- uploaded_documents: List of docs in the current session (name, type, entity)
- conversation_history: Last 3 messages for coreference resolution
- available_tickers: Tickers indexed in FundLens (for validation)

## CORE RULES

1. ENTITY RESOLUTION
   - If the query names a specific company (Apple, Microsoft, Tesla), resolve
     to its ticker. Do NOT use workspace_ticker.
   - If the query uses pronouns (their, its, the company) or no entity at all,
     check conversation_history first, then fall back to workspace_ticker.
   - If the query references a product/subsidiary (AWS, iPhone, YouTube),
     resolve to the parent company ticker.
   - If the query references a private company from uploaded documents,
     set entityType: 'uploaded_entity' with the documentId.
   - If the query mentions "the target" or "TargetCo" in a PE context,
     resolve to the uploaded CIM entity.

2. DOMAIN DETECTION
   - Public equity signals: ticker symbols, SEC filings (10-K, 10-Q),
     earnings calls, segments, guidance, institutional filings
   - Private equity signals: CIM, deal, due diligence, management team,
     data room, investment committee, fund mandate, portfolio company
   - Uploaded doc signals: "the document", "the uploaded file", "the CIM",
     references to content only in uploaded files
   - Cross-domain: comparing private target to public comps

3. QUERY QUALITY
   - Minimum 3 meaningful characters for a valid query
   - Random characters, keyboard mashing, single letters = INVALID
   - Incomplete but interpretable queries ("rev") = valid, low confidence
   - Questions with typos but clear intent = valid, correct the intent

4. TEMPORAL REASONING
   - "last 5 years" = range of 5 fiscal years ending at most recent
   - "latest" or "most recent" = latest available period
   - "Q3" without year = most recent Q3 if available, else prior year
   - "TTM" or "LTM" = trailing twelve months
   - For PE deals, "projected" or "forecast" = forward-looking from CIM

5. MULTI-PART DECOMPOSITION
   - If the query has multiple distinct information needs, decompose
   - Each sub-query gets its own intent, entity, and temporal scope
   - Include unifyingInstruction for how to merge results
   - Order sub-queries by dependency (base data first, comparisons second)

6. CHART INFERENCE
   - Trends over time -> line_chart
   - Company comparisons -> bar_chart
   - Composition/breakdown -> stacked_bar or pie_chart
   - Single metric -> metric_card (no chart)
   - Narrative queries -> none

## OUTPUT FORMAT

Respond with a single JSON object matching the QueryUnderstanding interface.
No markdown, no explanation, no preamble. JSON only.
```

## 4.2 User Message Template

```json
{
  "query": "{{user_query}}",
  "workspace": {
    "ticker": "{{workspace_ticker | null}}",
    "company_name": "{{workspace_company | null}}",
    "domain": "{{public_equity | private_equity | uploaded_docs}}",
    "deal_name": "{{deal_name | null}}"
  },
  "uploaded_documents": [
    {
      "id": "{{doc_id}}",
      "name": "{{filename}}",
      "type": "{{10-K | CIM | earnings_transcript | ...}}",
      "entity": "{{company_name_from_doc}}",
      "ticker": "{{resolved_ticker | null}}"
    }
  ],
  "conversation_history": [
    { "role": "user", "content": "{{last_user_msg}}" },
    { "role": "assistant", "summary": "{{response_summary}}" }
  ],
  "available_tickers": ["AAPL", "MSFT", "ABNB", "..."]
}
```

## 4.3 Few-Shot Examples

These examples train Haiku on the decision boundaries that matter most.

### Example 1: Company name overrides workspace ticker

```json
// Input
{ "query": "What does the analyst say about Apple's services segment?",
  "workspace": { "ticker": "ABNB", "domain": "public_equity" } }

// Output
{
  "entities": [{ "name": "Apple Inc.", "ticker": "AAPL",
    "entityType": "public_company", "source": "explicit" }],
  "primaryEntity": { "name": "Apple Inc.", "ticker": "AAPL",
    "entityType": "public_company", "source": "explicit" },
  "useWorkspaceContext": false,
  "intent": "NARRATIVE_SEARCH",
  "domain": "public_equity",
  "complexity": "simple",
  "isValidQuery": true,
  "queryQualityScore": 0.95,
  "temporalScope": { "type": "latest" },
  "suggestedRetrievalPaths": ["semantic_kb", "earnings_transcript"],
  "needsPeerComparison": false,
  "confidence": 0.95
}
```

### Example 2: Workspace context correctly applied

```json
// Input
{ "query": "What's the revenue?",
  "workspace": { "ticker": "ABNB", "domain": "public_equity" } }

// Output
{
  "entities": [{ "name": "Airbnb", "ticker": "ABNB",
    "entityType": "public_company", "source": "workspace_context" }],
  "useWorkspaceContext": true,
  "intent": "METRIC_LOOKUP",
  "domain": "public_equity",
  "complexity": "simple",
  "isValidQuery": true,
  "queryQualityScore": 0.85,
  "temporalScope": { "type": "latest" },
  "suggestedRetrievalPaths": ["structured_db"],
  "suggestedChart": "metric_card",
  "needsPeerComparison": false,
  "confidence": 0.92
}
```

### Example 3: Gibberish rejection

```json
// Input
{ "query": "asdfghjkl", "workspace": { "ticker": "ABNB" } }

// Output
{
  "entities": [],
  "useWorkspaceContext": false,
  "intent": "INVALID",
  "isValidQuery": false,
  "queryQualityScore": 0.05,
  "rejectionReason": "Query appears to be random characters.",
  "confidence": 0.99
}
```

### Example 4: PE deal document query

```json
// Input
{ "query": "What are the key customer concentration risks in the CIM?",
  "workspace": { "ticker": null, "domain": "private_equity",
    "deal_name": "Project Falcon" },
  "uploaded_documents": [
    { "id": "doc_001", "name": "Project_Falcon_CIM.pdf",
      "type": "CIM", "entity": "TargetCo Inc.", "ticker": null }
  ] }

// Output
{
  "entities": [{ "name": "TargetCo Inc.", "ticker": null,
    "entityType": "uploaded_entity", "source": "uploaded_document",
    "documentId": "doc_001" }],
  "useWorkspaceContext": false,
  "intent": "DEAL_ANALYSIS",
  "domain": "private_equity",
  "complexity": "simple",
  "isValidQuery": true,
  "queryQualityScore": 0.95,
  "temporalScope": { "type": "all_available" },
  "suggestedRetrievalPaths": ["uploaded_doc_rag"],
  "needsPeerComparison": false,
  "confidence": 0.95
}
```

### Example 5: Cross-domain PE vs public comps

```json
// Input
{ "query": "How does TargetCo's EBITDA margin compare to AAPL and MSFT?",
  "workspace": { "domain": "private_equity", "deal_name": "Project Falcon" },
  "uploaded_documents": [
    { "id": "doc_001", "type": "CIM", "entity": "TargetCo Inc." }
  ] }

// Output
{
  "entities": [
    { "name": "TargetCo Inc.", "entityType": "uploaded_entity",
      "source": "uploaded_document", "documentId": "doc_001" },
    { "name": "Apple Inc.", "ticker": "AAPL",
      "entityType": "public_company", "source": "explicit" },
    { "name": "Microsoft", "ticker": "MSFT",
      "entityType": "public_company", "source": "explicit" }
  ],
  "useWorkspaceContext": false,
  "intent": "DEAL_COMPARISON",
  "domain": "cross_domain",
  "complexity": "comparative",
  "isValidQuery": true,
  "temporalScope": { "type": "latest" },
  "subQueries": [
    { "intent": "METRIC_LOOKUP", "entity": "TargetCo Inc.",
      "metric": "ebitda_margin", "path": "uploaded_doc_rag" },
    { "intent": "METRIC_LOOKUP", "entity": "AAPL",
      "metric": "ebitda_margin", "path": "structured_db" },
    { "intent": "METRIC_LOOKUP", "entity": "MSFT",
      "metric": "ebitda_margin", "path": "structured_db" }
  ],
  "unifyingInstruction": "Compare TargetCo EBITDA margin from CIM against public comps. Note any differences in margin definition or period.",
  "suggestedRetrievalPaths": ["uploaded_doc_rag", "structured_db"],
  "suggestedChart": "bar_chart",
  "needsPeerComparison": true,
  "confidence": 0.90
}
```

### Example 6: Coreference resolution from conversation history

```json
// Input
{ "query": "How has it changed over the past 3 years?",
  "workspace": { "ticker": "ABNB" },
  "conversation_history": [
    { "role": "user", "content": "What is Tesla's free cash flow?" },
    { "role": "assistant", "summary": "TSLA FCF was $4.4B in FY2024" }
  ] }

// Output
{
  "entities": [{ "name": "Tesla", "ticker": "TSLA",
    "entityType": "public_company", "source": "coreference" }],
  "useWorkspaceContext": false,
  "intent": "METRIC_TREND",
  "complexity": "simple",
  "temporalScope": { "type": "range",
    "rangeStart": "FY2022", "rangeEnd": "FY2024" },
  "suggestedRetrievalPaths": ["structured_db"],
  "suggestedChart": "line_chart",
  "confidence": 0.88
}
```

### Example 7: Multi-part query with decomposition

```json
// Input
{ "query": "What is NVDA's cash position, how has it changed over 5 years, and how does it compare to AMZN?",
  "workspace": { "ticker": "ABNB" } }

// Output
{
  "entities": [
    { "name": "NVIDIA", "ticker": "NVDA", "source": "explicit" },
    { "name": "Amazon", "ticker": "AMZN", "source": "explicit" }
  ],
  "primaryEntity": { "name": "NVIDIA", "ticker": "NVDA" },
  "useWorkspaceContext": false,
  "intent": "METRIC_COMPARISON",
  "complexity": "multi_part",
  "subQueries": [
    { "intent": "METRIC_LOOKUP", "entity": "NVDA",
      "metric": "cash_and_cash_equivalents",
      "temporal": { "type": "latest" } },
    { "intent": "METRIC_TREND", "entity": "NVDA",
      "metric": "cash_and_cash_equivalents",
      "temporal": { "type": "range", "rangeStart": "FY2020", "rangeEnd": "FY2024" } },
    { "intent": "METRIC_TREND", "entity": "AMZN",
      "metric": "cash_and_cash_equivalents",
      "temporal": { "type": "range", "rangeStart": "FY2020", "rangeEnd": "FY2024" } }
  ],
  "unifyingInstruction": "Present NVDA current cash, then 5-year trend with YoY changes, then compare trajectory to AMZN.",
  "suggestedChart": "line_chart",
  "confidence": 0.92
}
```

### Example 8: PE management assessment from uploaded docs

```json
// Input
{ "query": "Assess key person risk and management depth",
  "workspace": { "domain": "private_equity", "deal_name": "Project Falcon" },
  "uploaded_documents": [
    { "id": "doc_001", "type": "CIM", "entity": "TargetCo Inc." },
    { "id": "doc_002", "type": "management_presentation",
      "entity": "TargetCo Inc." }
  ] }

// Output
{
  "entities": [{ "name": "TargetCo Inc.",
    "entityType": "uploaded_entity", "source": "uploaded_document",
    "documentId": "doc_001" }],
  "intent": "MANAGEMENT_ASSESSMENT",
  "domain": "private_equity",
  "isValidQuery": true,
  "temporalScope": { "type": "all_available" },
  "suggestedRetrievalPaths": ["uploaded_doc_rag"],
  "confidence": 0.90
}
```

---

# 5. Private Equity Domain Rules

PE workflows introduce entity resolution challenges that don't exist in public equity. There are no tickers, companies may be referred to by deal codenames, and the same query might reference both private targets and public comparables.

## 5.1 PE Entity Resolution Hierarchy

| Reference In Query | Resolution | EntityType | Source |
|--------------------|------------|------------|--------|
| "TargetCo" / "the target" | Primary entity from CIM | `uploaded_entity` | `uploaded_document` |
| "Project Falcon" | Deal codename → CIM entity | `uploaded_entity` | `uploaded_document` |
| "the company in the CIM" | CIM entity | `uploaded_entity` | `uploaded_document` |
| "their revenue" (no prior context) | CIM entity if PE workspace | `uploaded_entity` | `workspace_context` |
| "AAPL" or "Apple" in PE workspace | Public company (NOT the target) | `public_company` | `explicit` |
| "public comps" / "comparable companies" | Resolve from peer universe | `public_company` | `peer_resolution` |
| "the portfolio company" | Active deal entity | `uploaded_entity` | `workspace_context` |
| "Fund III" / "the fund" | PE fund entity | `fund` | `explicit` |

## 5.2 Cross-Domain Query Patterns

The most complex PE queries span both uploaded documents and the public equity database. The QUL must correctly decompose these into sub-queries that route to different retrieval paths.

| Pattern | Decomposition | Retrieval Paths |
|---------|---------------|-----------------|
| "Compare target's margins to AAPL" | Sub1: Target margins from CIM (uploaded_doc_rag). Sub2: AAPL margins from DB (structured_db). | `uploaded_doc_rag` + `structured_db` |
| "Is the target's growth better than industry?" | Sub1: Target growth from CIM. Sub2: Industry growth from sector screening. | `uploaded_doc_rag` + `structured_db` + `peer_comparison` |
| "Revenue quality assessment with public benchmarks" | Sub1: Target revenue details from CIM. Sub2: Public comp revenue quality metrics. | `uploaded_doc_rag` + `structured_db` + `semantic_kb` |
| "Generate IC memo with public comp overlay" | Full deal data from uploaded docs + public comp data for context. | `uploaded_doc_rag` + `structured_db` + `deal_library` |

## 5.3 PE-Specific Intent Signals

Certain keywords and phrases are strong signals for PE domain classification. The Haiku prompt uses these to correctly identify PE vs. public equity context even when the workspace domain is ambiguous.

| Signal Category | Keywords/Phrases | Maps To Intent |
|----------------|------------------|----------------|
| Deal evaluation | CIM, information memorandum, teaser, data room, NDA | `DEAL_ANALYSIS` |
| Financial diligence | quality of earnings, normalized EBITDA, add-backs, pro forma | `DEAL_ANALYSIS` |
| Management | key person risk, management depth, org chart, succession | `MANAGEMENT_ASSESSMENT` |
| Investment committee | IC memo, investment committee, deal review, approval | `IC_MEMO_GENERATION` |
| Comparables | public comps, comparable companies, trading multiples, precedent transactions | `DEAL_COMPARISON` |
| Red flags | customer concentration, vendor dependency, regulatory risk, litigation | `RED_FLAG_DETECTION` |
| Fund operations | fund mandate, investment criteria, portfolio construction, LP | `CLARIFICATION_NEEDED` |

---

# 6. Implementation Plan

## 6.1 Service Architecture

```typescript
// New file: src/rag/query-understanding.service.ts

@Injectable()
export class QueryUnderstandingService {
  private cache: LRUCache<string, QueryUnderstanding>;
  private availableMetrics: MetricSummary[];

  async understand(
    query: string,
    workspace: WorkspaceContext,
    uploadedDocs: UploadedDocument[],
    conversationHistory: Message[],
  ): Promise<QueryUnderstanding> {

    // Tier 1 (Cache): Check for identical recent resolution
    const cacheKey = this.buildCacheKey(query, workspace, uploadedDocs);
    const cached = this.cache.get(cacheKey);
    if (cached) return { ...cached, resolvedBy: 'tier2_cache' };

    // Tier 2 (Haiku): Universal LLM disambiguation — always runs on cache miss
    const understanding = await this.callHaiku(
      query, workspace, uploadedDocs, conversationHistory
    );

    // Cache the result (invalidated on workspace/doc changes)
    this.cache.set(cacheKey, understanding);
    return understanding;
  }

  private buildCacheKey(
    query: string, workspace: WorkspaceContext, docs: UploadedDocument[]
  ): string {
    // Composite key ensures cache invalidation on context change
    const docHash = docs.map(d => d.id).sort().join(',');
    return `${this.normalize(query)}|${workspace.ticker}|${workspace.domain}|${docHash}`;
  }

  private async callHaiku(...): Promise<QueryUnderstanding> {
    const prompt = this.promptRegistry.get('qul-v1');
    const userMessage = this.buildUserMessage(
      query, workspace, uploadedDocs, conversationHistory
    );

    const response = await this.bedrockClient.invoke({
      modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      messages: [{ role: 'user', content: userMessage }],
      system: prompt.systemPrompt,
      maxTokens: 1024,
      temperature: 0.0,  // Deterministic output
    });

    return this.parseAndValidate(response);
  }
}
```

## 6.2 Integration Point

The QUL replaces the current `extractTickers()` + `enhancedQuery` pattern in `ResearchAssistantService.sendMessage()`. Instead of building the query context piecemeal, the entire query understanding happens in one call at the top of the pipeline.

```typescript
// BEFORE (current code)
const tickers = extractTickers(query);
const enhanced = tickers.length === 0
  ? `${workspaceTicker} ${query}`  // BUG: always prepends
  : query;
const intent = await this.intentDetector.classify(enhanced);

// AFTER (with QUL)
const understanding = await this.queryUnderstanding.understand(
  query, workspace, uploadedDocs, conversationHistory
);

if (!understanding.isValidQuery) {
  return this.handleInvalidQuery(understanding);
}

// All downstream services consume `understanding` directly
const results = await this.orchestrator.execute(understanding);
```

## 6.3 Prompt Registry

All prompts must be externalized from service code and stored in a versioned registry. This enables A/B testing, prompt iteration without code deploys, and audit trails.

```typescript
// New file: src/prompts/prompt-registry.service.ts

interface PromptVersion {
  id: string;                    // 'qul-v1'
  version: string;               // '1.0.3'
  systemPrompt: string;
  fewShotExamples: FewShotExample[];
  metadata: {
    author: string;
    updatedAt: Date;
    testAccuracy: number;         // From eval suite
    notes: string;
  };
}

// Stored in S3: s3://fundlens-prompts/{tenant}/qul-v1.json
// Loaded at startup, refreshed on signal
// Tenant-specific overrides supported for custom firm vocabulary
```

## 6.4 Evaluation Suite

Before deploying the QUL, build an evaluation suite of 100+ query/expected-output pairs covering every intent type, domain, and edge case. This becomes the regression test that prevents prompt updates from breaking existing behavior.

| Category | Count | Examples |
|----------|-------|---------|
| Explicit ticker queries | 15 | `AAPL revenue`, `$MSFT margins`, `TSLA:US FCF` |
| Company name resolution | 15 | Apple, Microsoft, Alphabet/Google, Tesla |
| Workspace context (correct use) | 10 | "What's the revenue?", "How are margins trending?" |
| Workspace context (override) | 10 | Apple's revenue (in ABNB workspace) |
| Coreference resolution | 10 | Follow-ups: "How has it changed?", "Compare to peers" |
| PE deal queries | 10 | CIM risks, management depth, customer concentration |
| Cross-domain PE + public | 10 | Compare target to AAPL, public comp benchmarking |
| Multi-part decomposition | 10 | NVDA cash + 5yr trend + vs AMZN |
| Gibberish/invalid | 5 | asdfghjkl, !!!, a, 123 |
| Ambiguous (needs clarification) | 5 | "Tell me about the company", "What should I know?" |

> **ACCURACY TARGET:** The QUL eval suite must achieve **95%+ accuracy** on entity resolution and **90%+** on intent classification before deployment. Any prompt update that drops accuracy below these thresholds is blocked.

---

# 7. Downstream Impact

The QUL is not just an intent detector replacement. It restructures how every downstream service receives its inputs. Here is what changes and what stays the same.

| Service | Before QUL | After QUL | Change Required |
|---------|-----------|-----------|-----------------|
| `IntentDetectorService` | Regex + Haiku classification | Replaced by QUL | Delete / wrap as legacy fallback |
| `MetricRegistryService` | Receives raw query text | Receives `understanding.subQueries[].metric` | Minor: accept metric hint |
| `StructuredRetriever` | Receives enhancedQuery + ticker | Receives `ResolvedEntity` + `TemporalScope` | Moderate: new input interface |
| `SemanticRetriever` (Bedrock KB) | Receives enhancedQuery (ABNB prepended) | Receives `normalizedQuery` scoped to correct entity | Moderate: query construction |
| `PeerComparisonService` | Manual ticker list | Receives `peerContext` from QUL | Minor: accept peer hint |
| `HybridSynthesisService` | Builds context from raw results | Receives full `QueryUnderstanding` for grounded synthesis | Minor: richer context |
| `UploadedDocService` | Separate pipeline | Unified: QUL routes `uploaded_doc_rag` when appropriate | Moderate: unified interface |
| `QueryDecomposerService` | Separate LLM call | Absorbed into QUL (`subQueries` field) | Delete: consolidated into QUL |

> **KEY ARCHITECTURAL WIN:** The QUL consolidates three separate LLM calls (intent detection, query decomposition, ticker disambiguation) into a single Haiku call. This reduces latency, reduces cost, and eliminates the inconsistency bugs that arise when these three systems disagree.

---

# 8. QUL → Deterministic Engine Integration

The QUL tells the system *what* the user wants. The deterministic engine *computes* it. This section specifies exactly how QUL output flows into the three-layer metric resolution stack (MetricRegistryService → FormulaResolutionService → ConceptRegistryService) and what changes for PE uploaded documents where metrics aren't pre-indexed.

## 8.1 The Full Data Flow

```
User Query
    │
    ▼
┌─────────────────────────────────┐
│  QUL (Query Understanding)      │
│  → entities, intent, temporal,  │
│    metric hints, retrieval paths│
└──────────────┬──────────────────┘
               │
    ┌──────────┴───────────┐
    │                      │
    ▼                      ▼
 metric hint           no metric hint
 present?              (narrative/concept query)
    │                      │
    ▼                      ▼
┌────────────────┐   ┌─────────────────────┐
│ MetricRegistry │   │ ConceptRegistry     │
│ .resolve()     │   │ .matchConcept()     │
│                │   │ → metric bundle     │
│ Returns:       │   │ → resolve each via  │
│ MetricResol[]  │   │   MetricRegistry    │
│ with db_column,│   └─────────┬───────────┘
│ type, formula  │             │
└───────┬────────┘             │
        │              ┌───────┘
        ▼              ▼
   ┌─────────────────────────┐
   │ Route by metric type    │
   │                         │
   │ atomic → StructuredDB   │
   │ computed → FormulaEngine│
   │ extracted → DocExtract  │  ← NEW for PE
   └─────────┬───────────────┘
             │
             ▼
   ┌─────────────────────────┐
   │ Deterministic Results   │
   │ + Semantic Context      │
   │ → HybridSynthesis      │
   └─────────────────────────┘
```

## 8.2 Metric Hint Resolution

The QUL's `subQueries[].metric` field contains a **natural language metric hint** (e.g., `"ebitda_margin"`, `"cash_and_cash_equivalents"`, `"revenue growth"`). This hint flows into the existing MetricRegistryService, but with a key improvement: **the QUL pre-normalizes the hint**, so the registry gets a cleaner input than raw user text.

```typescript
// The orchestrator bridges QUL output → MetricRegistry

async executeWithQUL(understanding: QueryUnderstanding): Promise<OrchestratorResult> {
  
  // For each sub-query (or the main query if no decomposition)
  const queries = understanding.subQueries?.length
    ? understanding.subQueries
    : [understanding];

  const results = await Promise.all(queries.map(async (sq) => {
    const entity = sq.entity || understanding.primaryEntity;
    
    // STEP 1: Resolve metric hint → MetricResolution
    // This is the existing MetricRegistryService call, but with cleaner input
    const metricResolutions = sq.metric
      ? await this.metricRegistry.resolveMultiple([sq.metric])
      : [];

    // STEP 2: Route by metric type + entity type
    for (const resolution of metricResolutions) {
      if (entity.entityType === 'uploaded_entity') {
        // PE uploaded doc → DocumentMetricExtractor (NEW)
        return this.extractFromDocument(entity, resolution, sq.temporal);
      } else if (resolution.type === 'atomic') {
        // Public company atomic metric → PostgreSQL
        return this.structuredRetriever.retrieve(
          entity.ticker, resolution.db_column, sq.temporal
        );
      } else if (resolution.type === 'computed') {
        // Computed metric → FormulaResolutionService → Python /calculate
        return this.formulaResolver.resolveComputed(
          resolution, entity.ticker, sq.temporal
        );
      }
    }

    // No metric resolution → narrative/semantic path
    return this.semanticRetriever.search(
      understanding.normalizedQuery, entity
    );
  }));

  return this.synthesize(understanding, results);
}
```

## 8.3 The Three Metric Type Flows

### Flow A: Atomic Metric (Public Equity)

```
QUL: { metric: "revenue", entity: { ticker: "AAPL" }, temporal: { type: "latest" } }
  │
  ▼
MetricRegistry.resolve("revenue")
  → { canonical_id: "revenue", db_column: "revenue", type: "atomic", confidence: 0.99 }
  │
  ▼
StructuredRetriever.retrieve("AAPL", "revenue", "latest")
  → SELECT value, fiscal_period FROM financial_metrics
    WHERE ticker = 'AAPL' AND normalized_metric = 'revenue'
    ORDER BY fiscal_period DESC LIMIT 1
  │
  ▼
MetricResult: { ticker: "AAPL", value: 394328000000, period: "FY2024" }
```

**No changes needed.** This path works today and the QUL just feeds it cleaner inputs.

### Flow B: Computed Metric (Public Equity)

```
QUL: { metric: "net_debt_to_ebitda", entity: { ticker: "ABNB" }, temporal: { type: "latest" } }
  │
  ▼
MetricRegistry.resolve("net_debt_to_ebitda")
  → { canonical_id: "net_debt_to_ebitda", type: "computed",
      formula: "net_debt / ebitda",
      dependencies: ["net_debt", "ebitda"] }
  │
  ▼
FormulaResolutionService.resolveComputed()
  → Resolve dependency DAG:
    net_debt (computed) → total_debt (atomic) - cash_and_cash_equivalents (atomic)
    ebitda (computed) → operating_income (atomic) + depreciation_amortization (atomic)
  → Batch fetch all atomic dependencies from PostgreSQL
  → Send to Python /calculate endpoint
  │
  ▼
ComputedMetricResult: {
  value: 1.8,
  formula: "net_debt / ebitda",
  resolved_inputs: {
    net_debt: { value: 5400000000, formula: "total_debt - cash" },
    ebitda: { value: 3000000000, formula: "op_income + d&a" }
  }
}
```

**No changes needed** to the formula engine itself. The QUL just provides the correct entity/ticker so the right company's data is fetched.

### Flow C: PE Document-Extracted Metric (NEW)

This is the missing piece. When the QUL resolves an entity as `uploaded_entity` and a metric is requested, there's no PostgreSQL row to look up — the data lives in the uploaded CIM/financial model.

```
QUL: { metric: "ebitda_margin", entity: { entityType: "uploaded_entity",
       documentId: "doc_001" }, temporal: { type: "latest" } }
  │
  ▼
MetricRegistry.resolve("ebitda_margin")
  → { canonical_id: "ebitda_margin", type: "computed",
      formula: "ebitda / revenue * 100",
      dependencies: ["ebitda", "revenue"] }
  │
  ▼
DocumentMetricExtractor.extract(documentId, ["ebitda", "revenue"])
  → Search uploaded document chunks for tables/financial statements
  → Use LLM extraction with structured output:
    "From the financial data in this document, extract:
     1. EBITDA (or operating income + D&A if EBITDA not stated)
     2. Revenue / Net Sales
     Return as JSON with value, period, page_reference, confidence."
  → Validate: numbers must be parseable, periods must be consistent
  │
  ▼
ExtractedMetricResult: {
  source: "uploaded_document",
  documentId: "doc_001",
  metrics: {
    ebitda: { value: 45000000, period: "LTM Sep 2025", confidence: 0.92,
              page_ref: "CIM p.34", extraction_note: "Adjusted EBITDA per management" },
    revenue: { value: 180000000, period: "LTM Sep 2025", confidence: 0.95,
               page_ref: "CIM p.31" }
  }
}
  │
  ▼
FormulaResolutionService.computeFromExtracted(formula, extractedMetrics)
  → ebitda_margin = 45000000 / 180000000 * 100 = 25.0%
  │
  ▼
ComputedMetricResult: {
  value: 25.0,
  source: "uploaded_document",
  formula: "ebitda / revenue * 100",
  resolved_inputs: {
    ebitda: { value: 45000000, source: "CIM p.34", confidence: 0.92 },
    revenue: { value: 180000000, source: "CIM p.31", confidence: 0.95 }
  },
  caveats: ["Uses management-adjusted EBITDA, not GAAP"]
}
```

## 8.4 DocumentMetricExtractor Service (NEW)

This is the new service that bridges uploaded PE documents into the deterministic engine. It does **not** replace the formula engine — it provides the atomic inputs that the formula engine needs when those inputs come from documents rather than PostgreSQL.

```typescript
// New file: src/rag/document-metric-extractor.service.ts

@Injectable()
export class DocumentMetricExtractorService {

  /**
   * Extract specific metrics from an uploaded document.
   * Returns structured values that can be fed into FormulaResolutionService.
   */
  async extract(
    documentId: string,
    metricIds: string[],          // Canonical metric IDs: ['revenue', 'ebitda']
    temporalScope: TemporalScope,
  ): Promise<ExtractedMetricResult> {

    // 1. Get relevant chunks from the uploaded document
    //    Prioritize financial statement tables, exhibits, summary pages
    const chunks = await this.uploadedDocRAG.getFinancialChunks(documentId);

    // 2. Build extraction prompt with metric definitions from registry
    const metricDefs = metricIds.map(id => ({
      id,
      ...this.metricRegistry.getDefinition(id),
    }));

    // 3. LLM extraction with structured output
    const extracted = await this.bedrockClient.invoke({
      modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',  // Sonnet for accuracy
      system: this.buildExtractionPrompt(metricDefs, temporalScope),
      messages: [{ role: 'user', content: this.formatChunks(chunks) }],
      temperature: 0.0,
    });

    // 4. Parse and validate
    const parsed = this.parseExtractionResponse(extracted);
    return this.validate(parsed, metricDefs);
  }

  private buildExtractionPrompt(metrics: MetricDefinition[], temporal: TemporalScope): string {
    return `You are a financial data extraction engine. Extract the following
metrics from the provided document content. Return ONLY a JSON object.

METRICS TO EXTRACT:
${metrics.map(m => `- ${m.canonical_id}: ${m.display_name}
  Synonyms in documents: ${m.synonyms.slice(0, 5).join(', ')}
  Expected on: ${m.statement || 'any financial statement'}
  ${m.calculation_notes || ''}`).join('\n')}

TEMPORAL SCOPE: ${temporal.type === 'latest' ? 'Most recent period available' : temporal.type}

RULES:
1. Extract exact values as stated in the document. Do NOT compute or estimate.
2. For each metric, provide: value (number), period (e.g., "FY2024", "LTM Sep 2025"),
   page_reference (page number or section), confidence (0.0-1.0).
3. If a metric is not found, set value to null with explanation.
4. Note if the metric uses non-standard definitions (e.g., "Adjusted EBITDA" vs GAAP).
5. All values in the document's stated currency and units.
6. If multiple periods are available, extract all and label each.

OUTPUT FORMAT (JSON only, no markdown):
{
  "metrics": {
    "<canonical_id>": {
      "value": <number or null>,
      "period": "<period string>",
      "page_reference": "<page or section>",
      "confidence": <0.0-1.0>,
      "notes": "<any caveats, adjustments, non-standard definitions>"
    }
  },
  "currency": "<USD, EUR, etc.>",
  "document_period": "<overall period covered>"
}`;
  }
}
```

## 8.5 Cross-Domain Computation: PE Target vs Public Comps

The most powerful use case is when the QUL decomposes a cross-domain query and the deterministic engine computes metrics from two different sources, then the synthesis layer compares them.

```
Query: "How does TargetCo's EBITDA margin compare to AAPL and MSFT?"

QUL Output:
  subQueries:
    [0] { entity: TargetCo (uploaded), metric: ebitda_margin, path: uploaded_doc_rag }
    [1] { entity: AAPL (public),       metric: ebitda_margin, path: structured_db }
    [2] { entity: MSFT (public),       metric: ebitda_margin, path: structured_db }

Orchestrator executes in parallel:
  [0] → DocumentMetricExtractor → extract revenue + ebitda from CIM
       → FormulaResolver → compute margin = 25.0%
       → Source: "CIM p.34, management-adjusted EBITDA"

  [1] → MetricRegistry.resolve("ebitda_margin") → type: computed
       → FormulaResolver → fetch AAPL atomics from PostgreSQL
       → Python /calculate → margin = 33.2%
       → Source: "AAPL 10-K FY2024"

  [2] → MetricRegistry.resolve("ebitda_margin") → type: computed
       → FormulaResolver → fetch MSFT atomics from PostgreSQL
       → Python /calculate → margin = 44.1%
       → Source: "MSFT 10-K FY2024"

Synthesis receives:
  TargetCo: 25.0% (CIM, adjusted)
  AAPL: 33.2% (10-K, GAAP)
  MSFT: 44.1% (10-K, GAAP)
  ⚠️ Caveat: TargetCo uses adjusted EBITDA; public comps use GAAP.
     Margin definitions may not be directly comparable.
```

> **CRITICAL DESIGN DECISION:** The DocumentMetricExtractor uses the **same MetricRegistry and FormulaResolutionService** as public equity metrics. The only difference is the *source* of atomic inputs (uploaded doc vs PostgreSQL). This means every computed formula, every dependency chain, every calculation transparency feature works identically for PE and public equity. One engine, two input sources.

## 8.6 Storing Extracted PE Metrics

Extracted metrics from uploaded documents should be cached so repeated queries against the same CIM don't trigger re-extraction. Two storage tiers:

### Tier 1: Session Cache (Immediate)

```typescript
// In-memory, scoped to the deal workspace session
// Key: documentId + metricId + period
// TTL: session lifetime (or until document is re-uploaded)

interface ExtractedMetricCache {
  get(docId: string, metricId: string): CachedExtraction | null;
  set(docId: string, metricId: string, extraction: ExtractedMetricResult): void;
  invalidate(docId: string): void;  // When doc is re-uploaded
}
```

### Tier 2: Deal Library Persistence (Background)

```typescript
// After extraction, async-persist to the Deal Library for future queries
// Stored in DynamoDB with tenant + deal isolation

interface PersistedExtraction {
  tenantId: string;
  dealId: string;
  documentId: string;
  metricId: string;               // canonical_id from MetricRegistry
  value: number;
  period: string;
  currency: string;
  pageReference: string;
  confidence: number;
  extractionModel: string;        // Which LLM version extracted this
  extractedAt: Date;
  validatedByAnalyst: boolean;    // Analyst can confirm/correct
  analystOverride?: number;       // If analyst corrects the extraction
}
```

This means the **first** query against a CIM triggers LLM extraction (~2-5 seconds). Every subsequent query for the same metrics uses cached deterministic values (~sub-millisecond). And once an analyst validates or corrects an extracted value, it becomes as trusted as a PostgreSQL value from SEC filings.

## 8.7 Updated QUL Schema: Metric Resolution Fields

Add these fields to `SubQuery` in the QUL output to give the orchestrator explicit routing signals:

```typescript
interface SubQuery {
  intent: QueryIntent;
  entity: string | ResolvedEntity;
  metric?: string;                    // Natural language hint: "ebitda_margin"
  temporal?: TemporalScope;
  path: RetrievalPath;

  // NEW: Deterministic engine hints
  metricType?: 'atomic' | 'computed' | 'concept' | 'extracted';
  requiresFormula?: boolean;          // True if computed or extracted + computed
  extractionSource?: 'postgresql' | 'uploaded_document' | 'external_feed';
  conceptId?: string;                 // If this is part of a concept bundle
}
```

The Haiku prompt should be updated to output `metricType` when it can determine it. For example, "What's the revenue?" is clearly atomic, "What's the EBITDA margin?" is clearly computed, "How levered is the company?" is a concept. This hint saves the orchestrator a MetricRegistry lookup, though the registry should still validate.

## 8.8 Formula Engine Compatibility Matrix

| Scenario | Atomic Source | Formula Engine | Works Today? |
|----------|--------------|----------------|--------------|
| Public equity, atomic metric | PostgreSQL | N/A (direct lookup) | ✅ Yes |
| Public equity, computed metric | PostgreSQL → atomics | Python /calculate | ✅ Yes |
| Public equity, concept bundle | PostgreSQL → multiple atomics | Python /calculate × N | ✅ Yes |
| PE uploaded doc, atomic metric | DocumentMetricExtractor | N/A (direct extraction) | 🔨 New |
| PE uploaded doc, computed metric | DocumentMetricExtractor → atomics | Python /calculate | 🔨 New (extractor only) |
| Cross-domain comparison | PostgreSQL + DocExtractor | Python /calculate | 🔨 New (extractor + orchestrator) |
| PE doc with analyst override | DynamoDB (persisted) | Python /calculate | 🔨 New (persistence layer) |

The key insight: **the formula engine itself doesn't change**. It takes atomic values in and computes results out. The only new work is the DocumentMetricExtractor that provides atomic values from uploaded documents instead of PostgreSQL. Everything downstream — formula DAG resolution, Python /calculate, transparency metadata — works unchanged.

## 8.9 Closing the Loop: Admin Formula Management Screen

The admin formula management screen (designed as `pending_formulas CRUD` in the master spec) is the control plane for the entire deterministic engine. With the QUL in place, it needs to serve a broader role: it's where new metrics, formulas, synonyms, and PE-specific definitions enter the system — and where the QUL's Haiku prompt gets the vocabulary it needs to route correctly.

### The Full Lifecycle

```
                    ┌─────────────────────────────┐
                    │  ADMIN FORMULA MANAGEMENT    │
                    │  (Control Plane)             │
                    │                              │
                    │  • Add/edit atomic metrics   │
                    │  • Add/edit computed formulas │
                    │  • Add/edit synonyms         │
                    │  • Add PE-specific metrics    │
                    │  • Review pending suggestions │
                    │  • Manage client overlays     │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │  YAML Registry (S3)          │
                    │  universal/, computed/,       │
                    │  sector/, pe_specific/,       │
                    │  clients/                     │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
    │ MetricReg.  │  │ FormulaRes.  │  │ QUL Haiku    │
    │ (in-memory  │  │ (dependency  │  │ (knows what  │
    │  index)     │  │  DAG)        │  │  metrics     │
    │             │  │              │  │  exist)      │
    └──────┬──────┘  └──────┬──────┘  └──────┬───────┘
           │                │                │
           └────────────────┴────────────────┘
                            │
                    ┌───────▼────────┐
                    │  Query Results  │
                    │  → Analyst UI   │
                    └───────┬────────┘
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
    ┌──────────────┐ ┌───────────┐ ┌────────────────┐
    │ Unresolved   │ │ Analyst   │ │ PE Extraction   │
    │ query log    │ │ correction│ │ new metric seen │
    │ (cache miss) │ │ (clicked  │ │ in CIM but not  │
    │              │ │  "did you │ │ in registry     │
    │              │ │  mean?")  │ │                 │
    └──────┬───────┘ └─────┬─────┘ └───────┬────────┘
           │               │               │
           └───────────────┴───────────────┘
                            │
                    ┌───────▼────────┐
                    │  Pending Queue  │
                    │  (DynamoDB)     │
                    └───────┬────────┘
                            │
                    ┌───────▼──────────────────┐
                    │  ADMIN FORMULA MANAGEMENT │
                    │  (Review & Approve)       │
                    └──────────────────────────┘
```

### What the Admin Screen Must Support (Updated for QUL)

**Existing capabilities (from master spec):**

1. **CRUD for atomic metrics** — Add new metrics with `canonical_id`, `display_name`, `db_column`, `statement`, `synonyms[]`, `xbrl_tags[]`
2. **CRUD for computed formulas** — Add formulas with `formula` expression, `dependencies[]`, `output_format`, optional `interpretation` thresholds (healthy/watch/distressed)
3. **CRUD for synonyms** — Add new synonyms to existing metrics, manage client-specific overlays
4. **Pending queue review** — Approve/reject suggestions from the learning loop

**New capabilities required for QUL integration:**

5. **QUL vocabulary sync** — When a new metric or synonym is added via admin, the QUL's Haiku prompt context must be updated. Two approaches:

```typescript
// Option A: Dynamic available_metrics in QUL user message (recommended)
// The QUL already sends available_tickers to Haiku.
// Extend this with available_metrics so Haiku knows what's resolvable.

interface QULUserMessage {
  query: string;
  workspace: WorkspaceContext;
  // ... existing fields ...
  available_metrics: MetricSummary[];  // NEW: from MetricRegistry
}

interface MetricSummary {
  canonical_id: string;           // "net_debt_to_ebitda"
  display_name: string;           // "Net Debt / EBITDA"
  type: 'atomic' | 'computed';
  top_synonyms: string[];         // Top 5 most common synonyms
  asset_class: string[];          // ['public_equity', 'private_equity']
}

// This list is generated at startup from the YAML registry
// and refreshed when admin makes changes.
// Haiku uses it to output accurate metric hints in subQueries.
```

```typescript
// Option B: Periodic prompt rebuild (simpler, less dynamic)
// When admin saves changes, trigger a background job that:
// 1. Reads all YAML registries
// 2. Rebuilds the QUL few-shot examples with new metric names
// 3. Writes updated prompt to S3 prompt registry
// 4. Signals QUL service to reload

// This is simpler but has a delay (minutes, not seconds).
// Recommend Option A for production, Option B as MVP.
```

6. **PE metric registration from extraction** — When the `DocumentMetricExtractor` encounters a metric in a CIM that doesn't exist in the registry (e.g., a PE-specific KPI like "monthly recurring revenue" for a SaaS target), it should create a `pending_metric` entry for admin review:

```typescript
interface PendingMetric {
  id: string;
  source: 'extraction' | 'analyst_correction' | 'unresolved_query';
  suggestedCanonicalId: string;     // LLM-suggested: "monthly_recurring_revenue"
  suggestedDisplayName: string;     // "Monthly Recurring Revenue (MRR)"
  suggestedType: 'atomic' | 'computed';
  suggestedFormula?: string;        // If computed: "arr / 12"
  suggestedSynonyms: string[];      // ["MRR", "monthly revenue run rate"]
  suggestedAssetClass: string[];    // ["private_equity"]
  suggestedSector?: string;         // "saas"
  evidenceDocumentId?: string;      // CIM where this was found
  evidencePageRef?: string;         // "CIM p.22"
  evidenceValue?: number;           // The actual value extracted
  confidence: number;
  createdAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'merged';
  reviewedBy?: string;
  reviewNotes?: string;
}
```

7. **Validation on save** — When admin approves a new metric or formula, the system must validate before writing to YAML:

```typescript
async function validateAndSave(metric: PendingMetric): Promise<ValidationResult> {
  const checks = [];

  // 1. No duplicate canonical_id
  checks.push(this.metricRegistry.exists(metric.suggestedCanonicalId)
    ? { pass: false, error: `'${metric.suggestedCanonicalId}' already exists` }
    : { pass: true });

  // 2. No synonym collisions (synonym already maps to different metric)
  for (const syn of metric.suggestedSynonyms) {
    const existing = this.metricRegistry.resolve(syn);
    if (existing && existing.canonical_id !== metric.suggestedCanonicalId) {
      checks.push({ pass: false,
        error: `Synonym '${syn}' already maps to '${existing.canonical_id}'` });
    }
  }

  // 3. For computed: all dependencies exist in registry
  if (metric.suggestedType === 'computed' && metric.suggestedFormula) {
    const deps = this.formulaParser.extractDependencies(metric.suggestedFormula);
    for (const dep of deps) {
      if (!this.metricRegistry.exists(dep)) {
        checks.push({ pass: false,
          error: `Dependency '${dep}' not found in registry` });
      }
    }
  }

  // 4. For computed: no circular dependencies
  if (metric.suggestedType === 'computed') {
    const wouldCreateCycle = this.formulaResolver.detectCycle(
      metric.suggestedCanonicalId, metric.suggestedFormula
    );
    if (wouldCreateCycle) {
      checks.push({ pass: false,
        error: `Formula creates circular dependency` });
    }
  }

  // 5. db_column exists in PostgreSQL schema (for atomic)
  if (metric.suggestedType === 'atomic' && metric.suggestedAssetClass.includes('public_equity')) {
    const columnExists = await this.dbSchema.columnExists(
      'financial_metrics', metric.suggestedCanonicalId
    );
    if (!columnExists) {
      checks.push({ pass: false,
        error: `No column '${metric.suggestedCanonicalId}' in financial_metrics table. Add column first or map to existing column.` });
    }
  }

  if (checks.every(c => c.pass)) {
    await this.writeToYAML(metric);
    await this.triggerRegistryReload();  // Hot-reload in-memory index
    await this.triggerQULContextRefresh(); // Update available_metrics for Haiku
    return { valid: true };
  }

  return { valid: false, errors: checks.filter(c => !c.pass) };
}
```

### Admin Screen Data Flow Summary

| Action in Admin | What Gets Updated | QUL Impact | Formula Engine Impact |
|----------------|-------------------|------------|----------------------|
| Add atomic metric | YAML registry → in-memory index | Haiku's `available_metrics` updated; can now route queries to this metric | No change (direct DB lookup) |
| Add computed formula | YAML registry → formula DAG rebuilt | Haiku sees new computed metric in available list | New formula added to dependency graph; Python /calculate gains new formula |
| Add synonym | YAML registry → inverted index updated | More query variations resolve correctly (e.g., "owner earnings" → net_income) | No change |
| Add PE-specific metric | `pe_specific/` YAML → index | Haiku can route PE queries to this metric; DocumentMetricExtractor knows to look for it | Formula engine can compute if type=computed |
| Add client overlay synonym | `clients/{client}.yaml` → tenant-scoped index | Tenant's QUL context includes client vocabulary | No change |
| Approve pending extraction | Pending → YAML (moves from queue to registry) | Same as "add metric" above | Same as above |
| Reject pending | Status → rejected, logged | No change | No change |

### Hot-Reload Without Redeployment

When admin saves a change, the system must reload without a full restart:

```typescript
// In MetricRegistryService
async hotReload(): Promise<void> {
  // 1. Re-read all YAML files from S3
  const yamls = await this.s3.listAndFetch('metrics/');

  // 2. Rebuild in-memory inverted index
  this.invertedIndex = this.buildIndex(yamls);
  this.formulaDAG = this.buildDAG(yamls);

  // 3. Notify QUL to refresh its available_metrics context
  this.eventBus.emit('metric-registry-updated', {
    metricCount: this.invertedIndex.size,
    timestamp: new Date(),
  });

  this.logger.info(`Registry hot-reloaded: ${this.invertedIndex.size} metrics`);
}

// In QueryUnderstandingService
onModuleInit() {
  this.eventBus.on('metric-registry-updated', () => {
    this.availableMetrics = this.metricRegistry.getSummaryForQUL();
    this.cache.clear();  // Invalidate cache — metric landscape changed
  });
}
```

### The Learning Loop → Admin → QUL Closed Loop

This is the complete cycle that makes the system improve over time:

```
1. Analyst asks: "What's the cash conversion cycle?"
       │
2. QUL routes correctly (metric hint: "cash_conversion_cycle")
       │
3. MetricRegistry: ❌ No match — "cash_conversion_cycle" not in registry
       │
4. Graceful degradation: "I don't have 'cash conversion cycle' mapped yet.
   Closest: [Days Sales Outstanding] [Days Inventory Outstanding] [Working Capital]"
       │
5. Analyst clicks "none of these" or types clarification
       │
6. Logged to pending_metrics queue:
   { source: "unresolved_query",
     suggestedCanonicalId: "cash_conversion_cycle",
     suggestedFormula: "days_inventory_outstanding + days_sales_outstanding - days_payable_outstanding",
     suggestedSynonyms: ["CCC", "cash conversion cycle", "cash cycle"] }
       │
7. Weekly batch: LLM reviews unresolved queries, suggests formulas + synonyms
       │
8. Admin reviews in Formula Management Screen:
   ✅ Approves → writes to computed/ YAML
       │
9. Hot-reload triggers:
   - MetricRegistry rebuilds index (CCC now resolvable)
   - FormulaResolver rebuilds DAG (CCC formula with 3 dependencies)
   - QUL refreshes available_metrics (Haiku now knows CCC exists)
       │
10. Next time analyst asks "What's the cash conversion cycle?":
    QUL → MetricRegistry ✅ → FormulaResolver → Python /calculate → deterministic answer
```

This is the flywheel. Every unresolved query makes the system smarter — but only after human review in admin. No unchecked metric additions.

---

# 8.10 Document Intelligence Pipeline: Upload → Extract → Store → Query

This is the missing piece. The QUL routes queries to `uploaded_doc_rag`, `structured_db`, or `semantic_kb` — but something has to **process the document and populate those stores** before queries can succeed. This section specifies the complete multi-modal ingestion pipeline that runs when a document is uploaded, proactively extracts everything, and distributes data across the right storage layers.

> **THE CORE PRINCIPLE:** A document should be queryable within 5 seconds of upload (instant RAG), progressively improve as extraction completes (30-60 seconds), and be permanently indexed for long-term RAG (5-15 minutes). The analyst should never wait — the system gets smarter behind the scenes.

## 8.10.1 The Three Availability Tiers

```
Upload
  │
  ▼ (< 5 seconds)
┌─────────────────────────────────────────────────────┐
│  TIER 1: INSTANT RAG (Long-Context LLM)             │
│  Raw document pages sent directly to Sonnet/Opus     │
│  via long context window (200K tokens).              │
│  No indexing needed. Full document in memory.         │
│  Analyst can ask questions immediately.               │
│  Quality: Good for single-doc Q&A.                   │
│  Limitation: No cross-doc search, no persistence.    │
└─────────────────────────┬───────────────────────────┘
                          │
  ▼ (30-60 seconds, background)
┌─────────────────────────────────────────────────────┐
│  TIER 2: EXTRACTED + EPHEMERAL VECTOR STORE          │
│  Multi-modal extraction pipeline runs:               │
│  - Page-by-page vision extraction (tables, charts)   │
│  - Financial statement parsing → structured metrics   │
│  - Intelligent chunking with section metadata         │
│  - Embeddings generated → stored in OpenSearch/FAISS  │
│                                                       │
│  Structured metrics → session cache + DynamoDB        │
│  Chunks + embeddings → ephemeral vector index         │
│  Analyst now gets RAG-quality answers with citations.  │
│  Quality: High for document-specific queries.         │
└─────────────────────────┬───────────────────────────┘
                          │
  ▼ (5-15 minutes, async cron)
┌─────────────────────────────────────────────────────┐
│  TIER 3: PERSISTENT RAG (Bedrock KB + RDS)           │
│  Chunks written to S3 in KB-ready format.            │
│  Bedrock KB StartIngestionJob triggered.              │
│  Structured metrics persisted to RDS/DynamoDB.        │
│  Document now queryable across ALL sessions.          │
│  Cross-document search works.                         │
│  Quality: Full RAG with corpus-wide retrieval.        │
└─────────────────────────────────────────────────────┘
```

## 8.10.2 Multi-Modal Extraction Pipeline

When a document is uploaded, the extraction pipeline runs automatically in the background while Tier 1 (long-context) serves immediate queries.

```typescript
// New file: src/ingestion/document-intelligence.service.ts

@Injectable()
export class DocumentIntelligenceService {

  async processUpload(
    file: UploadedFile,
    tenantId: string,
    workspaceId: string,
    dealId?: string,
  ): Promise<ProcessingResult> {

    // STEP 0: Register document + store raw in S3
    const doc = await this.registerDocument(file, tenantId, workspaceId, dealId);
    // S3 path: s3://{bucket}/raw/{tenantId}/{workspaceId}/{docId}/{filename}

    // STEP 1: Convert to page images (for vision extraction)
    const pages = await this.convertToPages(file);
    // PDF → page images via pdftoppm/pdf2image
    // DOCX/XLSX → convert via LibreOffice → page images
    // Images → pass through directly

    // STEP 2: Parallel page-by-page vision extraction
    const extractions = await Promise.all(
      pages.map((page, idx) => this.extractPage(page, idx, doc))
    );
    // Each page returns: { page_type, text_content, tables[], charts[],
    //   structured_metrics[], visual_descriptions[], section_heading }

    // STEP 3: Classify document and assemble sections
    const classification = this.classifyDocument(extractions, file.name);
    // Returns: { document_type, reporting_entity, period_covered,
    //   sections: [{ type, pages, content }] }

    // STEP 4: Route extracted data to appropriate stores
    await Promise.all([
      this.storeStructuredMetrics(extractions, doc, tenantId),
      this.createChunksAndEmbed(extractions, classification, doc, tenantId),
      this.storeVisualDescriptions(extractions, doc, tenantId),
      this.generateIntakeSummary(classification, doc),
    ]);

    // STEP 5: Queue for Bedrock KB sync (Tier 3)
    await this.queueForKBSync(doc, tenantId);

    return { documentId: doc.id, classification, status: 'extracted' };
  }
}
```

### Page Vision Extraction Prompt

Each page is sent to Sonnet with vision. This is the prompt that handles tables, charts, images, and text simultaneously:

```
You are a financial document extraction specialist. Process this single page
from a financial document and extract ALL information in structured JSON.

OUTPUT FORMAT (JSON only):
{
  "page_type": "<cover | financial_statements | income_statement | balance_sheet |
    cash_flow | md_and_a | risk_factors | notes_to_financials | segment_data |
    earnings_summary | guidance | chart_page | table_of_contents | other>",
  "section_heading": "<section this page belongs to>",
  "text_content": "<all readable text, preserving paragraph structure>",
  "tables": [
    {
      "table_title": "<title or caption>",
      "table_type": "<financial_statement | data_table | comparison | schedule>",
      "headers": ["<col1>", "<col2>"],
      "rows": [
        { "label": "<row label>", "values": ["<val1>", "<val2>"] }
      ],
      "notes": "<any footnotes or annotations>"
    }
  ],
  "charts": [
    {
      "chart_type": "<bar | line | pie | waterfall | scatter | other>",
      "title": "<chart title>",
      "description": "<what the chart shows, including approximate values>",
      "data_points": [
        { "label": "<category>", "value": "<number>", "unit": "<$M, %, etc>" }
      ],
      "trend": "<increasing | decreasing | stable | mixed>",
      "insight": "<key takeaway from this chart>"
    }
  ],
  "structured_metrics": [
    {
      "metric_name": "<as stated in document>",
      "canonical_hint": "<closest FundLens canonical metric name>",
      "value": <number>,
      "unit": "<USD | EUR | % | ratio | count>",
      "period": "<FY2024 | Q3 2025 | LTM Sep 2025>",
      "context": "<GAAP | non-GAAP | adjusted | pro-forma | management>",
      "yoy_change": <number or null>,
      "source_table": "<which table this came from>"
    }
  ],
  "visual_elements": [
    {
      "type": "<logo | photo | diagram | infographic | signature>",
      "description": "<what it depicts>",
      "relevance": "<relevant context for financial analysis>"
    }
  ],
  "forward_looking_statements": [
    "<any guidance, projections, or forward-looking language>"
  ],
  "notable_items": [
    "<restatements, material weaknesses, going concern, unusual items>"
  ]
}
```

## 8.10.3 Data Distribution: Where Everything Gets Stored

After extraction, data is routed to the appropriate store based on type. This is the critical mapping that ensures the QUL can find data regardless of which `RetrievalPath` it selects.

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXTRACTED DATA TYPES                          │
├──────────────────┬──────────────────────────────────────────────┤
│ Data Type        │ Store → QUL RetrievalPath                    │
├──────────────────┼──────────────────────────────────────────────┤
│ Structured       │ DynamoDB/RDS (deal_metrics table)            │
│ metrics          │ → structured_db (via DocumentMetricExtractor │
│ (numbers from    │   cache, so repeat queries skip extraction)  │
│ financial stmts) │                                              │
├──────────────────┼──────────────────────────────────────────────┤
│ Text chunks      │ Tier 2: OpenSearch/FAISS (ephemeral, fast)   │
│ (MD&A, risk      │ Tier 3: Bedrock KB (persistent, cross-doc)   │
│ factors, notes)  │ → semantic_kb / uploaded_doc_rag              │
├──────────────────┼──────────────────────────────────────────────┤
│ Table data       │ Stored as both:                              │
│ (extracted       │ - Structured metrics → DynamoDB (queryable)  │
│ from tables)     │ - Markdown representation → vector store     │
│                  │   (for semantic search: "show me the table") │
├──────────────────┼──────────────────────────────────────────────┤
│ Chart/image      │ Visual description text → vector store       │
│ descriptions     │ Original image → S3 (for re-rendering)      │
│                  │ Extracted data points → DynamoDB             │
│                  │ → semantic_kb (description) + structured_db  │
│                  │   (data points)                               │
├──────────────────┼──────────────────────────────────────────────┤
│ Forward-looking  │ Tagged chunks in vector store                │
│ statements       │ (metadata: has_forward_looking = true)       │
│ (guidance)       │ → semantic_kb with metadata filter            │
├──────────────────┼──────────────────────────────────────────────┤
│ Document         │ DynamoDB (documents table)                   │
│ metadata         │ Classification, entity, period, page count   │
│                  │ → Used by QUL to resolve uploaded_entity      │
├──────────────────┼──────────────────────────────────────────────┤
│ Intake summary   │ Cached in session + DynamoDB                 │
│                  │ Served immediately on first interaction       │
└──────────────────┴──────────────────────────────────────────────┘
```

## 8.10.4 Chunking Strategy: Financial-Aware Chunking

Standard token-based chunking destroys financial documents. A table split across two chunks is useless. A risk factor split mid-sentence loses meaning. The chunking strategy must be **section-aware and table-preserving**.

```typescript
interface FinancialChunk {
  chunkId: string;
  content: string;                // The actual text/markdown
  contentType: 'text' | 'table' | 'chart_description' | 'mixed';
  embedding: number[];            // Vector from Titan embedding model

  // Metadata for filtered retrieval
  metadata: {
    tenantId: string;
    documentId: string;
    documentType: string;         // '10-K', 'CIM', 'earnings_transcript'
    reportingEntity: string;      // Company name
    ticker?: string;              // If resolved
    filingPeriod: string;         // 'FY2024', 'Q3 2025'
    sectionType: string;          // 'income_statement', 'md_and_a', 'risk_factors'
    pageNumbers: number[];
    hasQuantitativeData: boolean;
    hasForwardLooking: boolean;
    metricsReferenced: string[];  // ['revenue', 'ebitda', 'gross_margin']
    documentClass: 'sec_filing' | 'pe_deal_doc' | 'user_upload' | 'earnings_transcript';
  };
}
```

**Chunking rules:**

1. **Never split a table.** If a table is too large for one chunk, split by logical row groups (e.g., revenue section, expense section) with the header row duplicated in each chunk.
2. **Never split a financial statement.** Income statement, balance sheet, and cash flow statement are each one chunk (or logical sub-chunks with headers preserved).
3. **Section boundaries are chunk boundaries.** MD&A section 1 (overview) and section 2 (results of operations) are separate chunks even if they're short.
4. **Charts become two chunks:** one for the visual description (searchable), one for the extracted data points (structured).
5. **Target chunk size: 500-1000 tokens.** But section/table integrity takes priority over size.
6. **Overlap: 50 tokens** at section boundaries for context continuity. Zero overlap within tables.

## 8.10.5 Multi-Tenant Storage Isolation

Every storage layer must enforce tenant isolation. A Tristone analyst working on Client A's deal must never see Client B's data, even through accidental vector similarity matches.

```
S3 Bucket Structure:
s3://fundlens-{env}/
├── raw/{tenantId}/{workspaceId}/{docId}/{filename}
├── extracted/{tenantId}/{workspaceId}/{docId}/
│   ├── pages/page_001.json ... page_N.json
│   ├── classification.json
│   └── intake_summary.json
├── kb-ready/{tenantId}/{workspaceId}/{docId}/
│   ├── chunk_001.json ... chunk_N.json
│   └── chunk_metadata.json
└── metrics/{tenantId}/{workspaceId}/{docId}/
    └── structured_metrics.json

Bedrock KB Isolation:
- Option A: Separate KB per tenant (strongest isolation, higher cost)
- Option B: Shared KB with metadata filtering on tenantId
  (acceptable for MVP, must validate no cross-tenant leakage)
- Option C: Separate data source per tenant within shared KB
  (recommended: isolation at ingestion, shared infrastructure)

OpenSearch/FAISS (Ephemeral Tier 2):
- Namespace per tenant: index-{tenantId}-{workspaceId}
- TTL: 24 hours after last access (cleanup cron)
- Recreated on demand if evicted

DynamoDB:
- Partition key always includes tenantId
- GSI on tenantId + documentId for scoped queries
- IAM policies enforce tenant boundaries at API layer
```

## 8.10.6 The QUL Query Routing with Document Availability

The QUL needs to know **which tier a document is currently at** to route queries optimally. A document uploaded 3 seconds ago can only use Tier 1. A document uploaded 2 minutes ago has Tier 2. A document uploaded an hour ago has full Tier 3.

```typescript
// The orchestrator checks document availability before routing

async resolveRetrievalPath(
  understanding: QueryUnderstanding,
  documentId: string,
): Promise<RetrievalPath> {

  const docStatus = await this.documentRegistry.getStatus(documentId);

  switch (docStatus.tier) {
    case 'tier1_raw':
      // Document just uploaded, only raw pages available
      // Route to long-context LLM with raw document
      return 'instant_long_context';

    case 'tier2_extracted':
      // Extraction complete, ephemeral vector store populated
      // Route to OpenSearch/FAISS for fast retrieval
      if (understanding.intent === 'METRIC_LOOKUP' && docStatus.metricsExtracted) {
        return 'structured_db';  // Metrics already in DynamoDB cache
      }
      return 'uploaded_doc_rag';  // Ephemeral vector search

    case 'tier3_indexed':
      // Full Bedrock KB sync complete
      // Route to persistent KB for cross-document search
      return 'semantic_kb';  // Bedrock KB with metadata filtering

    default:
      return 'instant_long_context';  // Safe fallback
  }
}
```

## 8.10.7 Bulk Upload: Data Room Ingestion (Tristone Use Case)

For Tristone-style deployments where an analyst uploads 20-50 documents from a data room, the pipeline needs to handle volume with progressive availability.

```typescript
async processBulkUpload(
  files: UploadedFile[],
  tenantId: string,
  workspaceId: string,
  dealId: string,
): Promise<BulkProcessingStatus> {

  // 1. Register all documents immediately
  const docs = await Promise.all(
    files.map(f => this.registerDocument(f, tenantId, workspaceId, dealId))
  );

  // 2. Prioritize processing order:
  //    CIM first, then financial statements, then supporting docs
  const prioritized = this.prioritizeByDocType(docs);
  // Priority: CIM > financial_model > management_presentation >
  //   due_diligence_report > data_room_misc

  // 3. Process in parallel batches of 5 (avoid Bedrock throttling)
  const batchSize = 5;
  for (let i = 0; i < prioritized.length; i += batchSize) {
    const batch = prioritized.slice(i, i + batchSize);
    await Promise.all(batch.map(doc => this.processUpload(doc, tenantId, ...)));

    // 4. Notify frontend after each batch
    this.websocket.emit(workspaceId, {
      type: 'bulk_progress',
      processed: Math.min(i + batchSize, prioritized.length),
      total: prioritized.length,
      readyForQuery: prioritized.slice(0, i + batchSize).map(d => d.id),
    });
  }

  // 5. Queue all for Tier 3 KB sync
  await this.queueBulkKBSync(docs, tenantId, dealId);

  return { totalDocs: docs.length, status: 'processing_complete' };
}
```

**Frontend UX during bulk upload:**

```
┌──────────────────────────────────────────────┐
│  📁 Project Falcon — Data Room Upload         │
│                                               │
│  ✅ Project_Falcon_CIM.pdf          Ready     │
│  ✅ Historical_Financials.xlsx      Ready     │
│  ✅ Management_Presentation.pptx    Ready     │
│  ⏳ Due_Diligence_Report.pdf        Extracting │
│  ⏳ Cap_Table.xlsx                  Queued     │
│  ⏳ Board_Minutes_Q3.pdf            Queued     │
│  ... 14 more                                  │
│                                               │
│  3 of 20 documents ready — ask questions now  │
│  ┌──────────────────────────────────────────┐ │
│  │ Ask about Project Falcon...              │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

## 8.10.8 Sync Orchestration: Cron Jobs and Event-Driven Triggers

```
Event-Driven (immediate):
├── Document upload → S3 Put → Lambda → Start extraction pipeline
├── Extraction complete → EventBridge → Update document status
├── Metrics extracted → Write to DynamoDB → Invalidate QUL cache
└── Chunks embedded → Write to OpenSearch → Tier 2 available

Cron Jobs (scheduled):
├── Every 15 min: Bedrock KB sync (process pending kb-ready/ chunks)
├── Every 1 hour: Cleanup ephemeral indexes (TTL expired Tier 2 data)
├── Every 6 hours: EDGAR filing check (new SEC filings for tracked tickers)
├── Daily: Earnings call fetch (via Financial Modeling Prep API)
├── Daily: Reconcile DynamoDB metrics with RDS (catch any drift)
└── Weekly: Learning loop batch (unresolved queries → synonym suggestions)
```

## 8.10.9 What This Means for the QUL

With the Document Intelligence Pipeline in place, the QUL's `uploaded_doc_rag` path is no longer a single destination — it's a smart router that checks document availability and picks the best retrieval method:

```typescript
// Updated RetrievalPath type
type RetrievalPath =
  | 'structured_db'           // PostgreSQL / DynamoDB metric lookup
  | 'semantic_kb'             // Bedrock KB (persistent, cross-document)
  | 'uploaded_doc_rag'        // Ephemeral vector store (Tier 2, per-session)
  | 'instant_long_context'    // Raw document in LLM context (Tier 1, immediate)
  | 'earnings_transcript'     // Cross-transcript search
  | 'peer_comparison'         // PeerComparisonService
  | 'formula_engine'          // Python calculation engine
  | 'deal_library';           // PE deal document persistent store
```

The QUL doesn't need to know which tier a document is at — it outputs `uploaded_doc_rag` and the orchestrator resolves to the best available tier. But the QUL **does** need to know which documents exist in the workspace (via the `uploaded_documents` field in the Haiku user message), which is populated from the DynamoDB documents table.

---

# 9. Implementation Sequence

The QUL should be implemented in five phases, each independently testable and deployable. Total timeline: **7-9 working days** for Kiro.

| Phase | Scope | Days | Deliverable |
|-------|-------|------|-------------|
| Phase 1 | QUL service + Haiku prompt + eval suite scaffold | 2 | `QueryUnderstandingService` with 20+ test cases passing |
| Phase 2 | Integration: Replace `extractTickers` + `enhancedQuery` in RAG pipeline | 1.5 | All existing queries route through QUL, existing tests still pass |
| Phase 3 | PE domain: Add uploaded doc context, deal entity resolution, cross-domain decomposition | 1.5 | PE eval cases passing, cross-domain queries working |
| Phase 4 | DocumentMetricExtractor + formula engine bridge for PE docs | 1.5 | Extracted metrics feed into existing formula engine, cross-domain comparisons work |
| Phase 5 | Prompt registry + caching + observability | 1 | S3-backed prompts, LRU cache, CloudWatch metrics on tier distribution |

### Phase 1 Detail: Core QUL

This is the highest-priority work. After Phase 1, the Apple-in-ABNB-workspace bug, the gibberish bug, and the coreference bug are all fixed.

| Task | File | Description |
|------|------|-------------|
| Create QUL service | `src/rag/query-understanding.service.ts` | New service with 3-tier resolution |
| Haiku prompt file | `src/prompts/qul-system-prompt.txt` | Externalized system prompt (not hardcoded) |
| Few-shot examples | `src/prompts/qul-examples.json` | 8+ examples covering all major patterns |
| Output validator | `src/rag/qul-validator.ts` | Validates Haiku JSON against QueryUnderstanding schema |
| Eval suite | `test/qul-eval.spec.ts` | 100+ test cases, run against Haiku, report accuracy |
| Types | `src/types/query-understanding.types.ts` | All interfaces from Section 3 |

### Phase 4 Detail: DocumentMetricExtractor + Formula Bridge

This phase connects PE uploaded documents to the deterministic engine. After Phase 4, an analyst can ask "What's TargetCo's net debt to EBITDA?" and get a deterministic, formula-transparent answer computed from CIM data — using the exact same formula engine as public equity.

| Task | File | Description |
|------|------|-------------|
| DocumentMetricExtractor service | `src/rag/document-metric-extractor.service.ts` | LLM-powered metric extraction from uploaded docs |
| Extraction prompt | `src/prompts/metric-extraction-prompt.txt` | Structured extraction prompt with metric definitions |
| Session cache | `src/rag/extracted-metric-cache.ts` | In-memory LRU cache for extracted values |
| Formula bridge | Update `src/rag/formula-resolution.service.ts` | Accept `ExtractedMetricResult` as atomic input source |
| Persistence layer | `src/rag/deal-metric-persistence.service.ts` | DynamoDB storage for validated extractions |
| Analyst validation API | `src/controllers/metric-validation.controller.ts` | Endpoint for analysts to confirm/correct extracted values |
| Cross-domain orchestration | Update orchestrator | Parallel execution of PostgreSQL + DocExtractor queries |

---

# 10. Observability & Metrics

Every QUL resolution must be logged for debugging and prompt improvement. These metrics tell you whether the QUL is working and where to focus prompt iteration.

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Haiku p50 latency | < 80ms | > 150ms |
| Haiku p99 latency | < 250ms | > 400ms |
| Cache hit rate | > 30% | < 15% (cache config issue or high query diversity) |
| Invalid query detection rate | 3-5% of all queries | > 15% (over-rejecting) |
| Entity resolution accuracy | > 95% | < 90% (prompt regression) |
| Intent classification accuracy | > 90% | < 85% (prompt regression) |
| QUL parse failures | < 1% | > 3% (Haiku output format drift) |
| Workspace ticker override rate | ~40% of queries | > 70% (QUL not detecting entities) |
| PE domain classification accuracy | > 90% | < 80% |
| PE metric extraction accuracy | > 85% | < 75% (extraction prompt needs tuning) |
| PE extraction cache hit rate | > 60% after first query | < 30% (cache not persisting) |
| Cross-domain query success rate | > 85% | < 70% (orchestrator routing issue) |
| Formula engine errors (PE inputs) | < 2% | > 5% (extraction values malformed) |

---

# Appendix A: Migration Path

The QUL can be deployed behind a feature flag with the existing intent detector as fallback. This allows progressive rollout and A/B comparison.

```typescript
// Feature flag rollout
const useQUL = await this.featureFlags.isEnabled('qul-v1', tenantId);

if (useQUL) {
  const understanding = await this.qul.understand(query, ...);
  return this.orchestrator.executeWithQUL(understanding);
} else {
  // Legacy path
  const tickers = extractTickers(query);
  const intent = await this.intentDetector.classify(enhanced);
  return this.orchestrator.executeLegacy(intent, tickers);
}
```

During the migration period, both paths can run in parallel (shadow mode) with the legacy path serving responses and the QUL path logging its output for comparison. This generates real-world eval data without any user impact.

---

# Appendix B: Cost Analysis

| Component | Cost per Query | Monthly (10K queries) | Notes |
|-----------|---------------|----------------------|-------|
| Haiku (every query) | ~$0.001 | ~$10.00 | All queries, cache misses only |
| Cache hits (~35%) | $0.00 | saves ~$3.50 | Reduces effective Haiku calls to ~6,500 |
| **Effective QUL cost** | **~$0.00065** | **~$6.50** | After cache savings |
| Current 3-call system | ~$0.003 | ~$30.00 | Intent + decompose + disambiguate |
| **Net savings** | — | **~$23.50/mo** | Plus: one code path, zero regex bugs, better accuracy |

The marginal cost increase from removing the regex tier is ~$3/month (the queries regex would have handled for free now go through Haiku). The benefit is eliminating an entire class of bugs and reducing code complexity. At any reasonable scale, this is the correct trade.

---

# Appendix C: Critical Analysis — Architectural Risks & Improvements

This section documents every identified risk, honest weakness, and recommended improvement in the QUL spec. Written to prevent future debugging sessions.

## C.1 Risk: Haiku as Single Point of Failure

**The concern:** Every query now depends on a Haiku LLM call. If Bedrock has a latency spike or outage, the entire chat experience degrades.

**Severity:** HIGH — this is the biggest operational risk in the Haiku-first architecture.

**Mitigation (must implement):**

```typescript
async understand(query, workspace, ...): Promise<QueryUnderstanding> {
  const cached = this.cache.get(cacheKey);
  if (cached) return cached;

  try {
    const understanding = await Promise.race([
      this.callHaiku(query, workspace, ...),
      this.timeout(3000),  // 3-second hard timeout
    ]);
    this.cache.set(cacheKey, understanding);
    return understanding;
  } catch (error) {
    // FALLBACK: Construct a minimal QueryUnderstanding from simple heuristics
    // This is NOT the regex tier — it's a degraded-mode safety net
    return this.buildFallbackUnderstanding(query, workspace);
  }
}

private buildFallbackUnderstanding(query, workspace): QueryUnderstanding {
  // Extremely conservative: use workspace ticker, assume HYBRID_ANALYSIS,
  // route to both structured_db + semantic_kb, let downstream figure it out.
  // This will produce worse results but won't crash.
  return {
    entities: workspace.ticker
      ? [{ name: workspace.company_name, ticker: workspace.ticker,
           entityType: 'public_company', source: 'workspace_context' }]
      : [],
    primaryEntity: /* workspace entity or null */,
    intent: 'HYBRID_ANALYSIS',
    domain: workspace.domain,
    isValidQuery: query.trim().length > 3,
    queryQualityScore: 0.5,
    confidence: 0.3,  // Low confidence signals downstream to be cautious
    temporalScope: { type: 'latest' },
    suggestedRetrievalPaths: ['structured_db', 'semantic_kb'],
    resolvedBy: 'tier1_haiku',  // Still logged as Haiku (with error flag)
    rawQuery: query,
    normalizedQuery: query,
    _fallbackMode: true,  // Internal flag for observability
  };
}
```

The key: the fallback is **not** a full regex-based intent detector. It's a minimal, conservative pass-through that sends the query to both retrieval paths and lets the synthesis layer work with what it gets. This is explicitly worse than Haiku but keeps the system functional.

**Also required:** Circuit breaker pattern. If Haiku fails 3x in 60 seconds, switch all queries to fallback mode for 30 seconds before retrying. Log aggressively. Alert the team.

## C.2 Risk: QUL Output Schema Is Too Complex for Haiku

**The concern:** The `QueryUnderstanding` interface has ~20 fields. Asking Haiku to reliably populate all of them in a single call is ambitious. LLMs are less reliable with complex structured output — they might hallucinate a `metricType: 'computed'` when the metric is actually atomic, or misclassify `complexity: 'multi_part'` for a simple query.

**Severity:** MEDIUM — this will cause subtle downstream routing bugs that are hard to diagnose.

**Recommended improvement: Split into required vs. optional fields, and validate aggressively.**

```typescript
// REQUIRED fields — Haiku MUST produce these correctly or the query fails
interface QULRequired {
  entities: ResolvedEntity[];       // WHO
  intent: QueryIntent;              // WHAT type of question
  isValidQuery: boolean;            // Is this even a real query?
  domain: string;                   // Public equity / PE / cross-domain
  confidence: number;               // How sure is Haiku?
}

// DERIVED fields — the orchestrator can compute these from required fields
// DON'T ask Haiku to produce them; compute deterministically instead
interface QULDerived {
  primaryEntity: ResolvedEntity;    // = entities[0] unless overridden
  useWorkspaceContext: boolean;     // = entities[0].source === 'workspace_context'
  suggestedRetrievalPaths: [];      // = computed from intent + domain + entity type
  suggestedChart: ChartType;        // = computed from intent (trend→line, compare→bar)
  needsPeerComparison: boolean;     // = computed from intent (METRIC_COMPARISON, DEAL_COMPARISON)
  complexity: string;               // = computed from subQueries?.length
}

// OPTIONAL fields — Haiku may provide, orchestrator uses if present
interface QULOptional {
  subQueries?: SubQuery[];          // Only for multi-part queries
  unifyingInstruction?: string;
  temporalScope?: TemporalScope;    // Default to 'latest' if not provided
  peerContext?: string;
  metricType?: string;              // Hint only — MetricRegistry validates
}
```

**Why this matters:** If Haiku outputs `suggestedRetrievalPaths: ['semantic_kb']` for a query that clearly needs structured data, the downstream system silently skips the database. By computing retrieval paths deterministically from intent + entity type, you make routing bugs impossible from LLM hallucination. The routing logic is a 20-line switch statement — it doesn't need AI.

**Implementation:** After parsing Haiku's JSON, run a `deriveFields()` function that overwrites all derived fields based on the required fields. Haiku's suggestions for derived fields are ignored. This means Haiku only needs to get ~6 fields right, not 20.

## C.3 Risk: Metric Hint in QUL Creates Coupling Between Understanding and Resolution

**The concern:** The spec asks Haiku to output `metric: "ebitda_margin"` in subQueries. But Haiku doesn't know which canonical_ids exist in the MetricRegistry. If Haiku says `"net_leverage"` and the registry uses `"net_debt_to_ebitda"`, the resolution fails silently.

**Severity:** HIGH — this will be a persistent source of "metric not found" errors.

**Two options:**

**Option A: Send `available_metrics` to Haiku (already in spec Section 8.9).** This works but bloats the prompt with 252+ metric summaries, adding ~2K tokens and increasing latency/cost by ~20%. For Haiku's context window this is fine, but it creates coupling between prompt size and registry size.

**Option B (recommended): Let Haiku output natural language, let MetricRegistry do fuzzy resolution.**

```typescript
// Haiku outputs: { metric: "net leverage" }  ← natural language, not canonical_id
// MetricRegistry resolves:
const resolution = this.metricRegistry.resolve("net leverage");
// → { canonical_id: "net_debt_to_ebitda", confidence: 0.87, ... }

// If confidence < 0.7, fall back to semantic search
if (!resolution || resolution.confidence < 0.7) {
  // Route to semantic_kb instead of structured_db
  // The synthesis layer can still produce a useful answer from narrative
}
```

**This is more robust because:** Haiku doesn't need to know canonical IDs (which change when admin adds metrics). The MetricRegistry's fuzzy matching + synonym index handles the translation. And when it can't match (a new metric the registry doesn't have), the graceful degradation path already exists.

**The spec should be updated to make this explicit:** Haiku's `metric` field is a *natural language hint*, not a canonical_id lookup key. The orchestrator always runs it through `MetricRegistry.resolve()` and handles low-confidence results by falling back to semantic retrieval.

## C.4 Risk: DocumentMetricExtractor Confidence Scores Are Self-Reported

**The concern:** The LLM that extracts metrics from uploaded CIMs also reports its own confidence score. A model saying "confidence: 0.92" for an extraction is not the same as actually being 92% accurate. LLMs are notoriously poorly calibrated on self-reported confidence.

**Severity:** MEDIUM — analysts will see high-confidence numbers that are occasionally wrong, which erodes trust.

**Recommended improvement: External validation, not self-reported confidence.**

```typescript
async extract(documentId, metricIds, temporal): Promise<ExtractedMetricResult> {
  // 1. Primary extraction (Sonnet)
  const primary = await this.extractWithModel(documentId, metricIds, 'sonnet');

  // 2. Validation extraction (Haiku, different prompt)
  // Ask a simpler question: "Does the document say revenue is $180M? Yes/No/Different value"
  const validation = await this.validateExtraction(documentId, primary);

  // 3. Compute actual confidence from agreement
  for (const metric of primary.metrics) {
    if (validation[metric.id].agrees) {
      metric.confidence = 0.95;  // Two models agree
    } else if (validation[metric.id].differentValue) {
      metric.confidence = 0.50;  // Disagreement — flag for analyst review
      metric.conflictNote = `Primary: ${metric.value}, Validation: ${validation[metric.id].value}`;
    } else {
      metric.confidence = 0.30;  // Validation couldn't find it at all
    }
  }

  return primary;
}
```

**Cost:** One additional Haiku call per extraction (~$0.0005). Worth it for financial data accuracy. Only run this on cache misses — subsequent queries use cached, already-validated results.

## C.5 Risk: The Intent Enum Is Too Granular

**The concern:** 18 intent types is a lot. Haiku needs to distinguish between `METRIC_LOOKUP` vs `METRIC_TREND` vs `METRIC_COMPARISON`, between `DEAL_ANALYSIS` vs `DEAL_COMPARISON` vs `MANAGEMENT_ASSESSMENT`, etc. Some of these distinctions are genuinely ambiguous ("What's EBITDA?" — is that `METRIC_LOOKUP` or `HYBRID_ANALYSIS`?). Over-classification means more wrong classifications.

**Severity:** LOW-MEDIUM — wrong intent between sibling types (e.g., METRIC_LOOKUP vs METRIC_TREND) usually still produces a usable result because the entity and metric are correct.

**Recommended improvement: Hierarchical intent with primary + modifier.**

```typescript
// Instead of 18 flat intents:
intent: 'METRIC_LOOKUP' | 'METRIC_TREND' | 'METRIC_COMPARISON' | ...

// Use hierarchical:
intentCategory: 'metric' | 'narrative' | 'hybrid' | 'deal' | 'generation' | 'meta';
intentModifier?: 'lookup' | 'trend' | 'comparison' | 'screening';
```

**This means:** Haiku only needs to get the category right (6 options, not 18). The modifier is a bonus that improves routing but doesn't break things if wrong. `metric` + wrong modifier = still pulls the right data, just might not chart it optimally. `narrative` + wrong modifier = still does semantic search, just might frame the synthesis differently.

**However:** If Kiro has already implemented the 18-intent enum in the existing intent detector, switching to hierarchical adds refactoring cost. In that case, keep the flat enum but document which misclassifications are harmless (METRIC_LOOKUP ↔ METRIC_TREND) vs. dangerous (METRIC_LOOKUP ↔ NARRATIVE_SEARCH).

## C.6 Risk: Conversation History Creates an Unbounded Context Problem

**The concern:** The spec sends "last 3 messages" for coreference resolution. But what if the relevant context is 10 messages back? "Compare that to Google" where "that" refers to a metric discussed 8 turns ago. 3 messages isn't enough. But sending the full conversation history bloats Haiku's input tokens, increases cost, and may confuse the model with irrelevant earlier context.

**Severity:** MEDIUM — coreference will fail for longer analytical sessions.

**Recommended improvement: Sliding context with entity tracking.**

```typescript
interface ConversationContext {
  // Instead of raw messages, send a compressed state:
  lastMentionedEntities: ResolvedEntity[];  // From the last QUL resolution
  lastMentionedMetrics: string[];            // ["revenue", "ebitda_margin"]
  lastIntent: QueryIntent;
  recentMessages: Message[];                 // Last 2-3 for natural language coreference
}
```

**The QUL should maintain a running `lastMentionedEntities` state** that updates after every resolution. When the next query says "compare that to Google", the Haiku input includes `lastMentionedEntities: [{ ticker: "TSLA" }]` plus `lastMentionedMetrics: ["free_cash_flow"]` — so Haiku has the semantic context without needing the full conversation. This is ~50 tokens instead of potentially thousands.

## C.7 Risk: Cross-Domain PE Comparison Assumes Comparable Metrics

**The concern:** When comparing TargetCo's EBITDA margin (extracted from CIM) to AAPL's EBITDA margin (computed from 10-K), the numbers may use different definitions. CIMs typically report "Adjusted EBITDA" with management add-backs. SEC filings use GAAP operating income + D&A. Comparing them without caveat is misleading.

**Severity:** HIGH for PE use case — this is the kind of error that kills credibility with an IC.

**The spec already identifies this** (the caveat in Section 8.5), but it relies on the DocumentMetricExtractor's `notes` field to catch it. That's not reliable enough.

**Recommended improvement: Explicit definition matching in cross-domain comparisons.**

```typescript
// When cross-domain comparison is detected:
if (understanding.domain === 'cross_domain') {
  // For each metric being compared:
  const definitions = await Promise.all(
    results.map(r => this.getMetricDefinitionUsed(r))
  );

  // Check for definition mismatch
  const hasDefinitionMismatch = definitions.some(d =>
    d.isAdjusted !== definitions[0].isAdjusted ||
    d.standard !== definitions[0].standard  // GAAP vs non-GAAP vs IFRS
  );

  if (hasDefinitionMismatch) {
    // Force the synthesis prompt to prominently caveat the comparison
    synthesisContext.mandatoryCaveat = {
      type: 'DEFINITION_MISMATCH',
      details: definitions,
      severity: 'high',
      message: 'These metrics use different definitions and may not be directly comparable.'
    };
  }
}
```

**This should be a hard rule, not optional.** Every cross-domain numerical comparison must check for definition consistency. The synthesis prompt must surface the caveat prominently, not bury it in a footnote.

## C.8 Improvement: Pre-Warm the Haiku Connection

**Observation:** Haiku's 50-150ms latency includes TCP/TLS setup on cold connections to Bedrock. For a chat interface where the analyst is actively typing, you know a query is coming.

**Improvement:** Keep a warm connection pool to Bedrock. Pre-warm on session start. Consider speculative pre-resolution: when the analyst starts typing, send a preliminary Haiku call after 500ms of idle time with the partial query. If the analyst finishes typing within 200ms, you've already started the LLM call. This cuts perceived latency to near-zero for cache misses.

## C.9 Improvement: Eval Suite Must Test Edge Cases Between Intents, Not Just Happy Paths

**The current eval suite design** (Section 6.4) has 100+ test cases but they're organized by happy-path category. The most valuable test cases are the **boundary cases between intents**:

```
// These are the queries that break systems:
"What's Apple's revenue and why is it growing?"
  → Is this METRIC_LOOKUP + NARRATIVE_SEARCH, or HYBRID_ANALYSIS?
  → Both are acceptable, but the routing differs.

"How does their margin compare?"
  → METRIC_COMPARISON (if previous context has two companies)
  → METRIC_TREND (if previous context was about one company over time)
  → Depends entirely on conversation history — test both.

"Show me the financials"
  → METRIC_LOOKUP with concept expansion? Or NARRATIVE_SEARCH for filing?
  → Need to test with and without workspace ticker.
```

**Recommendation:** Add 20 boundary-case test pairs where the same query produces different correct outputs depending on context. These are worth more than 50 happy-path cases.

## C.10 Summary of Changes Made to This Spec

| Change | Reason | Impact |
|--------|--------|--------|
| Removed regex Tier 1 | Premature optimization, creates two code paths, can't handle 70% of patterns anyway | Simpler code, one debug surface, ~$3/mo more cost |
| Haiku is now Layer 1 (always runs) | Semantic understanding is an LLM task; pretending regex can do 30% of it repeats the extractTickers() mistake | Every query gets full entity resolution, intent classification, gibberish detection |
| Added circuit breaker + fallback | Haiku-as-L1 means it's a SPOF; need graceful degradation | System stays functional during Bedrock outages |
| Recommended splitting QUL schema into required/derived/optional | 20 fields is too many for Haiku to reliably populate; derived fields should be computed deterministically | Fewer Haiku errors, routing bugs eliminated for derived fields |
| Recommended natural-language metric hints (not canonical IDs) | Haiku doesn't know canonical_ids; coupling to registry creates silent failures | Fuzzy matching in MetricRegistry handles translation; more resilient to registry changes |
| Added dual-model validation for PE extraction | Self-reported confidence is unreliable | Better calibrated confidence; disagreements flagged for analyst |
| Recommended sliding entity context over raw message history | 3 messages insufficient for long sessions; full history too expensive | Better coreference with smaller context window |
| Added mandatory definition-mismatch detection for cross-domain | Comparing adjusted vs GAAP EBITDA without caveat kills IC credibility | Hard rule, not optional — synthesis must surface the caveat |
