# Phase 2 Scope Clarification: Intent Detection Enhancement

**Date**: 2026-02-03  
**Status**: CLARIFIED  
**Impact**: Design and Requirements documents updated

## Critical Clarification

Phase 2 **ENHANCES** the existing intent detector with subsection awareness. It does **NOT** replace the existing system with a narrow competitive-intelligence-only detector.

## What the Existing Intent Detector Already Does

The current `IntentDetectorService` (`src/rag/intent-detector.service.ts`) already handles:

### Query Types
- **Structured**: Queries asking only for metrics (e.g., "What is AAPL's revenue?")
- **Semantic**: Queries asking for narrative/explanation (e.g., "What does AAPL do?")
- **Hybrid**: Queries asking for both metrics and explanation (e.g., "What is AAPL's revenue and why did it grow?")

### Extraction Capabilities
- **Tickers**: Single or multiple tickers for comparison queries
- **Metrics**: Revenue, Net_Income, Gross_Profit, Operating_Income, Cost_of_Revenue, R&D, SG&A, Total_Assets, Total_Liabilities, Total_Equity, Cash, Accounts_Payable, Accounts_Receivable, Inventory, margins, ROE, ROA
- **Periods**: FY2024, Q4-2024, latest, specific years
- **Document Types**: 10-K, 10-Q, 8-K, news, earnings transcripts
- **Section Types**: item_1, item_7, item_8, item_1a, item_2, item_3

### Query Characteristics
- **needsNarrative**: Whether the query requires narrative explanation
- **needsComparison**: Whether the query compares multiple entities
- **needsComputation**: Whether the query requires calculated metrics
- **needsTrend**: Whether the query asks for trend analysis

### Confidence Scoring
- Calculates confidence based on ticker presence, metrics identified, and period specified

## What Phase 2 Adds

Phase 2 adds **ONE NEW FIELD** to the existing `QueryIntent` interface:

```typescript
interface QueryIntent {
  // EXISTING FIELDS (already implemented)
  type: 'structured' | 'semantic' | 'hybrid';
  ticker?: string | string[];
  metrics?: string[];
  period?: string;
  periodType?: PeriodType;
  documentTypes?: string[];
  sectionTypes?: string[];
  needsNarrative: boolean;
  needsComparison: boolean;
  needsComputation: boolean;
  needsTrend: boolean;
  confidence: number;
  originalQuery: string;
  
  // NEW FIELD (Phase 2 addition)
  subsectionName?: string; // Target subsection within identified section
}
```

Phase 2 adds **ONE NEW METHOD** to the existing `IntentDetectorService`:

```typescript
class IntentDetectorService {
  // EXISTING METHODS (already implemented)
  async detectIntent(query: string): Promise<QueryIntent>
  private extractTicker(query: string): string | string[] | undefined
  private extractMetrics(query: string): string[]
  private extractPeriod(query: string): string | undefined
  private extractDocumentTypes(query: string): any[]
  private extractSectionTypes(query: string): any[]
  private determineQueryType(query: string, metrics: string[], sections: any[]): QueryType
  
  // NEW METHOD (Phase 2 addition)
  private identifyTargetSubsection(query: string, sectionType: string): string | undefined
}
```

## How Phase 2 Works

When a query is processed:

1. **Existing behavior runs first**: Extract ticker, metrics, period, document types, section types, determine query type
2. **New behavior runs second**: If a section type was identified, also identify the target subsection
3. **Result**: All existing fields are populated as before, PLUS subsectionName is added when applicable

## Examples

### Example 1: Structured Query with Subsection
**Query**: "What is AAPL's revenue recognition policy?"

**Phase 1 (existing) output**:
```typescript
{
  type: 'semantic',
  ticker: 'AAPL',
  sectionTypes: ['item_8'],
  needsNarrative: true,
  confidence: 0.7
}
```

**Phase 2 (enhanced) output**:
```typescript
{
  type: 'semantic',
  ticker: 'AAPL',
  sectionTypes: ['item_8'],
  subsectionName: 'Revenue Recognition', // NEW
  needsNarrative: true,
  confidence: 0.7
}
```

### Example 2: Competitive Intelligence Query
**Query**: "Who are NVDA's competitors?"

**Phase 1 (existing) output**:
```typescript
{
  type: 'semantic',
  ticker: 'NVDA',
  sectionTypes: ['item_1'],
  needsNarrative: true,
  confidence: 0.7
}
```

**Phase 2 (enhanced) output**:
```typescript
{
  type: 'semantic',
  ticker: 'NVDA',
  sectionTypes: ['item_1'],
  subsectionName: 'Competition', // NEW
  needsNarrative: true,
  confidence: 0.7
}
```

### Example 3: Hybrid Query with Subsection
**Query**: "What is AMZN's revenue and how do they recognize it?"

**Phase 1 (existing) output**:
```typescript
{
  type: 'hybrid',
  ticker: 'AMZN',
  metrics: ['Revenue'],
  sectionTypes: ['item_8'],
  needsNarrative: true,
  needsComputation: false,
  confidence: 0.9
}
```

