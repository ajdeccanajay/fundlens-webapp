# Implementation Roadmap: Hybrid RAG System

## Overview

Building a **deterministic, hybrid retrieval system** that combines:
- **Structured retrieval** (PostgreSQL) for exact metrics
- **Semantic retrieval** (Bedrock KB) for narratives
- **Intelligent routing** based on query intent
- **Zero hallucination** on numbers

## Progress Summary

- ✅ **Week 1**: Query Router & Intent Detection - COMPLETE
- ✅ **Week 2**: Structured Retriever - COMPLETE
- ✅ **Week 3**: Semantic Retrieval with Claude Opus 4.5 - COMPLETE
- ⏳ **Week 4**: Testing & Optimization - NEXT
- ⏳ **Week 5**: Production Deployment

---

## Week-by-Week Plan

### Week 1: Query Router & Intent Detection ✅ COMPLETE

**Goal**: Parse user queries and route to correct retrieval path

**Files to Create**:
```
src/rag/
├── query-router.service.ts
├── intent-detector.service.ts
├── query-parser.service.ts
└── types/
    └── query-intent.ts
```

**Implementation**:

1. **Intent Detection** (Day 1-2)
```typescript
// src/rag/types/query-intent.ts
export interface QueryIntent {
  type: 'structured' | 'semantic' | 'hybrid';
  ticker?: string | string[];
  metrics?: string[];
  period?: string;
  periodType?: 'annual' | 'quarterly' | 'latest';
  documentTypes?: ('10-K' | '10-Q' | '8-K' | 'news' | 'transcript')[];
  sectionTypes?: ('mda' | 'risk_factors' | 'business' | 'notes')[];
  needsNarrative: boolean;
  needsComparison: boolean;
  needsComputation: boolean;
}

// src/rag/intent-detector.service.ts
export class IntentDetectorService {
  async detectIntent(query: string): Promise<QueryIntent> {
    // Use Claude to parse intent
    const prompt = this.buildIntentPrompt(query);
    const response = await this.llm.generate(prompt);
    return JSON.parse(response);
  }
}
```

2. **Query Router** (Day 3-4)
```typescript
// src/rag/query-router.service.ts
export class QueryRouterService {
  async route(query: string): Promise<RetrievalPlan> {
    const intent = await this.intentDetector.detectIntent(query);
    
    if (intent.type === 'structured') {
      return {
        useStructured: true,
        useSemantic: false,
        structuredQuery: this.buildStructuredQuery(intent),
      };
    } else if (intent.type === 'semantic') {
      return {
        useStructured: false,
        useSemantic: true,
        semanticQuery: this.buildSemanticQuery(intent),
      };
    } else {
      return {
        useStructured: true,
        useSemantic: true,
        structuredQuery: this.buildStructuredQuery(intent),
        semanticQuery: this.buildSemanticQuery(intent),
      };
    }
  }
}
```

3. **Testing** (Day 5)
```typescript
// Test with 20 sample queries
const testQueries = [
  "What was Apple's revenue in FY2024?",
  "Explain Microsoft's business strategy",
  "Why did Tesla's margins improve?",
  // ... 17 more
];

for (const query of testQueries) {
  const intent = await router.detectIntent(query);
  console.log(`Query: ${query}`);
  console.log(`Intent:`, intent);
  console.log('---');
}
```

**Deliverables**:
- ✅ Intent detection working
- ✅ Query routing logic
- ✅ 90%+ accuracy on test queries

---

### Week 2: Structured Retriever (PostgreSQL)

**Goal**: Retrieve exact metrics from database with zero hallucination

**Files to Create**:
```
src/rag/
├── structured-retriever.service.ts
├── computed-metrics.service.ts (enhance existing)
├── period-resolver.service.ts
└── types/
    └── metric-result.ts
```

**Implementation**:

