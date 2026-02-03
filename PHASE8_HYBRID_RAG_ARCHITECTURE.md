# Phase 8: Hybrid RAG Architecture - Deterministic + Semantic

## Core Principle: Dual-Path Retrieval

**The Problem with Pure Vector Search**:
- ❌ Retrieves 100 chunks, hopes LLM finds the right number
- ❌ Can't guarantee "latest" means both quarterly + annual
- ❌ Destroys table structure with semantic chunking
- ❌ Hallucination risk on exact numbers
- ❌ No document type routing (10-K vs 10-Q vs news)

**Our Solution: Hybrid Retrieval**
- ✅ **Path A**: Structured retrieval for metrics (PostgreSQL)
- ✅ **Path B**: Vector search for narratives (Bedrock KB)
- ✅ **Query Router**: Intelligent routing based on intent
- ✅ **Response Builder**: Pre-filled with exact numbers
- ✅ **Metadata Filtering**: Company, period, document type

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        USER QUERY                            │
│  "What was Apple's revenue growth in 2024 and why?"         │
└──────────────────────┬──────────────────────────────────────┘
                       │
            ┌──────────▼──────────┐
            │   QUERY ROUTER      │
            │  (Intent Detection) │
            └──────────┬──────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        │              │              │
┌───────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐
│ STRUCTURED   │ │ SEMANTIC │ │  HYBRID    │
│ (Metrics)    │ │(Narrative)│ │  (Both)    │
└───────┬──────┘ └────┬─────┘ └─────┬──────┘
        │              │              │
        │              │              │
┌───────▼──────────────▼──────────────▼──────┐
│         PARALLEL RETRIEVAL                  │
│                                             │
│  Path A: PostgreSQL    Path B: Bedrock KB  │
│  ┌─────────────────┐   ┌─────────────────┐ │
│  │ SELECT value    │   │ Vector Search   │ │
│  │ FROM metrics    │   │ top_k = 5       │ │
│  │ WHERE ticker=   │   │ + metadata      │ │
│  │   'AAPL'        │   │   filter        │ │
│  │ AND metric=     │   └─────────────────┘ │
│  │   'revenue'     │                       │
│  │ AND period=     │                       │
│  │   'FY2024'      │                       │
│  └─────────────────┘                       │
└──────────────┬──────────────────────────────┘
               │
    ┌──────────▼──────────┐
    │  RESPONSE BUILDER   │
    │                     │
    │ 1. Pre-fill exact   │
    │    numbers          │
    │ 2. Add narrative    │
    │    context          │
    │ 3. Cite sources     │
    └──────────┬──────────┘
               │
    ┌──────────▼──────────┐
    │   CLAUDE OPUS 4     │
    │  (Synthesis only)   │
    └──────────┬──────────┘
               │
    ┌──────────▼──────────────────────────┐
    │  FINAL RESPONSE                     │
    │                                     │
    │  📊 Apple's revenue grew 7% in 2024 │
    │  - FY2024: $416.2B                  │
    │  - FY2023: $389.0B                  │
    │                                     │
    │  📝 Management attributed growth to:│
    │  - iPhone 15 strong demand          │
    │  - Services expansion               │
    │  [Source: 10-K FY2024, MD&A p.23]   │
    └─────────────────────────────────────┘
```

## Data Storage Strategy

### 1. PostgreSQL (Structured Data)

**Tables**:
```sql
-- Exact metrics with rich metadata
financial_metrics (
  ticker,
  normalized_metric,
  value,
  fiscal_period,
  period_type,        -- 'quarterly' | 'annual'
  filing_type,        -- '10-K' | '10-Q' | '8-K'
  statement_type,     -- 'income' | 'balance' | 'cash_flow'
  filing_date,
  statement_date,
  confidence_score,
  source_page,
  xbrl_tag
)

-- Computed metrics (cached)
computed_metrics (
  ticker,
  metric_name,        -- 'gross_margin' | 'net_margin' | 'roe'
  value,
  fiscal_period,
  calculation_formula,
  input_metrics       -- JSON array of source metrics
)

-- News articles
news_articles (
  id,
  ticker,
  title,
  summary,
  published_date,
  source,
  sentiment_score,
  url
)

