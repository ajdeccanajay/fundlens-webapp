# Design Document: RAG Competitive Intelligence Extraction

## Overview

This design addresses critical failures in the Research Assistant RAG system where competitive intelligence, MD&A insights, and footnote details are not being extracted despite correct section identification. The system currently identifies where information should be located but fails to extract and present the actual content.

The solution implements a phased approach with clear rollback points, enabling gradual deployment and risk mitigation. Each phase builds on the previous one and can be independently deployed and rolled back.

### Problem Statement

Current failures:
- Competitive intelligence queries return section references but no actual competitor names or analysis
- MD&A queries identify Item 7 but don't extract trends, risks, or guidance
- Footnote queries locate Item 8 but don't extract accounting policy details
- Multi-company queries risk mixing data between tickers
- No confidence scoring or quality validation

### Solution Approach

Implement subsection-aware extraction with advanced retrieval techniques in 4 phases:
- **Phase 1**: Core subsection extraction and storage (foundational, low risk)
- **Phase 2**: Intent detection and subsection-aware retrieval (builds on Phase 1)
- **Phase 3**: Advanced retrieval techniques (HyDE, reranking, contextual expansion)
- **Phase 4**: Dynamic calculations and multi-modal responses (highest complexity)

Each phase has clear success criteria, rollback procedures, and git tagging strategy.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Query                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Intent Detector Service                       │
│  • Classify query type (competitive, MD&A, footnote)            │
│  • Extract tickers, metrics, periods                            │
│  • Identify target sections and subsections                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Semantic Retriever Service                      │
│  • Filter by section_type + subsection_name                     │
│  • Query Bedrock KB or PostgreSQL                               │
│  • Apply reranking (Phase 3)                                    │
│  • Expand context (Phase 3)                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Response Generator Service                      │
│  • Extract structured information                               │
│  • Generate confidence scores                                   │
│  • Validate response quality                                    │
│  • Format with citations                                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      RAG Response                                │
│  • Structured insights (competitors, trends, policies)          │
│  • Confidence scores                                            │
│  • Citations with section/subsection references                 │
│  • Hybrid qualitative + quantitative data                       │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
SEC Filing (HTML/PDF)
    ↓
Section Parser (Python)
    ├── Extract major sections (Item 1-16)
    ├── Identify subsections within each section
    ├── Create narrative chunks with metadata
    └── Store: ticker, section_type, subsection_name, content
    ↓
PostgreSQL (narrative_chunks table)
    ├── subsection_name column (nullable)
    ├── Indexes: (ticker, section_type, subsection_name)
    └── Backward compatible with existing data
    ↓
Bedrock KB Sync
    ├── Export chunks to S3 with subsection metadata
    ├── Bedrock KB ingests and indexes
    └── Subsection_name as filterable attribute
    ↓
Query Processing
    ├── Intent detection → target subsection
    ├── Retrieval → filter by subsection
    ├── Extraction → structured insights
    └── Response → with citations
```


## Components and Interfaces

### 1. Section Parser Enhancement (Python)

**Location**: `python_parser/section_parser.py`

**Purpose**: Extract subsections from SEC filings and label narrative chunks

**Key Methods**:
```python
class SectionParser:
    def extract_sections_with_subsections(self, filing_html: str) -> List[Section]:
        """Extract major sections and identify subsections within each"""
        
    def identify_subsections(self, section_content: str, section_type: str) -> List[Subsection]:
        """Identify subsections based on section type and content patterns"""
        
    def create_chunks_with_metadata(self, section: Section) -> List[NarrativeChunk]:
        """Create chunks with section_type and subsection_name metadata"""