**Phase 2 (enhanced) output**:
```typescript
{
  type: 'hybrid',
  ticker: 'AMZN',
  metrics: ['Revenue'],
  sectionTypes: ['item_8'],
  subsectionName: 'Revenue Recognition', // NEW
  needsNarrative: true,
  needsComputation: false,
  confidence: 0.9
}
```

### Example 4: Query Without Subsection Keywords
**Query**: "What does TSLA do?"

**Phase 1 (existing) output**:
```typescript
{
  type: 'semantic',
  ticker: 'TSLA',
  sectionTypes: ['item_1'],
  needsNarrative: true,
  confidence: 0.7
}
```

**Phase 2 (enhanced) output**:
```typescript
{
  type: 'semantic',
  ticker: 'TSLA',
  sectionTypes: ['item_1'],
  subsectionName: undefined, // No subsection keywords matched
  needsNarrative: true,
  confidence: 0.7
}
```

## Subsection Identification Patterns

Phase 2 adds subsection identification for queries that already have section types identified:

### Item 1 (Business)
- "competitors", "competitive landscape", "competition" → "Competition"
- "products", "product line", "offerings" → "Products"
- "customers", "customer base" → "Customers"
- "markets", "market segments" → "Markets"
- "operations", "business operations" → "Operations"
- "strategy", "business strategy" → "Strategy"
- "intellectual property", "patents", "trademarks" → "Intellectual Property"
- "employees", "human capital", "workforce" → "Human Capital"

### Item 7 (MD&A)
- "results of operations", "operating results", "performance" → "Results of Operations"
- "liquidity", "capital resources", "cash flow" → "Liquidity and Capital Resources"
- "critical accounting", "accounting policies", "estimates" → "Critical Accounting Policies"
- "market risk", "interest rate risk", "currency risk" → "Market Risk"
- "contractual obligations", "commitments" → "Contractual Obligations"

### Item 8 (Financial Statements)
- "revenue recognition", "revenue policy" → "Revenue Recognition"
- "leases", "lease accounting" → "Leases"
- "stock-based compensation", "equity compensation" → "Stock-Based Compensation"
- "income taxes", "tax provision" → "Income Taxes"
- "debt", "borrowings", "credit facilities" → "Debt"
- "fair value", "fair value measurements" → "Fair Value"
- "note [number]" → Extract note number

### Item 1A (Risk Factors)
- "operational risk" → "Operational Risks"
- "financial risk" → "Financial Risks"
- "market risk" → "Market Risks"
- "regulatory risk", "compliance" → "Regulatory Risks"
- "technology risk", "cybersecurity" → "Technology Risks"

## Impact on Retrieval

When `subsectionName` is present in the `QueryIntent`:

1. **Semantic Retriever** filters by both `section_type` AND `subsection_name`
2. If no results, falls back to `section_type` only (existing behavior)
3. If still no results, falls back to broader semantic search (existing behavior)

When `subsectionName` is undefined:

1. **Semantic Retriever** filters by `section_type` only (existing behavior)
2. No change to current retrieval logic

## Why This Matters

The spec was originally written with a focus on competitive intelligence, MD&A, and footnote queries because those were the **example failures** that motivated the feature. However, the solution is **general-purpose** and applies to ALL query types.

The subsection identification patterns work for:
- Competitive intelligence queries (Item 1 Competition)
- MD&A queries (Item 7 subsections)
- Footnote queries (Item 8 subsections)
- Risk factor queries (Item 1A subsections)
- Business description queries (Item 1 subsections)
- **ANY query that targets a section with identifiable subsections**

## Documents Updated

1. **design.md**: Updated "Intent Detector Service Enhancement" section to clarify this is an enhancement to the existing system
2. **requirements.md**: Updated Requirements 2, 3, 4 to clarify subsection detection applies to ALL query types
3. **tasks.md**: Updated Phase 2 tasks to clarify enhancement approach
4. **design.md**: Updated Properties 5-13 to reflect enhancement approach

## Key Takeaways

✅ Phase 2 enhances the existing intent detector, not replaces it  
✅ All existing query types (structured, semantic, hybrid) are preserved  
✅ All existing extraction capabilities (tickers, metrics, periods, etc.) are preserved  
✅ Subsection identification is an ADDITION, not a replacement  
✅ When no subsection keywords match, subsectionName is undefined (existing behavior)  
✅ The solution is general-purpose and applies to ALL query types, not just competitive intelligence  

## Next Steps

Proceed with Phase 2 implementation:
1. Add `subsectionName?: string` field to `QueryIntent` interface
2. Add `identifyTargetSubsection()` method to `IntentDetectorService`
3. Call `identifyTargetSubsection()` after `extractSectionTypes()` in `detectIntent()`
4. Update `SemanticRetrieverService` to filter by subsection when present
5. Implement fallback chain (subsection → section → broad)
6. Write property tests for subsection identification across ALL query types

---

**Clarification Complete**: ✅  
**Ready for Phase 2 Implementation**: ✅