1. **Structured Retriever** (Day 1-2)
```typescript
// src/rag/structured-retriever.service.ts
export class StructuredRetrieverService {
  async retrieveMetrics(intent: QueryIntent): Promise<MetricResult[]> {
    // Handle "latest" queries
    if (intent.periodType === 'latest') {
      return this.retrieveLatestMetrics(intent);
    }
    
    // Build SQL query
    const query = `
      SELECT 
        ticker,
        normalized_metric,
        value,
        fiscal_period,
        period_type,
        filing_type,
        statement_date,
        filing_date,
        source_page,
        confidence_score
      FROM financial_metrics
      WHERE ticker = ANY($1)
        AND normalized_metric = ANY($2)
        ${intent.period ? 'AND fiscal_period = $3' : ''}
      ORDER BY statement_date DESC
      LIMIT 20
    `;
    
    return await this.prisma.$queryRaw(query, [
      intent.ticker,
      intent.metrics,
      intent.period
    ]);
  }
  
  private async retrieveLatestMetrics(intent: QueryIntent) {
    // Get latest annual (10-K)
    const annual = await this.getLatestByFilingType(
      intent.ticker,
      intent.metrics,
      '10-K'
    );
    
    // Get latest quarterly (10-Q)
    const quarterly = await this.getLatestByFilingType(
      intent.ticker,
      intent.metrics,
      '10-Q'
    );
    
    return { annual, quarterly };
  }
}
```

2. **Period Resolver** (Day 3)
```typescript
// src/rag/period-resolver.service.ts
export class PeriodResolverService {
  resolvePeriod(periodString: string): PeriodInfo {
    // "latest" → { type: 'latest' }
    // "FY2024" → { type: 'annual', year: 2024 }
    // "Q4-2024" → { type: 'quarterly', quarter: 4, year: 2024 }
    // "2024" → { type: 'annual', year: 2024 }
    
    if (periodString === 'latest') {
      return { type: 'latest' };
    }
    
    if (periodString.startsWith('FY')) {
      return {
        type: 'annual',
        year: parseInt(periodString.substring(2)),
        filingType: '10-K'
      };
    }
    
    if (periodString.match(/Q\d-\d{4}/)) {
      const [quarter, year] = periodString.split('-');
      return {
        type: 'quarterly',
        quarter: parseInt(quarter.substring(1)),
        year: parseInt(year),
        filingType: '10-Q'
      };
    }
    
    // Default to annual
    return {
      type: 'annual',
      year: parseInt(periodString),
      filingType: '10-K'
    };
  }
}
```

3. **Computed Metrics** (Day 4)
```typescript
// Enhance existing src/dataSources/sec/computed-metrics.service.ts
export class ComputedMetricsService {
  async calculateMetric(
    ticker: string,
    metricName: string,
    period: string
  ): Promise<ComputedMetricResult> {
    // Check cache first
    const cached = await this.getFromCache(ticker, metricName, period);
    if (cached) return cached;
    
    // Calculate based on formula
    const formula = this.getFormula(metricName);
    const inputs = await this.getInputMetrics(ticker, formula.inputs, period);
    const value = this.evaluate(formula.expression, inputs);
    
    // Cache result
    await this.cacheResult(ticker, metricName, period, value, inputs);
    
    return {
      value,
      formula: formula.expression,
      inputs,
      period,
      calculatedAt: new Date()
    };
  }
  
  private getFormula(metricName: string): Formula {
    const formulas = {
      gross_margin: {
        expression: '(revenue - cost_of_goods_sold) / revenue * 100',
        inputs: ['revenue', 'cost_of_goods_sold']
      },
      net_margin: {
        expression: 'net_income / revenue * 100',
        inputs: ['net_income', 'revenue']
      },
      roe: {
        expression: 'net_income / total_equity * 100',
        inputs: ['net_income', 'total_equity']
      },
      // ... more formulas
    };
    
    return formulas[metricName];
  }
}
```

4. **Testing** (Day 5)
```bash
# Test structured retrieval
curl -X POST http://localhost:3000/api/rag/test-structured \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "AAPL",
    "metrics": ["revenue", "net_income"],
    "period": "latest"
  }'

# Expected: Both 10-K and 10-Q results
```

**Deliverables**:
- ✅ Structured retrieval working
- ✅ "Latest" returns both annual + quarterly
- ✅ Computed metrics cached
- ✅ 100% accuracy on metrics

---

### Week 3: Semantic Retriever (Bedrock KB)

**Goal**: Set up Bedrock Knowledge Base with rich metadata filtering

**Files to Create**:
```
src/rag/
├── semantic-retriever.service.ts
├── bedrock-kb.service.ts
├── chunk-exporter.service.ts
└── types/
    └── chunk-result.ts
```

**Implementation**:

1. **Chunk Exporter** (Day 1-2)
```typescript
// src/rag/chunk-exporter.service.ts
export class ChunkExporterService {
  async exportChunksToS3(): Promise<void> {
    // Get all document chunks
    const chunks = await this.prisma.documentChunk.findMany({
      include: {
        document: true
      }
    });
    
    // Export to S3 in Bedrock-compatible format
    for (const chunk of chunks) {
      const bedrockChunk = {
        content: chunk.content,
        metadata: {
          ticker: chunk.document.ticker,
          document_type: chunk.document.documentType,
          filing_type: chunk.metadata.filingType,
          section_type: chunk.metadata.sectionType,
          fiscal_period: chunk.metadata.fiscalPeriod,
          filing_date: chunk.document.uploadDate.toISOString(),
          chunk_index: chunk.chunkIndex,
          page_number: chunk.metadata.pageNumber
        }
      };
      
      await this.s3.uploadBuffer(
        Buffer.from(JSON.stringify(bedrockChunk)),
        `bedrock-chunks/${chunk.document.ticker}/${chunk.id}.json`,
        'application/json'
      );
    }
  }
}
```

2. **Bedrock KB Setup** (Day 2-3)
```bash
# Create OpenSearch Serverless collection
aws opensearchserverless create-collection \
  --name fundlens-vectors \
  --type VECTORSEARCH \
  --region us-east-1

# Create Knowledge Base
aws bedrock-agent create-knowledge-base \
  --name fundlens-kb \
  --role-arn arn:aws:iam::ACCOUNT:role/BedrockKBRole \
  --knowledge-base-configuration '{
    "type": "VECTOR",
    "vectorKnowledgeBaseConfiguration": {
      "embeddingModelArn": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0"
    }
  }' \
  --storage-configuration '{
    "type": "OPENSEARCH_SERVERLESS",
    "opensearchServerlessConfiguration": {
      "collectionArn": "arn:aws:aoss:us-east-1:ACCOUNT:collection/fundlens-vectors",
      "vectorIndexName": "fundlens-index",
      "fieldMapping": {
        "vectorField": "embedding",
        "textField": "content",
        "metadataField": "metadata"
      }
    }
  }'

# Add S3 data source
aws bedrock-agent create-data-source \
  --knowledge-base-id <KB_ID> \
  --name fundlens-chunks \
  --data-source-configuration '{
    "type": "S3",
    "s3Configuration": {
      "bucketArn": "arn:aws:s3:::fundlens-chunks-prod"
    }
  }'

# Start ingestion
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id <KB_ID> \
  --data-source-id <DS_ID>
```

3. **Semantic Retriever** (Day 4)
```typescript
// src/rag/semantic-retriever.service.ts
export class SemanticRetrieverService {
  async retrieveNarratives(
    query: string,
    intent: QueryIntent
  ): Promise<ChunkResult[]> {
    // Build metadata filter
    const filter = this.buildMetadataFilter(intent);
    
    // Retrieve from Bedrock KB
    const response = await this.bedrockKB.retrieve({
      knowledgeBaseId: process.env.BEDROCK_KB_ID,
      retrievalQuery: { text: query },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: 5, // NOT 100!
          filter: filter
        }
      }
    });
    
    return response.retrievalResults.map(r => ({
      content: r.content.text,
      score: r.score,
      metadata: r.metadata,
      location: r.location
    }));
  }
  
  private buildMetadataFilter(intent: QueryIntent) {
    const filters = [];
    
    if (intent.ticker) {
      filters.push({
        equals: { key: 'ticker', value: intent.ticker }
      });
    }
    
    if (intent.documentTypes) {
      filters.push({
        in: { key: 'document_type', value: intent.documentTypes }
      });
    }
    
    if (intent.sectionTypes) {
      filters.push({
        in: { key: 'section_type', value: intent.sectionTypes }
      });
    }
    
    if (intent.period && intent.period !== 'latest') {
      filters.push({
        equals: { key: 'fiscal_period', value: intent.period }
      });
    }
    
    return { andAll: filters };
  }
}
```

4. **Testing** (Day 5)
```bash
# Test semantic retrieval
curl -X POST http://localhost:3000/api/rag/test-semantic \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the main risk factors?",
    "ticker": "AAPL",
    "sectionTypes": ["risk_factors"]
  }'

# Expected: 5 chunks from risk factors section only
```

**Deliverables**:
- ✅ Chunks exported to S3
- ✅ Bedrock KB set up and ingested
- ✅ Metadata filtering working
- ✅ 5-10 chunks retrieved (not 100)

---

### Week 4: Response Builder

**Goal**: Assemble context and generate accurate responses

**Files to Create**:
```
src/rag/
├── response-builder.service.ts
├── context-assembler.service.ts
├── citation-formatter.service.ts
└── types/
    └── rag-response.ts
```