-- Document metadata
documents (
  id,
  ticker,
  document_type,      -- 'sec_filing' | 'news' | 'earnings_transcript'
  filing_type,        -- '10-K' | '10-Q' | '8-K'
  filing_date,
  processed,
  s3_key
)
```

### 2. Bedrock Knowledge Base (Semantic Data)

**Chunk Structure**:
```json
{
  "content": "Management's Discussion and Analysis...",
  "metadata": {
    "ticker": "AAPL",
    "document_type": "sec_filing",
    "filing_type": "10-K",
    "section_type": "mda",
    "fiscal_period": "FY2024",
    "filing_date": "2024-11-01",
    "chunk_index": 0,
    "page_number": 23,
    "statement_date": "2024-09-28"
  }
}
```

**Key Metadata Fields for Filtering**:
- `ticker` - Company identifier
- `document_type` - sec_filing | news | earnings_transcript
- `filing_type` - 10-K | 10-Q | 8-K
- `section_type` - mda | risk_factors | business | notes
- `fiscal_period` - FY2024 | Q4-2024
- `filing_date` - For "latest" queries
- `statement_date` - Actual period end date

## Query Router Logic

### Intent Detection

```typescript
interface QueryIntent {
  type: 'structured' | 'semantic' | 'hybrid';
  ticker?: string;
  metrics?: string[];
  period?: string;
  documentTypes?: string[];
  needsNarrative: boolean;
  needsComparison: boolean;
}

class QueryRouter {
  async detectIntent(query: string): Promise<QueryIntent> {
    // Use Claude to parse intent
    const prompt = `
      Parse this financial query and extract:
      1. Query type: structured (metrics), semantic (narrative), or hybrid
      2. Company ticker(s)
      3. Specific metrics mentioned
      4. Time period (latest, FY2024, Q4-2024, etc.)
      5. Document types needed (10-K, 10-Q, news)
      
      Query: "${query}"
      
      Return JSON.
    `;
    
    const intent = await this.llm.parse(prompt);
    return intent;
  }
}
```

### Routing Examples

**Query**: "What was Apple's revenue in 2024?"
```json
{
  "type": "structured",
  "ticker": "AAPL",
  "metrics": ["revenue"],
  "period": "FY2024",
  "documentTypes": ["10-K"],
  "needsNarrative": false,
  "needsComparison": false
}
```
→ **Route to**: PostgreSQL only

**Query**: "Explain Apple's business strategy"
```json
{
  "type": "semantic",
  "ticker": "AAPL",
  "metrics": [],
  "period": "latest",
  "documentTypes": ["10-K"],
  "needsNarrative": true,
  "needsComparison": false
}
```
→ **Route to**: Bedrock KB only (section_type = 'business')

**Query**: "What was Apple's revenue growth and why?"
```json
{
  "type": "hybrid",
  "ticker": "AAPL",
  "metrics": ["revenue"],
  "period": "FY2024",
  "documentTypes": ["10-K"],
  "needsNarrative": true,
  "needsComparison": true
}
```
→ **Route to**: PostgreSQL + Bedrock KB (section_type = 'mda')

## Retrieval Strategy

### Path A: Structured Retrieval (PostgreSQL)

```typescript
class StructuredRetriever {
  async retrieveMetrics(intent: QueryIntent): Promise<MetricResult[]> {
    // Build SQL query with exact filters
    const query = `
      SELECT 
        ticker,
        normalized_metric,
        value,
        fiscal_period,
        filing_type,
        statement_date,
        source_page
      FROM financial_metrics
      WHERE ticker = $1
        AND normalized_metric = ANY($2)
        AND filing_type = $3
      ORDER BY statement_date DESC
      LIMIT 10
    `;
    
    const results = await this.db.query(query, [
      intent.ticker,
      intent.metrics,
      this.resolveFilingType(intent.period) // 'latest' → both 10-K and 10-Q
    ]);
    
    return results;
  }
  