```

**Subsection Identification Patterns**:
- **Item 1 (Business)**: Competition, Products, Customers, Markets, Operations, Strategy, Intellectual Property, Human Capital
- **Item 7 (MD&A)**: Results of Operations, Liquidity and Capital Resources, Critical Accounting Policies, Market Risk, Contractual Obligations
- **Item 8 (Financial Statements)**: Note 1, Note 2, etc., Revenue Recognition, Leases, Stock-Based Compensation
- **Item 1A (Risk Factors)**: Operational Risks, Financial Risks, Market Risks, Regulatory Risks

**Backward Compatibility**: Existing chunks without subsection_name will have null values

### 2. Intent Detector Service Enhancement (TypeScript)

**Location**: `src/rag/intent-detector.service.ts`

**Purpose**: Enhance existing intent detection with subsection-level targeting for ALL query types

**CRITICAL CLARIFICATION**: This enhancement ADDS subsection awareness to the existing intent detector, which already handles:
- Query types: 'structured', 'semantic', 'hybrid'
- Multiple tickers for comparison queries
- Extensive metric extraction (Revenue, Net_Income, Gross_Profit, Operating_Income, etc.)
- Period extraction (FY2024, Q4-2024, latest)
- Document type detection (10-K, 10-Q, 8-K, news, earnings transcripts)
- Section type detection (item_1, item_7, item_8, item_1a, item_2, item_3)
- Flags: needsNarrative, needsComparison, needsComputation, needsTrend

**Phase 2 Enhancement**: Add subsection identification to ALL existing query types, not just competitive intelligence.

**Key Methods**:
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

class IntentDetectorService {
  async detectIntent(query: string): Promise<QueryIntent>
  
  // EXISTING METHODS (already implemented)
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

**Subsection Identification Rules** (NEW in Phase 2):

When `sectionType` is identified, also identify `subsectionName`:

- **Item 1 (Business)**: 
  - "competitors", "competitive landscape", "competition" → "Competition"
  - "products", "product line", "offerings" → "Products"
  - "customers", "customer base" → "Customers"
  - "markets", "market segments" → "Markets"
  - "operations", "business operations" → "Operations"
  - "strategy", "business strategy" → "Strategy"
  - "intellectual property", "patents", "trademarks" → "Intellectual Property"
  - "employees", "human capital", "workforce" → "Human Capital"

- **Item 7 (MD&A)**:
  - "results of operations", "operating results", "performance" → "Results of Operations"
  - "liquidity", "capital resources", "cash flow" → "Liquidity and Capital Resources"
  - "critical accounting", "accounting policies", "estimates" → "Critical Accounting Policies"
  - "market risk", "interest rate risk", "currency risk" → "Market Risk"
  - "contractual obligations", "commitments" → "Contractual Obligations"

- **Item 8 (Financial Statements)**:
  - "revenue recognition", "revenue policy" → "Revenue Recognition"
  - "leases", "lease accounting" → "Leases"
  - "stock-based compensation", "equity compensation" → "Stock-Based Compensation"
  - "income taxes", "tax provision" → "Income Taxes"
  - "debt", "borrowings", "credit facilities" → "Debt"
  - "fair value", "fair value measurements" → "Fair Value"
  - "note [number]" → Extract note number

- **Item 1A (Risk Factors)**:
  - "operational risk" → "Operational Risks"
  - "financial risk" → "Financial Risks"
  - "market risk" → "Market Risks"
  - "regulatory risk", "compliance" → "Regulatory Risks"
  - "technology risk", "cybersecurity" → "Technology Risks"

**Examples**:

1. **Structured Query with Subsection**:
   - Query: "What is AAPL's revenue recognition policy?"
   - Intent: `{ type: 'semantic', ticker: 'AAPL', sectionTypes: ['item_8'], subsectionName: 'Revenue Recognition' }`

2. **Competitive Intelligence Query**:
   - Query: "Who are NVDA's competitors?"
   - Intent: `{ type: 'semantic', ticker: 'NVDA', sectionTypes: ['item_1'], subsectionName: 'Competition' }`

3. **MD&A Query**:
   - Query: "What are META's growth drivers?"
   - Intent: `{ type: 'semantic', ticker: 'META', sectionTypes: ['item_7'], subsectionName: 'Results of Operations' }`

4. **Hybrid Query with Subsection**:
   - Query: "What is AMZN's revenue and how do they recognize it?"
   - Intent: `{ type: 'hybrid', ticker: 'AMZN', metrics: ['Revenue'], sectionTypes: ['item_8'], subsectionName: 'Revenue Recognition' }`

### 3. Semantic Retriever Service Enhancement (TypeScript)

**Location**: `src/rag/semantic-retriever.service.ts`

**Purpose**: Retrieve narratives filtered by subsection

**Key Methods**:
```typescript
interface SemanticQuery {
  query: string;
  tickers?: string[];
  sectionTypes?: string[];
  subsectionNames?: string[]; // NEW
  documentTypes?: string[];
  fiscalPeriod?: string;
  numberOfResults?: number;
}

class SemanticRetrieverService {
  async retrieve(query: SemanticQuery): Promise<ChunkResult[]>
  
  private async retrieveFromBedrock(query: SemanticQuery): Promise<ChunkResult[]>
  private async retrieveFromPostgres(query: SemanticQuery): Promise<ChunkResult[]>
  private async fallbackToSectionOnly(query: SemanticQuery): Promise<ChunkResult[]>
}
```

**Retrieval Strategy**:
1. Try subsection-filtered retrieval (section_type + subsection_name)
2. If no results, fallback to section-only retrieval (section_type)
3. If still no results, fallback to broader semantic search
4. Log all fallback events for monitoring

**Multi-Ticker Handling**:
- Process each ticker independently
- Validate no cross-contamination
- Merge results with clear ticker separation

### 4. Response Generator Service (TypeScript)

**Location**: `src/rag/response-generator.service.ts` (NEW)

**Purpose**: Extract structured insights and generate responses

**Key Methods**:
```typescript
interface StructuredInsight {
  type: 'competitive_intelligence' | 'mda_intelligence' | 'footnote';
  content: any; // Type-specific structure
  confidence: number;
  citations: Citation[];
}

class ResponseGeneratorService {
  async generateResponse(
    query: string,
    intent: QueryIntent,
    chunks: ChunkResult[]
  ): Promise<RAGResponse>
  
  private async extractCompetitiveIntelligence(chunks: ChunkResult[]): Promise<CompetitiveIntelligence>
  private async extractMDAIntelligence(chunks: ChunkResult[]): Promise<MDAIntelligence>
  private async extractFootnoteContent(chunks: ChunkResult[]): Promise<FootnoteContent>
  private calculateConfidence(insight: any, chunks: ChunkResult[]): number
  private validateResponse(response: RAGResponse): boolean
}
```

**Extraction Structures**:
```typescript
interface CompetitiveIntelligence {
  competitors: Array<{
    name: string;
    context: string;
    threatLevel?: 'high' | 'medium' | 'low';
  }>;
  marketPositioning: string;
  competitiveAdvantages: string[];
  competitiveDisadvantages: string[];
  marketShare?: Record<string, number>;
}