**Implementation**:

1. **Context Assembler** (Day 1-2)
```typescript
// src/rag/context-assembler.service.ts
export class ContextAssemblerService {
  assembleContext(
    metrics: MetricResult[],
    narratives: ChunkResult[]
  ): string {
    // Part 1: Exact metrics (deterministic)
    const metricsSection = this.formatMetrics(metrics);
    
    // Part 2: Narrative context (semantic)
    const narrativesSection = this.formatNarratives(narratives);
    
    return `
EXACT METRICS (use these numbers verbatim, never modify):
${metricsSection}

NARRATIVE CONTEXT (for explanation and analysis):
${narrativesSection}

INSTRUCTIONS:
1. Use EXACT numbers from metrics section - never round or approximate
2. Always cite sources: [Filing Type, Period, Page]
3. Use narratives to explain WHY, not to extract numbers
4. If asked for "latest", include both annual and quarterly
5. Never hallucinate numbers - only use provided metrics
    `.trim();
  }
  
  private formatMetrics(metrics: MetricResult[]): string {
    return metrics.map(m => `
${m.normalized_metric}: ${this.formatValue(m.value)}
Period: ${m.fiscal_period} (${m.period_type})
Filing: ${m.filing_type}
Date: ${m.statement_date}
Source: Page ${m.source_page}
Confidence: ${m.confidence_score}
    `.trim()).join('\n\n');
  }
  
  private formatNarratives(narratives: ChunkResult[]): string {
    return narratives.map((n, i) => `
[${i + 1}] ${n.content}
Source: ${n.metadata.filing_type} ${n.metadata.fiscal_period}, Page ${n.metadata.page_number}
Section: ${n.metadata.section_type}
Relevance Score: ${n.score}
    `.trim()).join('\n\n');
  }
}
```

2. **Response Builder** (Day 3-4)
```typescript
// src/rag/response-builder.service.ts
export class ResponseBuilderService {
  async buildResponse(
    query: string,
    context: string,
    intent: QueryIntent
  ): Promise<RAGResponse> {
    const systemPrompt = `
You are a financial analyst assistant with access to exact financial data.

CRITICAL RULES:
1. Use EXACT numbers from "EXACT METRICS" section - never modify, round, or approximate
2. Always cite sources using format: [Filing Type, Period, Page X]
3. Use "NARRATIVE CONTEXT" to explain trends and reasoning, NOT to extract numbers
4. If asked for "latest", always include both annual (10-K) and quarterly (10-Q) data
5. Never hallucinate or estimate numbers - only use provided metrics
6. If a metric is not provided, say "Data not available" rather than guessing
7. Format large numbers clearly: $416.2B, not $416,200,000,000

RESPONSE STRUCTURE:
1. Direct Answer: Start with the exact answer to the question
2. Supporting Data: Provide relevant metrics with sources
3. Context: Add narrative explanation if available
4. Citations: List all sources used
    `;
    
    const prompt = `
Context:
${context}

User Question: ${query}

Provide a comprehensive answer following the rules above.
    `;
    
    const answer = await this.llm.generate(prompt, systemPrompt);
    
    return {
      answer,
      intent,
      sources: this.extractSources(context),
      timestamp: new Date()
    };
  }
}
```

3. **Citation Formatter** (Day 4)
```typescript
// src/rag/citation-formatter.service.ts
export class CitationFormatterService {
  formatCitation(source: Source): string {
    return `[${source.filing_type} ${source.fiscal_period}, Page ${source.page_number}]`;
  }
  
  formatMultipleCitations(sources: Source[]): string {
    return sources.map(s => this.formatCitation(s)).join(', ');
  }
}
```

4. **Testing** (Day 5)
```bash
# Test full response
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What was Apple'\''s revenue growth in FY2024 and why?"
  }'

# Expected: Exact numbers + narrative explanation + citations
```

**Deliverables**:
- ✅ Context assembly working
- ✅ Response generation accurate
- ✅ Citations properly formatted
- ✅ Zero hallucination on numbers

---

### Week 5: Integration & Testing

**Goal**: End-to-end API and comprehensive testing

**Files to Create**:
```
src/rag/
├── rag.controller.ts
├── rag.service.ts
├── rag.module.ts
└── __tests__/
    ├── query-router.spec.ts
    ├── structured-retriever.spec.ts
    ├── semantic-retriever.spec.ts
    └── response-builder.spec.ts
```