  private resolveFilingType(period: string): string[] {
    if (period === 'latest') {
      return ['10-K', '10-Q']; // Return both annual and quarterly
    } else if (period.startsWith('FY')) {
      return ['10-K'];
    } else if (period.startsWith('Q')) {
      return ['10-Q'];
    }
    return ['10-K', '10-Q'];
  }
}
```

### Path B: Semantic Retrieval (Bedrock KB)

```typescript
class SemanticRetriever {
  async retrieveNarratives(
    query: string,
    intent: QueryIntent
  ): Promise<ChunkResult[]> {
    // Build metadata filter
    const filter = {
      andAll: [
        { equals: { key: 'ticker', value: intent.ticker } },
        { equals: { key: 'document_type', value: 'sec_filing' } },
        { in: { key: 'filing_type', value: intent.documentTypes } },
        // For "latest", use filing_date sort
        ...(intent.period === 'latest' 
          ? [] 
          : [{ equals: { key: 'fiscal_period', value: intent.period } }]
        )
      ]
    };
    
    // Retrieve with metadata filter
    const response = await this.bedrockKB.retrieve({
      knowledgeBaseId: this.kbId,
      retrievalQuery: { text: query },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: 5, // NOT 100!
          filter: filter
        }
      }
    });
    
    return response.retrievalResults;
  }
}
```

### Hybrid Retrieval

```typescript
class HybridRetriever {
  async retrieve(query: string, intent: QueryIntent) {
    // Execute both in parallel
    const [metrics, narratives] = await Promise.all([
      intent.type !== 'semantic' 
        ? this.structuredRetriever.retrieveMetrics(intent)
        : [],
      intent.needsNarrative
        ? this.semanticRetriever.retrieveNarratives(query, intent)
        : []
    ]);
    
    return { metrics, narratives };
  }
}
```

## Response Builder

### Pre-fill with Exact Numbers

```typescript
class ResponseBuilder {
  buildContext(metrics: MetricResult[], narratives: ChunkResult[]): string {
    // Part 1: Exact metrics (deterministic)
    const metricsContext = metrics.map(m => `
      ${m.normalized_metric}: ${this.formatValue(m.value)}
      Period: ${m.fiscal_period}
      Source: ${m.filing_type}, Page ${m.source_page}
    `).join('\n');
    
    // Part 2: Narrative context (semantic)
    const narrativeContext = narratives.map((n, i) => `
      [${i + 1}] ${n.content}
      Source: ${n.metadata.filing_type} ${n.metadata.fiscal_period}, Page ${n.metadata.page_number}
    `).join('\n\n');
    
    return `
      EXACT METRICS (use these numbers verbatim):
      ${metricsContext}
      
      NARRATIVE CONTEXT (for explanation):
      ${narrativeContext}
    `;
  }
  