interface MDAIntelligence {
  keyTrends: string[];
  risks: Array<{
    category: 'operational' | 'market' | 'regulatory';
    description: string;
  }>;
  forwardGuidance: Array<{
    statement: string;
    timeframe: string;
  }>;
  managementPerspective: string;
}

interface FootnoteContent {
  policySummary: string;
  keyAssumptions: string[];
  quantitativeDetails: Record<string, any>;
  changesFromPriorPeriods: string[];
}
```


### 5. Reranker Service (TypeScript)

**Location**: `src/rag/reranker.service.ts` (NEW - Phase 3)

**Purpose**: Re-score retrieved chunks for improved relevance

**Key Methods**:
```typescript
class RerankerService {
  async rerank(
    query: string,
    chunks: ChunkResult[],
    model: 'mistral' | 'cohere' = 'mistral'
  ): Promise<ChunkResult[]>
  
  private async rerankWithMistral(query: string, chunks: ChunkResult[]): Promise<ChunkResult[]>
  private async fallbackToOriginalScores(chunks: ChunkResult[]): Promise<ChunkResult[]>
}
```

**Reranking Strategy**:
- Use Mistral reranking model via Bedrock
- Re-score all retrieved chunks (0.0 to 1.0)
- Sort by reranked scores descending
- Fallback to original scores if reranking fails

### 6. Advanced Retrieval Service (TypeScript)

**Location**: `src/rag/advanced-retrieval.service.ts` (NEW - Phase 3)

**Purpose**: Implement HyDE, query decomposition, and contextual expansion

**Key Methods**:
```typescript
class AdvancedRetrievalService {
  // HyDE (Hypothetical Document Embeddings)
  async retrieveWithHyDE(query: string, filters: MetadataFilter): Promise<ChunkResult[]>
  
  // Query Decomposition
  async decomposeAndRetrieve(query: string): Promise<Map<string, ChunkResult[]>>
  
  // Contextual Expansion
  async expandContext(chunks: ChunkResult[], maxTokens: number): Promise<ChunkResult[]>
  
  // Iterative Retrieval
  async iterativeRetrieve(query: string, maxIterations: number): Promise<ChunkResult[]>
}
```

**HyDE Process**:
1. Generate hypothetical answer using Claude
2. Embed hypothetical answer
3. Retrieve using hypothetical embedding
4. Merge with query-based retrieval
5. Deduplicate results

**Query Decomposition Process**:
1. Detect multi-faceted queries
2. Break into sub-queries using Claude
3. Execute each sub-query independently
4. Track which sub-query contributed to which results
5. Synthesize unified response

**Contextual Expansion Process**:
1. For each retrieved chunk, fetch adjacent chunks (chunk_index ± 1)
2. Merge into coherent context window
3. Preserve chunk boundaries for citations
4. Limit to token budget (4000 tokens)

### 7. Dynamic Calculator Service (TypeScript)

**Location**: `src/rag/dynamic-calculator.service.ts` (NEW - Phase 4)

**Purpose**: Calculate custom financial metrics on-demand

**Key Methods**:
```typescript
interface FormulaDefinition {
  metricName: string;
  formula: string;
  requiredComponents: string[];
  validationRules: ValidationRule[];
}

class DynamicCalculatorService {
  async calculateMetric(
    formula: FormulaDefinition,
    ticker: string,
    period: string
  ): Promise<CalculationResult>
  
  async extractFormulaFromQuery(query: string): Promise<FormulaDefinition>
  async validateFormula(formula: FormulaDefinition): Promise<boolean>
  async cacheFormula(formula: FormulaDefinition): Promise<void>
  async getCachedFormula(metricName: string): Promise<FormulaDefinition | null>
}
```

**Formula Validation**:
- Check against known financial formulas library
- Whitelist allowed operations (arithmetic, basic functions)
- Validate result bounds (e.g., margins 0-100%)
- Reject unknown operations without user confirmation

### 8. Chart Generator Service (TypeScript)

**Location**: `src/rag/chart-generator.service.ts` (NEW - Phase 4)

**Purpose**: Generate chart configurations for visualizations

**Key Methods**:
```typescript
type ChartType = 'line' | 'bar' | 'pie' | 'scatter';

interface ChartConfig {
  type: ChartType;
  data: any;
  options: any;
}

class ChartGeneratorService {
  async generateChart(
    data: any[],
    chartType: ChartType,
    options?: Partial<ChartConfig>
  ): Promise<ChartConfig>
  
  private applyConsistentStyling(config: ChartConfig): ChartConfig
  private suggestAlternativeChartType(data: any[], requestedType: ChartType): ChartType
}
```

**Chart Types**:
- **Line**: Trend analysis over time
- **Bar**: Peer comparisons
- **Pie**: Composition analysis
- **Scatter**: Correlation analysis

### 9. Code Interpreter Service (TypeScript)

**Location**: `src/rag/code-interpreter.service.ts` (NEW - Phase 4)

**Purpose**: Execute complex financial calculations using Python

**Key Methods**:
```typescript
class CodeInterpreterService {
  async executeCalculation(
    code: string,
    data: Record<string, any>
  ): Promise<ExecutionResult>
  
  private async generatePythonCode(query: string, data: any): Promise<string>
  private async executeSandboxed(code: string, data: any): Promise<any>
  private async retryWithCorrection(code: string, error: string): Promise<any>
}
```

**Supported Calculations**:
- Regression analysis
- Correlation matrices
- Scenario modeling
- Sensitivity analysis

**Safety**:
- Sandboxed execution environment
- Timeout limits (30 seconds)
- Resource limits (memory, CPU)
- Code validation before execution

## Data Models

### Database Schema Changes

```sql
-- Phase 1: Add subsection_name column to narrative_chunks
ALTER TABLE narrative_chunks 
ADD COLUMN subsection_name TEXT NULL;