**Implementation**:

1. **RAG Controller** (Day 1)
```typescript
// src/rag/rag.controller.ts
@Controller('api/rag')
export class RAGController {
  constructor(private readonly ragService: RAGService) {}
  
  @Post('query')
  async query(@Body() dto: RAGQueryDto) {
    return this.ragService.query(dto.query, dto.options);
  }
  
  @Post('test-intent')
  async testIntent(@Body() dto: { query: string }) {
    return this.ragService.detectIntent(dto.query);
  }
  
  @Post('test-structured')
  async testStructured(@Body() dto: StructuredQueryDto) {
    return this.ragService.testStructuredRetrieval(dto);
  }
  
  @Post('test-semantic')
  async testSemantic(@Body() dto: SemanticQueryDto) {
    return this.ragService.testSemanticRetrieval(dto);
  }
}
```

2. **Integration Tests** (Day 2-3)
```typescript
// Test suite with 50 queries
const testSuite = [
  // Structured queries
  {
    query: "What was Apple's revenue in FY2024?",
    expectedType: 'structured',
    expectedMetrics: ['revenue'],
    expectedAccuracy: 100
  },
  // Semantic queries
  {
    query: "Explain Microsoft's business model",
    expectedType: 'semantic',
    expectedSections: ['business'],
    expectedChunks: 5
  },
  // Hybrid queries
  {
    query: "Why did Tesla's margins improve?",
    expectedType: 'hybrid',
    expectedMetrics: ['gross_margin', 'net_margin'],
    expectedSections: ['mda'],
    expectedAccuracy: 95
  },
  // ... 47 more
];

for (const test of testSuite) {
  const result = await ragService.query(test.query);
  validateResult(result, test);
}
```

3. **Performance Testing** (Day 4)
```typescript
// Measure latency and cost
const metrics = {
  latency: [],
  cost: [],
  accuracy: []
};

for (let i = 0; i < 100; i++) {
  const start = Date.now();
  const result = await ragService.query(randomQuery());
  const latency = Date.now() - start;
  
  metrics.latency.push(latency);
  metrics.cost.push(calculateCost(result));
  metrics.accuracy.push(validateAccuracy(result));
}

console.log('Average latency:', average(metrics.latency));
console.log('Average cost:', average(metrics.cost));
console.log('Average accuracy:', average(metrics.accuracy));
```

4. **Documentation** (Day 5)
```markdown
# RAG API Documentation

## Query Endpoint

POST /api/rag/query

Request:
{
  "query": "What was Apple's revenue in FY2024?",
  "options": {
    "includeNarrative": true,
    "includeCitations": true
  }
}

Response:
{
  "answer": "Apple's revenue in FY2024 was $416.2B...",
  "intent": {
    "type": "structured",
    "ticker": "AAPL",
    "metrics": ["revenue"]
  },
  "sources": [
    {
      "filing_type": "10-K",
      "fiscal_period": "FY2024",
      "page": 28
    }
  ],
  "metrics": [
    {
      "metric": "revenue",
      "value": 416200000000,
      "period": "FY2024"
    }
  ]
}
```

**Deliverables**:
- ✅ End-to-end API working
- ✅ 50+ test queries passing
- ✅ Performance benchmarks met
- ✅ Documentation complete

---

## Success Criteria

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Metric Accuracy | 100% | Compare retrieved vs actual |
| "Latest" Correctness | 100% | Verify both 10-K + 10-Q returned |
| Narrative Relevance | >90% | Manual review of chunks |
| Latency | <2s | Average of 100 queries |
| Cost per Query | <$0.20 | Track Bedrock + LLM costs |
| Source Citations | 100% | Every number has source |

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Bedrock KB ingestion fails | Test with small dataset first |
| Metadata filtering doesn't work | Validate with test queries |
| LLM still hallucinates | Strengthen system prompt, add validation |
| Latency too high | Optimize chunk retrieval, cache results |
| Cost too high | Reduce chunk count, use cheaper models |

## Next Steps After Week 5

1. **Production Deployment**
   - Deploy to AWS
   - Set up monitoring
   - Configure alerts

2. **Optimization**
   - Cache frequent queries
   - Optimize chunk size
   - Fine-tune metadata filters

3. **Feature Additions**
   - Multi-company comparison
   - Trend analysis
   - Custom metrics

4. **User Interface**
   - Build frontend
   - Add visualizations
   - Create dashboards

Ready to start Week 1?