  async generateResponse(
    query: string,
    context: string
  ): Promise<string> {
    const systemPrompt = `
      You are a financial analyst assistant.
      
      CRITICAL RULES:
      1. Use EXACT numbers from "EXACT METRICS" section - never modify
      2. Always cite sources with [Filing Type, Period, Page]
      3. Use narrative context to explain WHY, not to extract numbers
      4. If asked for "latest", include both quarterly and annual
      5. Never hallucinate numbers - only use provided metrics
    `;
    
    const prompt = `
      Context:
      ${context}
      
      User Question: ${query}
      
      Provide a comprehensive answer with:
      1. Direct answer with exact numbers
      2. Temporal comparison if available
      3. Narrative explanation from context
      4. Source citations
    `;
    
    return await this.llm.generate(prompt, systemPrompt);
  }
}
```

## Metadata Strategy for Each Data Type

### SEC Filings (10-K, 10-Q, 8-K)

**Structured (PostgreSQL)**:
- All financial metrics
- Filing metadata
- Statement dates

**Semantic (Bedrock KB)**:
- MD&A sections
- Risk Factors
- Business Description
- Notes to Financial Statements

**Metadata**:
```json
{
  "ticker": "AAPL",
  "document_type": "sec_filing",
  "filing_type": "10-K",
  "fiscal_period": "FY2024",
  "section_type": "mda",
  "filing_date": "2024-11-01",
  "statement_date": "2024-09-28",
  "page_number": 23
}
```

### News Articles

**Structured (PostgreSQL)**:
- Title, summary, date
- Sentiment score
- Source URL

**Semantic (Bedrock KB)**:
- Full article text (chunked)

**Metadata**:
```json
{
  "ticker": "AAPL",
  "document_type": "news",
  "published_date": "2024-11-15",
  "source": "Bloomberg",
  "sentiment": "positive",
  "topics": ["earnings", "iphone", "services"]
}
```

### Earnings Transcripts

**Structured (PostgreSQL)**:
- Metadata only (date, participants)

**Semantic (Bedrock KB)**:
- Full transcript (chunked by speaker)

**Metadata**:
```json
{
  "ticker": "AAPL",
  "document_type": "earnings_transcript",
  "fiscal_period": "Q4-2024",
  "call_date": "2024-11-02",
  "speaker": "Tim Cook",
  "section": "prepared_remarks"
}
```

### User-Uploaded Documents

**Structured (PostgreSQL)**:
- Document metadata only

**Semantic (Bedrock KB)**:
- Full content (chunked)

**Metadata**:
```json
{
  "ticker": "AAPL",
  "document_type": "user_upload",
  "upload_date": "2024-12-05",
  "file_type": "pdf",
  "title": "Apple Analysis Report"
}
```

## Deterministic Guarantees

### 1. Metric Retrieval
✅ **Always exact** - Retrieved from PostgreSQL, never from LLM extraction
✅ **Source tracking** - Every number has filing type, period, page
✅ **No hallucination** - LLM never generates numbers

### 2. "Latest" Queries
✅ **Deterministic definition**:
- Latest annual = most recent 10-K
- Latest quarterly = most recent 10-Q
- "Latest" without qualifier = both

✅ **Implementation**:
```typescript
if (period === 'latest') {
  // Get latest 10-K
  const annual = await getLatestFiling('10-K', ticker);
  // Get latest 10-Q
  const quarterly = await getLatestFiling('10-Q', ticker);
  // Return both
  return { annual, quarterly };
}
```

### 3. Document Type Routing
✅ **Explicit routing**:
- Metrics query → 10-K/10-Q only
- Strategy query → 10-K business section
- Risk query → 10-K risk factors
- News query → news articles only

### 4. Metadata Filtering
✅ **Bedrock KB filters**:
```typescript
{
  andAll: [
    { equals: { key: 'ticker', value: 'AAPL' } },
    { equals: { key: 'filing_type', value: '10-K' } },
    { equals: { key: 'fiscal_period', value: 'FY2024' } },
    { equals: { key: 'section_type', value: 'mda' } }
  ]
}
```
→ Reduces 100 chunks to 5-10 relevant chunks

## Cost Optimization

### Current System (Pure Vector)
- Retrieve: 100 chunks × $0.0004 = $0.04
- LLM: 50K tokens × $15/M = $0.75
- **Total**: ~$0.79/query

### Proposed System (Hybrid)
- PostgreSQL: Free (already running)
- Retrieve: 5 chunks × $0.0004 = $0.002
- LLM: 10K tokens × $15/M = $0.15
- **Total**: ~$0.15/query

**Savings**: 81% cost reduction

## Implementation Plan

### Week 1: Query Router
- [ ] Implement intent detection
- [ ] Build routing logic
- [ ] Test with 20 sample queries

### Week 2: Structured Retriever
- [ ] Build PostgreSQL query builder
- [ ] Implement "latest" logic
- [ ] Add computed metrics support

### Week 3: Semantic Retriever
- [ ] Export chunks to S3 with metadata
- [ ] Set up Bedrock KB
- [ ] Implement metadata filtering

### Week 4: Response Builder
- [ ] Build context assembly
- [ ] Implement pre-fill logic
- [ ] Add citation formatting

### Week 5: Integration & Testing
- [ ] End-to-end testing
- [ ] A/B test vs current system
- [ ] Measure accuracy improvement

## Success Metrics

**Accuracy**:
- Metric retrieval: 100% (deterministic)
- "Latest" queries: 100% (both Q + FY)
- Source citations: 100% (always provided)

**Performance**:
- Latency: <2 seconds (vs 5-8 current)
- Cost: $0.15/query (vs $0.79 current)

**User Trust**:
- Exact numbers with sources
- No hallucination on metrics
- Transparent reasoning

## Next Steps

1. **Review this architecture** - Does it address your concerns?
2. **Start with Query Router** - Build intent detection first
3. **Test with existing data** - Use your AAPL data to validate
4. **Iterate on metadata** - Refine filtering strategy

Ready to implement?