-- Create index for efficient subsection filtering
CREATE INDEX idx_narrative_chunks_subsection 
ON narrative_chunks(ticker, section_type, subsection_name);

-- Phase 4: Add formula_cache table
CREATE TABLE formula_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name VARCHAR(255) UNIQUE NOT NULL,
  formula TEXT NOT NULL,
  required_components TEXT[] NOT NULL,
  validation_status VARCHAR(50) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add audit_log table for formula executions
CREATE TABLE formula_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id UUID REFERENCES formula_cache(id),
  ticker VARCHAR(10) NOT NULL,
  period VARCHAR(50) NOT NULL,
  inputs JSONB NOT NULL,
  output JSONB NOT NULL,
  execution_time_ms INTEGER NOT NULL,
  executed_at TIMESTAMP DEFAULT NOW()
);
```

### Bedrock KB Metadata Format

```json
{
  "ticker": "AAPL",
  "sectionType": "item_1",
  "subsectionName": "Competition",
  "filingType": "10-K",
  "fiscalPeriod": "FY2024",
  "chunkIndex": 5,
  "pageNumber": 12
}
```

### Response Format

```typescript
interface RAGResponse {
  answer: string;
  intent: QueryIntent;
  structuredInsight?: StructuredInsight;
  metrics?: any[];
  narratives?: ChunkResult[];
  charts?: ChartConfig[];
  sources: Citation[];
  confidence: number;
  timestamp: Date;
  latency: number;
  cost: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

interface Citation {
  type: 'narrative' | 'metric';
  ticker: string;
  section: string;
  subsection?: string;
  filingType: string;
  fiscalPeriod: string;
  pageNumber?: number;
  confidence: number;
}
```


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Phase 1 Properties (Core Subsection Extraction)

**Property 1: Universal Subsection Identification**
*For any* major SEC section (Item 1-16, Part I/II), when the Section_Parser extracts it, all identifiable subsections within that section should be labeled with subsection_name metadata.
**Validates: Requirements 1.1**

**Property 2: Subsection Metadata Persistence**
*For any* narrative chunk created from a section with identified subsections, the chunk should store the subsection_name in its metadata.
**Validates: Requirements 1.6, 1.7**

**Property 3: Hierarchical Subsection Support**
*For any* hierarchical subsection structure (e.g., Item 7 > Results of Operations > Revenue Analysis), the Section_Parser should preserve the full hierarchy in subsection_name.
**Validates: Requirements 1.10**

**Property 4: Backward Compatibility**
*For any* existing narrative chunk without subsection_name, the system should handle it without errors, treating subsection_name as null.
**Validates: Requirements 1.8**

### Phase 2 Properties (Intent Detection and Retrieval)

**Property 5: Subsection Identification for ALL Query Types**
*For any* query where the Intent_Detector identifies a section_type (item_1, item_7, item_8, item_1a), if the query contains subsection keywords, the Intent_Detector should also identify the target subsection_name.
**Validates: Requirements 2.1**

**Property 6: Subsection Prioritization**
*For any* query matching multiple subsection patterns, the Intent_Detector should prioritize the most specific subsection over general subsections.
**Validates: Requirements 2.6**

**Property 7: Competitive Intelligence Subsection Detection**
*For any* query containing competitive keywords ("competitors", "competitive landscape", "competition"), the Intent_Detector should set sectionTypes=['item_1'] and subsectionName='Competition'.
**Validates: Requirements 2.2, 2.3**

**Property 8: MD&A Subsection Detection**
*For any* query containing MD&A keywords ("growth drivers", "trends", "outlook", "guidance"), the Intent_Detector should set sectionTypes=['item_7'] and identify the relevant subsection when specific topics are mentioned.
**Validates: Requirements 3.1, 3.2**

**Property 9: Footnote Subsection Detection**
*For any* query containing footnote keywords ("footnote", "accounting policy", "revenue recognition", "note [number]"), the Intent_Detector should set sectionTypes=['item_8'] and identify the relevant subsection when specific policies are mentioned.
**Validates: Requirements 4.1, 4.2**

**Property 10: Subsection-Filtered Retrieval**
*For any* query with a specified subsection, the Semantic_Retriever should filter results by both section_type and subsection_name.
**Validates: Requirements 5.1**

**Property 11: Retrieval Fallback Chain**
*For any* subsection-filtered retrieval returning zero results, the Semantic_Retriever should automatically fallback to section-only filtering, then broader semantic search.
**Validates: Requirements 5.5, 12.1, 12.2**

**Property 12: Multi-Ticker Isolation**
*For any* multi-ticker query, the Semantic_Retriever should process each ticker independently, and no chunk from ticker A should appear in ticker B's results.
**Validates: Requirements 10.1, 10.2, 10.4**

**Property 13: Existing Query Type Preservation**
*For any* query processed by the enhanced Intent_Detector, the existing query type classification (structured, semantic, hybrid) should be preserved, with subsection identification added as an enhancement.
**Validates: Requirements 2.7**

### Phase 3 Properties (Advanced Retrieval)

**Property 12: Reranking Score Improvement**
*For any* set of retrieved chunks, after reranking, the top-ranked chunks should have higher relevance scores than before reranking (or equal if already optimal).
**Validates: Requirements 5A.1, 5A.2**

**Property 13: Reranking Fallback Safety**
*For any* reranking failure, the Semantic_Retriever should preserve original retrieval scores without errors.
**Validates: Requirements 5A.3**

**Property 14: Contextual Expansion Token Budget**
*For any* chunk expansion operation, the total token count of expanded context should not exceed the specified token budget (e.g., 4000 tokens).
**Validates: Requirements 21.4**

**Property 15: HyDE Deduplication**
*For any* HyDE-based retrieval, chunks retrieved by both query-based and HyDE-based methods should be deduplicated before returning results.
**Validates: Requirements 23.4**

**Property 16: Query Decomposition Completeness**
*For any* complex multi-faceted query, all identified sub-queries should be executed, and each part of the final response should be traceable to a specific sub-query.
**Validates: Requirements 22.2, 22.4**

**Property 17: Iterative Retrieval Termination**
*For any* iterative retrieval process, the system should terminate after a maximum of 2 iterations regardless of result quality.
**Validates: Requirements 26.3**

### Phase 4 Properties (Dynamic Calculations and Multi-Modal)

**Property 18: Formula Validation Safety**
*For any* generated formula, the system should validate it against known financial formulas and reject formulas with unknown operations unless user-confirmed.
**Validates: Requirements 34.1, 34.2**

**Property 19: Formula Result Bounds**
*For any* calculated metric with known bounds (e.g., margins 0-100%), the result should fall within those bounds or trigger a validation error.
**Validates: Requirements 34.3**

**Property 20: Formula Cache Consistency**
*For any* successfully validated and executed formula, if cached, subsequent retrievals of that formula should return the identical formula definition.
**Validates: Requirements 28A.1, 28A.2**

**Property 21: Chart Type Appropriateness**
*For any* data array and requested chart type, if the data is unsuitable for that chart type, the Chart_Generator should suggest an alternative chart type.
**Validates: Requirements 31.5**

**Property 22: Code Execution Safety**
*For any* Python code execution request, the code should execute in a sandboxed environment with timeout and resource limits enforced.
**Validates: Requirements 32.2**

### Cross-Phase Properties (Quality and Confidence)

**Property 23: Confidence Score Bounds**
*For any* extracted insight, the confidence score should be between 0.0 and 1.0 inclusive.
**Validates: Requirements 11.1**

**Property 24: Low Confidence Indication**
*For any* extraction with confidence below 0.7, the response should explicitly indicate uncertainty to the user.
**Validates: Requirements 11.3**

**Property 25: Citation Completeness**
*For any* extracted information presented to the user, all contributing chunks should be cited with section, subsection (if available), filing type, and fiscal period.
**Validates: Requirements 9.1, 9.2, 9.3**

**Property 26: Response Validation**
*For any* generated response, all claims should be verifiable against the retrieved chunks, and unverifiable claims should be rejected.
**Validates: Requirements 13.1, 13.2, 13.3**

**Property 27: Hybrid Response Distinction**
*For any* hybrid response combining qualitative and quantitative data, the response should clearly distinguish between narrative insights (from SEC text) and financial metrics (from XBRL).
**Validates: Requirements 18.4**

**Property 28: Feature Flag Fallback**
*For any* disabled feature flag, the system should fall back to previous behavior without errors or degradation.
**Validates: Requirements 36.2**

**Property 29: Monitoring Event Logging**
*For any* extraction attempt, the system should log the attempt with intent type, ticker, success/failure status, and latency.
**Validates: Requirements 17.1, 37.1**

**Property 30: Feedback Storage**
*For any* user feedback (thumbs up/down), the system should store it with the query, response, and intent for future analysis.
**Validates: Requirements 39.3**


## Error Handling

### Error Categories

**1. Retrieval Errors**
- No chunks found for query
- Bedrock KB unavailable
- PostgreSQL connection failure
- Timeout during retrieval

**Handling Strategy**:
- Fallback chain: Bedrock KB → PostgreSQL → Section-based → Empty result with explanation
- Log all fallback events
- Return partial results when possible
- Clear error messages to user

**2. Extraction Errors**
- Low confidence extraction (< 0.5)
- No structured information found
- Conflicting information in chunks
- Validation failure

**Handling Strategy**:
- Return qualified response indicating limitations
- Provide raw chunks for user review
- Log extraction failures for analysis
- Suggest query refinement

**3. Calculation Errors**
- Invalid formula
- Missing component metrics
- Calculation out of bounds
- Code execution failure

**Handling Strategy**:
- Validate formulas before execution
- Check component availability before calculation
- Retry with corrected code (max 2 attempts)
- Fall back to text-only response
- Display formula to user for transparency

**4. Multi-Ticker Errors**
- Ticker mixing detected
- Incomplete data for some tickers
- Validation failure

**Handling Strategy**:
- Reject response if mixing detected
- Indicate which tickers have missing data
- Process available tickers and note gaps
- Never return mixed results

### Rollback Procedures

**Phase 1 Rollback**:
```bash
# Revert database schema
ALTER TABLE narrative_chunks DROP COLUMN subsection_name;
DROP INDEX idx_narrative_chunks_subsection;

# Revert to previous parser version
git checkout rag-extraction-baseline
```

**Phase 2 Rollback**:
```bash
# Disable subsection filtering via feature flag
FEATURE_SUBSECTION_FILTERING=false

# Revert to section-only retrieval
git checkout rag-extraction-phase1-v1.0.0
```

**Phase 3 Rollback**:
```bash
# Disable advanced retrieval features
FEATURE_RERANKING=false
FEATURE_HYDE=false
FEATURE_CONTEXTUAL_EXPANSION=false

# Revert to basic retrieval
git checkout rag-extraction-phase2-v1.0.0
```

**Phase 4 Rollback**:
```bash
# Disable dynamic calculations and multi-modal
FEATURE_DYNAMIC_CALCULATIONS=false
FEATURE_MULTI_MODAL_RESPONSES=false
FEATURE_CODE_INTERPRETER=false

# Revert to text-only responses
git checkout rag-extraction-phase3-v1.0.0
```

### Monitoring and Alerting

**Key Metrics**:
- Extraction success rate by intent type (target: >95% for competitive intelligence)
- Average confidence scores by intent type
- Retrieval latency (p50, p95, p99)
- Fallback frequency
- Formula validation failure rate (alert if >10%)
- Multi-ticker mixing incidents (alert immediately)

**Alert Thresholds**:
- Competitive intelligence success rate < 95%
- MD&A success rate < 90%
- Dynamic calculation success rate < 90%
- Formula validation failures > 10%
- Any multi-ticker mixing incident
- Retrieval latency p95 > 5 seconds

## Testing Strategy

### Dual Testing Approach

The system requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests**: Verify specific examples, edge cases, and error conditions
- Specific subsection identification examples (Item 1 Competition, Item 7 MD&A)
- Known competitive intelligence queries
- Multi-ticker separation validation
- Formula validation with known formulas
- Chart generation for each chart type
- Error handling scenarios

**Property Tests**: Verify universal properties across all inputs
- Subsection identification for all section types
- Intent classification for all query patterns
- Retrieval filtering for all subsection combinations
- Confidence score bounds for all extractions
- Citation completeness for all responses
- Feature flag fallback for all features

**Property Test Configuration**:
- Library: `fast-check` (TypeScript), `hypothesis` (Python)
- Minimum 100 iterations per property test
- Each test tagged with: `Feature: rag-competitive-intelligence-extraction, Property {number}: {property_text}`
- Each correctness property implemented by a SINGLE property-based test

### Test Coverage by Phase

**Phase 1 Tests**:
- Unit: Subsection identification for Item 1, 7, 8, 1A
- Unit: Backward compatibility with existing chunks
- Property: Universal subsection identification (Property 1)
- Property: Subsection metadata persistence (Property 2)
- Property: Hierarchical subsection support (Property 3)
- Property: Backward compatibility (Property 4)

**Phase 2 Tests**:
- Unit: Competitive intelligence intent detection examples
- Unit: MD&A intent detection examples
- Unit: Footnote intent detection examples
- Unit: Multi-ticker query separation
- Property: Competitive intelligence classification (Property 5)
- Property: Intent prioritization (Property 6)
- Property: MD&A classification (Property 7)
- Property: Footnote classification (Property 8)
- Property: Subsection-filtered retrieval (Property 9)
- Property: Retrieval fallback chain (Property 10)
- Property: Multi-ticker isolation (Property 11)

**Phase 3 Tests**:
- Unit: Reranking with known chunks
- Unit: HyDE generation examples
- Unit: Query decomposition examples
- Property: Reranking score improvement (Property 12)
- Property: Reranking fallback safety (Property 13)
- Property: Contextual expansion token budget (Property 14)
- Property: HyDE deduplication (Property 15)
- Property: Query decomposition completeness (Property 16)
- Property: Iterative retrieval termination (Property 17)

**Phase 4 Tests**:
- Unit: Formula validation with known formulas
- Unit: Chart generation for each type
- Unit: Code execution with sample calculations
- Property: Formula validation safety (Property 18)
- Property: Formula result bounds (Property 19)
- Property: Formula cache consistency (Property 20)
- Property: Chart type appropriateness (Property 21)
- Property: Code execution safety (Property 22)

**Cross-Phase Tests**:
- Property: Confidence score bounds (Property 23)
- Property: Low confidence indication (Property 24)
- Property: Citation completeness (Property 25)
- Property: Response validation (Property 26)
- Property: Hybrid response distinction (Property 27)
- Property: Feature flag fallback (Property 28)
- Property: Monitoring event logging (Property 29)
- Property: Feedback storage (Property 30)

### Integration Tests

**End-to-End Scenarios**:
1. Competitive intelligence query → subsection retrieval → structured extraction → response with citations
2. MD&A query → subsection retrieval → trend extraction → response with confidence scores
3. Footnote query → subsection retrieval → policy extraction → response with technical details
4. Multi-ticker query → independent processing → merged results → validation
5. Dynamic calculation query → formula extraction → calculation → response with formula display
6. Hybrid query → qualitative + quantitative retrieval → combined response → clear distinction

**Test Data**:
- Real SEC filings: AAPL, MSFT, AMZN, NVDA (10-K, 10-Q)
- Known competitive intelligence sections
- Known MD&A sections with trends and guidance
- Known footnotes with accounting policies
- Multi-company scenarios

### Performance Tests

**Latency Targets**:
- Standard queries: < 5 seconds (p95)
- Dynamic calculation queries: < 8 seconds (p95)
- Code interpreter queries: < 15 seconds (p95)

**Load Tests**:
- 100 concurrent users
- Sustained load for 10 minutes
- No degradation in success rates or latency

### Minimum Coverage

- Code coverage: 90% for all new components
- Property test coverage: All 30 correctness properties
- Integration test coverage: All 6 end-to-end scenarios
- Error handling coverage: All error categories


## Phased Implementation Strategy

### Phase 1: Core Subsection Extraction and Storage

**Objective**: Establish foundational subsection extraction and storage without changing retrieval behavior

**Git Tag**: `rag-extraction-phase1-v1.0.0`

**Components**:
1. Enhance Python Section Parser to identify subsections
2. Add subsection_name column to narrative_chunks table
3. Update chunk creation to include subsection metadata
4. Backfill existing chunks (optional, can be null)
5. Export subsection metadata to Bedrock KB

**Success Criteria**:
- All new chunks have subsection_name populated (when identifiable)
- Database schema updated without breaking existing queries
- Bedrock KB metadata includes subsection_name
- No impact on current retrieval behavior
- Backward compatibility maintained

**Rollback Procedure**:
```bash
# Database rollback
ALTER TABLE narrative_chunks DROP COLUMN subsection_name;
DROP INDEX idx_narrative_chunks_subsection;

# Code rollback
git checkout rag-extraction-baseline
npm run build
npm run deploy
```

**Testing**:
- Unit tests for subsection identification (Item 1, 7, 8, 1A)
- Property tests for universal subsection identification
- Integration tests for chunk creation with metadata
- Backward compatibility tests with existing chunks

**Risk Level**: LOW
- No changes to retrieval or response generation
- Additive schema change (nullable column)
- Can be rolled back without data loss

---

### Phase 2: Intent Detection and Subsection-Aware Retrieval

**Objective**: Enable subsection-aware retrieval for competitive intelligence, MD&A, and footnote queries

**Git Tag**: `rag-extraction-phase2-v1.0.0`

**Components**:
1. Enhance Intent Detector to classify competitive intelligence, MD&A, footnote intents
2. Add subsection targeting to Intent Detector
3. Update Semantic Retriever to filter by subsection_name
4. Implement fallback chain (subsection → section → broad)
5. Add multi-ticker isolation validation
6. Create Response Generator service for structured extraction

**Success Criteria**:
- Competitive intelligence queries return Competition subsection content
- MD&A queries return relevant MD&A subsection content
- Footnote queries return specific note content
- Multi-ticker queries maintain strict separation
- Fallback chain works when subsection filtering returns no results
- Extraction success rate > 95% for competitive intelligence

**Rollback Procedure**:
```bash
# Feature flag disable
FEATURE_SUBSECTION_FILTERING=false
FEATURE_STRUCTURED_EXTRACTION=false

# Code rollback
git checkout rag-extraction-phase1-v1.0.0
npm run build
npm run deploy
```

**Testing**:
- Unit tests for intent classification (competitive, MD&A, footnote)
- Property tests for intent prioritization and subsection targeting
- Integration tests for end-to-end competitive intelligence extraction
- Multi-ticker isolation tests
- Fallback chain tests

**Risk Level**: MEDIUM
- Changes retrieval behavior (but with fallback)
- New response generation logic
- Can be disabled via feature flags
- Rollback to Phase 1 is clean

---

### Phase 3: Advanced Retrieval Techniques

**Objective**: Improve retrieval accuracy with reranking, HyDE, contextual expansion, and iterative retrieval

**Git Tag**: `rag-extraction-phase3-v1.0.0`

**Components**:
1. Create Reranker Service (Mistral via Bedrock)
2. Create Advanced Retrieval Service
3. Implement HyDE (Hypothetical Document Embeddings)
4. Implement Query Decomposition
5. Implement Contextual Chunk Expansion
6. Implement Iterative Retrieval

**Success Criteria**:
- Reranking improves top-3 relevance by 10%
- HyDE retrieval finds relevant chunks missed by direct query
- Query decomposition handles multi-faceted queries correctly
- Contextual expansion provides complete context without exceeding token budget
- Iterative retrieval improves low-confidence results
- No degradation in latency (p95 < 5 seconds)

**Rollback Procedure**:
```bash
# Feature flag disable
FEATURE_RERANKING=false
FEATURE_HYDE=false
FEATURE_QUERY_DECOMPOSITION=false
FEATURE_CONTEXTUAL_EXPANSION=false
FEATURE_ITERATIVE_RETRIEVAL=false

# Code rollback
git checkout rag-extraction-phase2-v1.0.0
npm run build
npm run deploy
```

**Testing**:
- Unit tests for each advanced technique
- Property tests for reranking, HyDE deduplication, token budget
- Integration tests comparing Phase 2 vs Phase 3 retrieval quality
- Performance tests to ensure latency targets met

**Risk Level**: MEDIUM
- Adds complexity to retrieval pipeline
- Increases latency and cost
- Can be disabled via feature flags
- Rollback to Phase 2 is clean

---

### Phase 4: Dynamic Calculations and Multi-Modal Responses

**Objective**: Enable custom metric calculations, chart generation, and code interpreter for advanced analysis

**Git Tag**: `rag-extraction-phase4-v1.0.0`

**Components**:
1. Create Dynamic Calculator Service
2. Create Formula Cache and Audit Log tables
3. Implement LLM-assisted formula extraction
4. Create Chart Generator Service
5. Create Code Interpreter Service (sandboxed Python execution)
6. Implement multi-modal response generation

**Success Criteria**:
- Dynamic calculations work for custom metrics
- Formula validation prevents incorrect calculations
- Formula cache improves performance for repeated calculations
- Charts generated for appropriate query types
- Code interpreter executes complex calculations safely
- Multi-modal responses include text + tables + charts
- Dynamic calculation success rate > 90%

**Rollback Procedure**:
```bash
# Feature flag disable
FEATURE_DYNAMIC_CALCULATIONS=false
FEATURE_FORMULA_CACHE=false
FEATURE_CHART_GENERATION=false
FEATURE_CODE_INTERPRETER=false
FEATURE_MULTI_MODAL_RESPONSES=false

# Code rollback
git checkout rag-extraction-phase3-v1.0.0
npm run build
npm run deploy

# Database rollback (if needed)
DROP TABLE formula_audit_log;
DROP TABLE formula_cache;
```

**Testing**:
- Unit tests for formula validation, chart generation, code execution
- Property tests for formula safety, result bounds, cache consistency
- Integration tests for end-to-end dynamic calculation queries
- Security tests for code interpreter sandboxing

**Risk Level**: HIGH
- Most complex phase
- Introduces code execution (security risk)
- Formula validation critical for correctness
- Can be disabled via feature flags
- Rollback to Phase 3 is clean

---

## Git Tagging Strategy

### Baseline Tag
```bash
git tag -a rag-extraction-baseline -m "Baseline before RAG extraction enhancement"
git push origin rag-extraction-baseline
```

### Phase Tags
```bash
# Phase 1
git tag -a rag-extraction-phase1-v1.0.0 -m "Phase 1: Core subsection extraction and storage"
git push origin rag-extraction-phase1-v1.0.0

# Phase 2
git tag -a rag-extraction-phase2-v1.0.0 -m "Phase 2: Intent detection and subsection-aware retrieval"
git push origin rag-extraction-phase2-v1.0.0

# Phase 3
git tag -a rag-extraction-phase3-v1.0.0 -m "Phase 3: Advanced retrieval techniques"
git push origin rag-extraction-phase3-v1.0.0

# Phase 4
git tag -a rag-extraction-phase4-v1.0.0 -m "Phase 4: Dynamic calculations and multi-modal responses"
git push origin rag-extraction-phase4-v1.0.0
```

### Hotfix Tags
```bash
# If hotfix needed for Phase 2
git tag -a rag-extraction-phase2-v1.0.1 -m "Phase 2 hotfix: Fix multi-ticker isolation bug"
git push origin rag-extraction-phase2-v1.0.1
```

## CHANGELOG Management

### CHANGELOG Format

```markdown
# CHANGELOG - RAG Competitive Intelligence Extraction

## [Phase 4 - v1.0.0] - 2026-02-XX

### Added
- Dynamic Calculator Service for custom metric calculations
- Formula Cache for validated formulas
- Chart Generator Service for visualizations
- Code Interpreter Service for complex calculations
- Multi-modal response generation

### Changed
- Response format now includes charts and code
- RAG Service orchestrates dynamic calculations

### Security
- Sandboxed Python execution environment
- Formula validation against whitelist

### Rollback
- Feature flags: FEATURE_DYNAMIC_CALCULATIONS, FEATURE_CHART_GENERATION, FEATURE_CODE_INTERPRETER
- Git tag: rag-extraction-phase3-v1.0.0

---

## [Phase 3 - v1.0.0] - 2026-02-XX

### Added
- Reranker Service using Mistral via Bedrock
- Advanced Retrieval Service with HyDE, query decomposition, contextual expansion
- Iterative retrieval for low-confidence results

### Changed
- Semantic Retriever now uses reranking by default
- Retrieval pipeline includes contextual expansion

### Performance
- Reranking improves top-3 relevance by 10%
- Latency p95 remains < 5 seconds

### Rollback
- Feature flags: FEATURE_RERANKING, FEATURE_HYDE, FEATURE_CONTEXTUAL_EXPANSION
- Git tag: rag-extraction-phase2-v1.0.0

---

## [Phase 2 - v1.0.0] - 2026-02-XX

### Added
- Intent Detector enhancements for competitive intelligence, MD&A, footnote intents
- Subsection-aware retrieval in Semantic Retriever
- Response Generator Service for structured extraction
- Multi-ticker isolation validation

### Changed
- Intent Detector now identifies target subsections
- Semantic Retriever filters by subsection_name
- RAG Service uses Response Generator for structured insights

### Fixed
- Multi-ticker queries now maintain strict separation

### Rollback
- Feature flags: FEATURE_SUBSECTION_FILTERING, FEATURE_STRUCTURED_EXTRACTION
- Git tag: rag-extraction-phase1-v1.0.0

---

## [Phase 1 - v1.0.0] - 2026-02-XX

### Added
- Subsection identification in Python Section Parser
- subsection_name column to narrative_chunks table
- Index on (ticker, section_type, subsection_name)
- Subsection metadata export to Bedrock KB

### Changed
- Section Parser now identifies subsections for all major sections
- Chunk creation includes subsection_name metadata

### Database
- ALTER TABLE narrative_chunks ADD COLUMN subsection_name TEXT NULL
- CREATE INDEX idx_narrative_chunks_subsection

### Rollback
- SQL: ALTER TABLE narrative_chunks DROP COLUMN subsection_name
- Git tag: rag-extraction-baseline

---

## [Baseline] - 2026-02-XX

### Baseline State
- Section Parser extracts major sections only
- Retrieval filters by section_type only
- No structured extraction
- No subsection awareness
```

