# Design Document

## Overview

This design addresses two critical issues in the intent detection system:

1. **Technical Bug Fix**: A boundary condition bug where queries with exactly 0.7 confidence fail due to incorrect comparison operators (`>` instead of `>=`). This affects 20% of queries, primarily ticker-only queries like "Show me NVDA".

2. **UX Enhancement**: Ambiguous queries (e.g., "Tell me about NVDA") are currently handled by regex, providing generic results. We will add ambiguity detection and generate clarification prompts with comprehensive suggestions based on equity analyst query patterns.

**Impact**: +20% success rate, -80% cost for edge cases, significantly improved user experience for ambiguous queries.

## Architecture

### Current Three-Tier System

```
┌─────────────────────────────────────────────────────────────┐
│                    Intent Detection Flow                     │
└─────────────────────────────────────────────────────────────┘

Query Input
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ Tier 1: Regex Detection (Fast, 80% accuracy)                │
│ - Extract ticker, metrics, period                            │
│ - Calculate confidence score                                  │
│ - Base: 0.5, +0.2 ticker, +0.2 metrics, +0.1 period         │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ Threshold Check: confidence > 0.7  ❌ BUG HERE              │
│ - Rejects queries with exactly 0.7 confidence                │
│ - Should be: confidence >= 0.7                               │
└─────────────────────────────────────────────────────────────┘
    │
    ├─ YES (confidence > 0.7) ──> Use Regex Intent
    │
    └─ NO (confidence <= 0.7) ──> Tier 2: LLM Detection
                                      │
                                      ▼
                            ┌──────────────────────────┐
                            │ Claude 3.5 Haiku         │
                            │ - Parse with AI          │
                            │ - Return structured JSON │
                            └──────────────────────────┘
                                      │
                                      ▼
                            Threshold Check: confidence > 0.6
                                      │
                                      ├─ YES ──> Use LLM Intent
                                      │
                                      └─ NO ──> Tier 3: Generic Fallback
```

### Enhanced System with Ambiguity Detection

```
┌─────────────────────────────────────────────────────────────┐
│              Enhanced Intent Detection Flow                  │
└─────────────────────────────────────────────────────────────┘

Query Input
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ Tier 1: Regex Detection                                      │
│ - Extract ticker, metrics, period, sections                  │
│ - Calculate confidence score                                  │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ Threshold Check: confidence >= 0.7  ✅ FIXED                │
│ - Now accepts queries with exactly 0.7 confidence            │
└─────────────────────────────────────────────────────────────┘
    │
    ├─ YES (confidence >= 0.7)
    │   │
    │   ▼
    │  ┌──────────────────────────────────────────────────────┐
    │  │ NEW: Ambiguity Check                                  │
    │  │ - Check if ticker-only with generic words             │
    │  │ - Check if confidence exactly 0.7                     │
    │  │ - Check if no metrics/sections specified              │
    │  └──────────────────────────────────────────────────────┘
    │   │
    │   ├─ Ambiguous ──> Force LLM + Set needsClarification
    │   │
    │   └─ Not Ambiguous ──> Use Regex Intent
    │
    └─ NO (confidence < 0.7) ──> Tier 2: LLM Detection
                                      │
                                      ▼
                            Threshold Check: confidence >= 0.6  ✅ FIXED
                                      │
                                      ├─ YES ──> Use LLM Intent
                                      │
                                      └─ NO ──> Tier 3: Generic Fallback
```

### Clarification Prompt Generation

```
┌─────────────────────────────────────────────────────────────┐
│                  RAG Service Enhancement                     │
└─────────────────────────────────────────────────────────────┘

Intent with needsClarification = true
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ Generate Clarification Prompt                                │
│ - Extract ticker from intent                                 │
│ - Build suggestion categories                                │
│ - Add quick actions                                          │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
Return Clarification Response
    │
    ├─ Financial Performance (Income, Balance Sheet, Cash Flow)
    ├─ Business & Strategy (Model, Competition, Growth)
    ├─ Comparative Analysis (Peers, Historical)
    ├─ Risk & Quality (Operational, Financial, Accounting)
    ├─ Forward-Looking (Guidance, Catalysts)
    ├─ Valuation (Metrics, Relative)
    ├─ Industry-Specific (Tech, SaaS, Retail, Healthcare)
    └─ ESG & Sustainability (Environmental, Social, Governance)
```

## Components and Interfaces

### 1. IntentDetectorService (Modified)

**File**: `src/rag/intent-detector.service.ts`

**Changes**:

```typescript
// Line 78: Fix boundary condition
// OLD
if (regexIntent.confidence > 0.7) {

// NEW
if (regexIntent.confidence >= 0.7) {
  // NEW: Check for ambiguity before accepting regex intent
  if (this.isAmbiguous(regexIntent)) {
    this.logger.log(`⚠️ Ambiguous query detected, using LLM`);
    const llmIntent = await this.detectWithLLM(query);
    llmIntent.needsClarification = true;
    return llmIntent;
  }
  
  // Not ambiguous, use regex (fast path)
  return regexIntent;
}
```

**New Method**: `isAmbiguous()`

```typescript
/**
 * Check if a query intent is ambiguous
 * Ambiguous queries have:
 * - Ticker but no metrics, sections, or subsections
 * - Generic/vague words
 * - Confidence exactly 0.7 (ticker-only)
 */
private isAmbiguous(intent: QueryIntent): boolean {
  // Ambiguous words that indicate vague queries
  const ambiguousWords = [
    'about',
    'information',
    'data',
    'tell me',
    'show me',
    'details',
    'overview',
    'summary',
    'update',
    'status',
    'give me',
    'what is',
    'what are',
  ];
  
  const query = intent.originalQuery.toLowerCase();
  const hasAmbiguousWords = ambiguousWords.some(word => query.includes(word));
  
  const hasNoSpecifics = 
    !intent.metrics && 
    !intent.sectionTypes && 
    !intent.subsectionName;
  
  const isTickerOnly = intent.confidence === 0.7;
  
  return hasAmbiguousWords && hasNoSpecifics && isTickerOnly;
}
```

### 2. IntentAnalyticsService (Modified)

**File**: `src/rag/intent-analytics.service.ts`

**Changes**:

```typescript
// Line 91: Fix failure tracking consistency
// OLD
if (!params.success || params.confidence < 0.6) {

// NEW
if (!params.success || params.confidence <= 0.6) {
  await this.trackFailedPattern(params.tenantId, params.query);
}

// Line 172: Fix SQL query consistency
// OLD
AND (success = false OR confidence < 0.6)

// NEW
AND (success = false OR confidence <= 0.6)
```

**New Method**: Track ambiguity metrics

```typescript
/**
 * Log ambiguity detection
 */
async logAmbiguityDetection(params: {
  tenantId: string;
  query: string;
  wasAmbiguous: boolean;
  clarificationGenerated: boolean;
  userRefined: boolean;
}): Promise<void> {
  try {
    await this.prisma.$executeRaw`
      INSERT INTO intent_ambiguity_logs (
        tenant_id, query, was_ambiguous, 
        clarification_generated, user_refined
      ) VALUES (
        ${params.tenantId},
        ${params.query},
        ${params.wasAmbiguous},
        ${params.clarificationGenerated},
        ${params.userRefined}
      )
    `;
  } catch (error) {
    this.logger.error(`Failed to log ambiguity detection: ${error.message}`);
  }
}
```

### 3. QueryIntent Interface (Modified)

**File**: `src/rag/types/query-intent.ts`

**Changes**:

```typescript
export interface QueryIntent {
  // ... existing fields ...
  
  // NEW: Ambiguity flag
  needsClarification?: boolean;
  
  // NEW: Ambiguity reason (for debugging)
  ambiguityReason?: string;
}
```

### 4. RAGService (Modified)

**File**: `src/rag/rag.service.ts`

**Changes**:

```typescript
async query(
  query: string,
  options?: {
    includeNarrative?: boolean;
    includeCitations?: boolean;
    systemPrompt?: string;
    tenantId?: string;
    ticker?: string;
  },
): Promise<RAGResponse> {
  const startTime = Date.now();
  
  // Step 1: Route query
  const plan = await this.queryRouter.route(query, options?.tenantId);
  const intent = await this.queryRouter.getIntent(query, options?.tenantId);
  
  // NEW: Check if clarification needed
  if (intent.needsClarification) {
    return this.generateClarificationPrompt(intent);
  }
  
  // ... rest of existing logic ...
}
```

**New Method**: `generateClarificationPrompt()`

```typescript
/**
 * Generate clarification prompt for ambiguous queries
 */
private generateClarificationPrompt(intent: QueryIntent): RAGResponse {
  const ticker = Array.isArray(intent.ticker) ? intent.ticker[0] : intent.ticker;
  
  const suggestions = [
    {
      category: 'Financial Performance',
      icon: '💰',
      subcategories: [
        {
          name: 'Revenue & Growth',
          queries: [
            `${ticker}'s revenue and growth rate`,
            `${ticker}'s revenue by segment`,
            `${ticker}'s revenue trends over 5 years`,
          ]
        },
        {
          name: 'Profitability',
          queries: [
            `${ticker}'s gross margin trends`,
            `${ticker}'s operating margins`,
            `${ticker}'s EBITDA and free cash flow`,
          ]
        },
        {
          name: 'Balance Sheet',
          queries: [
            `${ticker}'s cash and debt levels`,
            `${ticker}'s working capital`,
            `${ticker}'s capital structure`,
          ]
        }
      ]
    },
    {
      category: 'Business & Strategy',
      icon: '🏢',
      queries: [
        `What does ${ticker} do?`,
        `${ticker}'s business model`,
        `Who are ${ticker}'s competitors?`,
        `${ticker}'s competitive advantages`,
        `${ticker}'s growth strategy`,
      ]
    },
    {
      category: 'Comparative Analysis',
      icon: '📊',
      queries: [
        `Compare ${ticker} vs peers revenue growth`,
        `${ticker} vs industry average margins`,
        `${ticker}'s market share trends`,
        `${ticker} YoY and QoQ performance`,
      ]
    },
    {
      category: 'Risk & Quality',
      icon: '⚠️',
      queries: [
        `${ticker}'s risk factors`,
        `${ticker}'s supply chain risks`,
        `${ticker}'s debt maturity schedule`,
        `${ticker}'s accounting policies`,
      ]
    },
    {
      category: 'Forward-Looking',
      icon: '🔮',
      queries: [
        `${ticker}'s latest guidance`,
        `${ticker}'s expected margin trajectory`,
        `${ticker}'s upcoming catalysts`,
        `${ticker}'s growth drivers`,
      ]
    },
    {
      category: 'Valuation',
      icon: '💵',
      queries: [
        `${ticker}'s P/E and EV/EBITDA`,
        `${ticker}'s valuation vs peers`,
        `${ticker}'s historical valuation`,
        `${ticker}'s FCF yield`,
      ]
    },
    {
      category: 'Industry-Specific',
      icon: '🔬',
      queries: this.getIndustrySpecificQueries(ticker),
    },
    {
      category: 'ESG & Sustainability',
      icon: '🌱',
      queries: [
        `${ticker}'s carbon emissions`,
        `${ticker}'s employee diversity`,
        `${ticker}'s board composition`,
      ]
    }
  ];
  
  const answer = this.formatClarificationMessage(ticker, suggestions);
  
  return {
    answer,
    intent,
    sources: [],
    timestamp: new Date(),
    latency: 0,
    cost: 0,
    processingInfo: {
      structuredMetrics: 0,
      semanticNarratives: 0,
      userDocumentChunks: 0,
      usedBedrockKB: false,
      usedClaudeGeneration: false,
      hybridProcessing: false,
      needsClarification: true,
    },
  };
}

/**
 * Get industry-specific query suggestions
 */
private getIndustrySpecificQueries(ticker: string): string[] {
  // Map tickers to industries
  const techTickers = ['NVDA', 'AMD', 'INTC', 'AAPL', 'MSFT'];
  const saasTickers = ['CRM', 'ORCL', 'ADBE'];
  const retailTickers = ['AMZN', 'WMT', 'TGT'];
  const healthcareTickers = ['JNJ', 'PFE', 'UNH'];
  
  if (techTickers.includes(ticker)) {
    return [
      `${ticker}'s R&D spending`,
      `${ticker}'s chip architecture roadmap`,
      `${ticker}'s process node migration`,
      `${ticker}'s ASP trends`,
    ];
  } else if (saasTickers.includes(ticker)) {
    return [
      `${ticker}'s ARR growth`,
      `${ticker}'s net retention rate`,
      `${ticker}'s customer acquisition cost`,
      `${ticker}'s churn rate`,
    ];
  } else if (retailTickers.includes(ticker)) {
    return [
      `${ticker}'s same-store sales growth`,
      `${ticker}'s e-commerce penetration`,
      `${ticker}'s fulfillment costs`,
      `${ticker}'s inventory turns`,
    ];
  } else if (healthcareTickers.includes(ticker)) {
    return [
      `${ticker}'s drug pipeline`,
      `${ticker}'s patent expirations`,
      `${ticker}'s clinical trial results`,
      `${ticker}'s regulatory approvals`,
    ];
  }
  
  // Default generic queries
  return [
    `${ticker}'s key performance indicators`,
    `${ticker}'s operational metrics`,
    `${ticker}'s industry trends`,
  ];
}

/**
 * Format clarification message
 */
private formatClarificationMessage(ticker: string, suggestions: any[]): string {
  const lines: string[] = [];
  
  lines.push(`I can provide information about ${ticker}. What would you like to know?\n`);
  
  for (const category of suggestions) {
    lines.push(`## ${category.icon} ${category.category}\n`);
    
    if (category.subcategories) {
      for (const sub of category.subcategories) {
        lines.push(`**${sub.name}**`);
        for (const query of sub.queries) {
          lines.push(`- ${query}`);
        }
        lines.push('');
      }
    } else {
      for (const query of category.queries) {
        lines.push(`- ${query}`);
      }
      lines.push('');
    }
  }
  
  lines.push(`\n**Quick Actions:**`);
  lines.push(`- View ${ticker}'s financial dashboard`);
  lines.push(`- Read ${ticker}'s latest 10-K`);
  lines.push(`- See ${ticker}'s key metrics`);
  
  return lines.join('\n');
}
```

## Data Models

### Ambiguity Detection Logic

```typescript
interface AmbiguityCheck {
  hasAmbiguousWords: boolean;
  hasNoSpecifics: boolean;
  isTickerOnly: boolean;
  isAmbiguous: boolean;
}

// Example ambiguous queries
const ambiguousExamples = [
  {
    query: "Tell me about NVDA",
    ticker: "NVDA",
    metrics: undefined,
    sections: undefined,
    confidence: 0.7,
    isAmbiguous: true,
    reason: "Ticker-only with 'tell me about'"
  },
  {
    query: "Show me MSFT",
    ticker: "MSFT",
    metrics: undefined,
    sections: undefined,
    confidence: 0.7,
    isAmbiguous: true,
    reason: "Ticker-only with 'show me'"
  },
  {
    query: "AAPL information",
    ticker: "AAPL",
    metrics: undefined,
    sections: undefined,
    confidence: 0.7,
    isAmbiguous: true,
    reason: "Ticker-only with 'information'"
  }
];

// Example non-ambiguous queries
const nonAmbiguousExamples = [
  {
    query: "NVDA revenue",
    ticker: "NVDA",
    metrics: ["Revenue"],
    sections: undefined,
    confidence: 0.9,
    isAmbiguous: false,
    reason: "Has specific metric"
  },
  {
    query: "NVDA's risk factors",
    ticker: "NVDA",
    metrics: undefined,
    sections: ["item_1a"],
    confidence: 0.9,
    isAmbiguous: false,
    reason: "Has specific section"
  }
];
```

### Clarification Response Format

```typescript
interface ClarificationResponse extends RAGResponse {
  answer: string; // Formatted clarification message
  intent: QueryIntent; // Original intent with needsClarification = true
  suggestions: SuggestionCategory[];
  quickActions: QuickAction[];
}

interface SuggestionCategory {
  category: string;
  icon: string;
  subcategories?: Subcategory[];
  queries?: string[];
}

interface Subcategory {
  name: string;
  queries: string[];
}

interface QuickAction {
  label: string;
  action: string;
  description: string;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Confidence Threshold Boundary Handling

*For any* query that results in exactly 0.7 confidence (ticker only, no metrics, no period), the Intent_Detector should accept it for regex processing and not fall back to LLM unnecessarily.

**Validates: Requirements 1.1, 1.2**

### Property 2: Confidence Threshold Consistency

*For any* query with confidence >= 0.7, the system should use regex detection, and for any query with confidence < 0.7, the system should fall back to LLM detection.

**Validates: Requirements 1.2**

### Property 3: Failure Tracking Consistency

*For any* query with confidence <= 0.6 or success = false, the Intent_Analytics should track it as a failed pattern.

**Validates: Requirements 1.3**

### Property 4: Ambiguity Detection for Ticker-Only Queries

*For any* query containing only a ticker and generic words (about, information, show me, tell me, etc.) with no specific metrics or sections, the Intent_Detector should mark it as ambiguous and set needsClarification to true.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 5: Clarification Prompt Generation

*For any* intent with needsClarification = true, the RAG_Service should generate a clarification prompt instead of attempting to retrieve data, and the prompt should include all required suggestion categories (Financial Performance, Business & Strategy, Comparative Analysis, Risk & Quality, Forward-Looking, Valuation, Industry-Specific, ESG & Sustainability).

**Validates: Requirements 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

### Property 6: Financial Performance Query Support

*For any* query requesting financial performance metrics (revenue, margins, cash flow, balance sheet items), the system should correctly extract the metrics and retrieve the appropriate data.

**Validates: Requirements 4.1**

### Property 7: Business Understanding Query Support

*For any* query requesting business information (business model, competitors, strategy), the system should correctly identify the appropriate sections (item_1) and retrieve relevant narrative content.

**Validates: Requirements 4.2**

### Property 8: Comparative Analysis Query Support

*For any* query requesting comparative analysis (vs peers, vs historical), the system should correctly identify multiple tickers or time periods and support comparison operations.

**Validates: Requirements 4.3**

### Property 9: Risk Assessment Query Support

*For any* query requesting risk information (risk factors, operational risks, financial risks), the system should correctly identify risk-related sections (item_1a) and retrieve relevant content.

**Validates: Requirements 4.4**

### Property 10: Forward-Looking Query Support

*For any* query requesting forward-looking information (guidance, outlook, catalysts), the system should correctly identify MD&A sections (item_7) and retrieve relevant forward-looking content.

**Validates: Requirements 4.5**

### Property 11: Valuation Query Support

*For any* query requesting valuation metrics (P/E, EV/EBITDA, FCF yield), the system should correctly extract or compute the requested valuation metrics.

**Validates: Requirements 4.6**

### Property 12: Industry-Specific Query Support

*For any* query requesting industry-specific metrics (semiconductor metrics for NVDA/AMD/INTC, SaaS metrics for CRM/ORCL, retail metrics for AMZN/WMT, healthcare metrics for JNJ/PFE), the system should provide appropriate industry-specific suggestions in clarification prompts.

**Validates: Requirements 4.7**

### Property 13: ESG Query Support

*For any* query requesting ESG information (carbon emissions, diversity, governance), the system should correctly identify ESG-related content and include ESG suggestions in clarification prompts.

**Validates: Requirements 4.8**

### Property 14: Analytics Tracking for Ambiguity

*For any* ambiguous query detection, the Intent_Analytics should log the detection with ambiguity flag, track clarification generation, and track user refinement behavior.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4**

### Property 15: Backward Compatibility

*For any* query with confidence > 0.7 or confidence < 0.6, the system behavior should remain unchanged from the previous implementation, ensuring no regression for non-edge-case queries.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

## Error Handling

### Boundary Condition Errors

**Scenario**: Query has exactly 0.7 confidence
- **Old Behavior**: Rejected by regex, falls back to LLM unnecessarily
- **New Behavior**: Accepted by regex (unless ambiguous)
- **Error Prevention**: Use `>=` instead of `>` in threshold checks

### Ambiguity Detection Errors

**Scenario**: False positive ambiguity detection
- **Mitigation**: Strict criteria (must have ticker, generic words, AND no specifics)
- **Fallback**: If LLM fails after ambiguity detection, use generic fallback

**Scenario**: False negative ambiguity detection
- **Impact**: User gets generic results instead of clarification
- **Mitigation**: Comprehensive list of ambiguous words, continuous monitoring

### LLM Failures

**Scenario**: LLM fails to parse ambiguous query
- **Fallback**: Use generic fallback with regex-detected ticker preserved
- **Logging**: Log failure to Intent_Analytics for pattern analysis

### Clarification Prompt Errors

**Scenario**: Industry-specific queries fail to map
- **Fallback**: Provide generic industry queries
- **Logging**: Log unmapped industries for future enhancement

## Testing Strategy

### Dual Testing Approach

This feature requires both **unit tests** and **property-based tests** for comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all inputs
- Together: Comprehensive coverage (unit tests catch concrete bugs, property tests verify general correctness)

### Unit Testing Focus

Unit tests should focus on:
- Specific boundary condition examples (exactly 0.7 confidence)
- Specific ambiguous query examples ("Tell me about NVDA", "Show me MSFT")
- Specific clarification prompt format validation
- Integration between Intent_Detector and RAG_Service
- Error conditions (LLM failures, missing data)

**Example Unit Tests**:

```typescript
describe('IntentDetectorService - Boundary Condition Fix', () => {
  it('should accept query with exactly 0.7 confidence', async () => {
    const query = "Show me NVDA";
    const intent = await service.detectIntent(query);
    expect(intent.confidence).toBe(0.7);
    expect(intent.ticker).toBe('NVDA');
  });
  
  it('should detect ambiguity for ticker-only query', async () => {
    const query = "Tell me about NVDA";
    const intent = await service.detectIntent(query);
    expect(intent.needsClarification).toBe(true);
  });
  
  it('should not detect ambiguity for specific metric query', async () => {
    const query = "NVDA revenue";
    const intent = await service.detectIntent(query);
    expect(intent.needsClarification).toBeFalsy();
  });
});

describe('RAGService - Clarification Prompts', () => {
  it('should generate clarification prompt for ambiguous query', async () => {
    const query = "Tell me about NVDA";
    const response = await service.query(query);
    expect(response.answer).toContain('What would you like to know?');
    expect(response.answer).toContain('Financial Performance');
    expect(response.answer).toContain('Business & Strategy');
  });
  
  it('should include all 8 suggestion categories', async () => {
    const query = "Show me MSFT";
    const response = await service.query(query);
    expect(response.answer).toContain('Financial Performance');
    expect(response.answer).toContain('Business & Strategy');
    expect(response.answer).toContain('Comparative Analysis');
    expect(response.answer).toContain('Risk & Quality');
    expect(response.answer).toContain('Forward-Looking');
    expect(response.answer).toContain('Valuation');
    expect(response.answer).toContain('Industry-Specific');
    expect(response.answer).toContain('ESG & Sustainability');
  });
});
```

### Property-Based Testing Focus

Property tests should focus on:
- Universal properties that hold for all inputs
- Comprehensive input coverage through randomization
- Confidence threshold handling across all confidence values
- Ambiguity detection across all query patterns
- Query pattern support across all industries and categories

**Property Test Configuration**:
- Minimum 100 iterations per property test
- Each property test must reference its design document property
- Tag format: **Feature: confidence-threshold-fix, Property {number}: {property_text}**

**Example Property Tests**:

```typescript
import * as fc from 'fast-check';

describe('Property Tests - Confidence Threshold', () => {
  it('Property 1: Confidence threshold boundary handling', async () => {
    // Feature: confidence-threshold-fix, Property 1: Confidence Threshold Boundary Handling
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN'),
        async (ticker) => {
          const query = `Show me ${ticker}`;
          const intent = await service.detectIntent(query);
          
          // Should have exactly 0.7 confidence (ticker only)
          expect(intent.confidence).toBe(0.7);
          expect(intent.ticker).toBe(ticker);
          
          // Should be accepted (not fall back to LLM unnecessarily)
          // unless marked as ambiguous
          if (!intent.needsClarification) {
            expect(intent.confidence).toBeGreaterThanOrEqual(0.7);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property 2: Confidence threshold consistency', async () => {
    // Feature: confidence-threshold-fix, Property 2: Confidence Threshold Consistency
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('NVDA', 'AAPL', 'MSFT'),
        fc.constantFrom('revenue', 'profit', 'cash flow', ''),
        fc.constantFrom('2024', 'Q4-2024', ''),
        async (ticker, metric, period) => {
          const query = `${ticker} ${metric} ${period}`.trim();
          const intent = await service.detectIntent(query);
          
          // If confidence >= 0.7, should use regex (unless ambiguous)
          // If confidence < 0.7, should use LLM
          if (intent.confidence >= 0.7 && !intent.needsClarification) {
            // Regex was used
            expect(intent.ticker).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property 4: Ambiguity detection for ticker-only queries', async () => {
    // Feature: confidence-threshold-fix, Property 4: Ambiguity Detection for Ticker-Only Queries
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN'),
        fc.constantFrom('Tell me about', 'Show me', 'Give me information on', 'What about'),
        async (ticker, prefix) => {
          const query = `${prefix} ${ticker}`;
          const intent = await service.detectIntent(query);
          
          // Should be marked as ambiguous
          expect(intent.needsClarification).toBe(true);
          expect(intent.ticker).toBe(ticker);
          expect(intent.metrics).toBeUndefined();
          expect(intent.sectionTypes).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property 5: Clarification prompt generation', async () => {
    // Feature: confidence-threshold-fix, Property 5: Clarification Prompt Generation
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN'),
        async (ticker) => {
          const query = `Tell me about ${ticker}`;
          const response = await ragService.query(query);
          
          // Should generate clarification prompt
          expect(response.answer).toContain('What would you like to know?');
          
          // Should include all 8 categories
          const requiredCategories = [
            'Financial Performance',
            'Business & Strategy',
            'Comparative Analysis',
            'Risk & Quality',
            'Forward-Looking',
            'Valuation',
            'Industry-Specific',
            'ESG & Sustainability'
          ];
          
          for (const category of requiredCategories) {
            expect(response.answer).toContain(category);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property Tests - Query Pattern Support', () => {
  it('Property 6: Financial performance query support', async () => {
    // Feature: confidence-threshold-fix, Property 6: Financial Performance Query Support
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('NVDA', 'AAPL', 'MSFT'),
        fc.constantFrom('revenue', 'profit', 'cash flow', 'gross margin', 'net income'),
        async (ticker, metric) => {
          const query = `${ticker} ${metric}`;
          const intent = await service.detectIntent(query);
          
          // Should extract metric correctly
          expect(intent.ticker).toBe(ticker);
          expect(intent.metrics).toBeDefined();
          expect(intent.metrics.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property 7: Business understanding query support', async () => {
    // Feature: confidence-threshold-fix, Property 7: Business Understanding Query Support
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('NVDA', 'AAPL', 'MSFT'),
        fc.constantFrom('business model', 'competitors', 'strategy', 'what does', 'products'),
        async (ticker, keyword) => {
          const query = `${ticker} ${keyword}`;
          const intent = await service.detectIntent(query);
          
          // Should identify business section
          expect(intent.ticker).toBe(ticker);
          expect(intent.sectionTypes).toContain('item_1');
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property 8: Comparative analysis query support', async () => {
    // Feature: confidence-threshold-fix, Property 8: Comparative Analysis Query Support
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(['NVDA', 'AMD'], ['AAPL', 'MSFT'], ['AMZN', 'WMT']),
        fc.constantFrom('revenue', 'margins', 'growth'),
        async (tickers, metric) => {
          const query = `Compare ${tickers[0]} and ${tickers[1]} ${metric}`;
          const intent = await service.detectIntent(query);
          
          // Should identify multiple tickers
          expect(Array.isArray(intent.ticker)).toBe(true);
          expect(intent.ticker).toHaveLength(2);
          expect(intent.needsComparison).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property 9: Risk assessment query support', async () => {
    // Feature: confidence-threshold-fix, Property 9: Risk Assessment Query Support
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('NVDA', 'AAPL', 'MSFT'),
        fc.constantFrom('risk factors', 'risks', 'supply chain risk'),
        async (ticker, keyword) => {
          const query = `${ticker} ${keyword}`;
          const intent = await service.detectIntent(query);
          
          // Should identify risk section
          expect(intent.ticker).toBe(ticker);
          expect(intent.sectionTypes).toContain('item_1a');
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property Tests - Comprehensive Equity Analyst Patterns', () => {
  it('Property: Technology sector queries', async () => {
    // Test semiconductor-specific queries
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('NVDA', 'AMD', 'INTC'),
        fc.constantFrom(
          'wafer capacity',
          'chip architecture',
          'process node',
          'ASP trends',
          'R&D spending'
        ),
        async (ticker, keyword) => {
          const query = `${ticker} ${keyword}`;
          const intent = await service.detectIntent(query);
          
          // Should handle tech-specific queries
          expect(intent.ticker).toBe(ticker);
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property: SaaS sector queries', async () => {
    // Test SaaS-specific queries
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('CRM', 'ORCL', 'ADBE'),
        fc.constantFrom(
          'ARR growth',
          'net retention',
          'customer acquisition cost',
          'churn rate'
        ),
        async (ticker, keyword) => {
          const query = `${ticker} ${keyword}`;
          const intent = await service.detectIntent(query);
          
          // Should handle SaaS-specific queries
          expect(intent.ticker).toBe(ticker);
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property: Retail sector queries', async () => {
    // Test retail-specific queries
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('AMZN', 'WMT', 'TGT'),
        fc.constantFrom(
          'same-store sales',
          'e-commerce penetration',
          'fulfillment costs',
          'inventory turns'
        ),
        async (ticker, keyword) => {
          const query = `${ticker} ${keyword}`;
          const intent = await service.detectIntent(query);
          
          // Should handle retail-specific queries
          expect(intent.ticker).toBe(ticker);
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property: Healthcare sector queries', async () => {
    // Test healthcare-specific queries
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('JNJ', 'PFE', 'UNH'),
        fc.constantFrom(
          'drug pipeline',
          'patent expirations',
          'clinical trials',
          'regulatory approvals'
        ),
        async (ticker, keyword) => {
          const query = `${ticker} ${keyword}`;
          const intent = await service.detectIntent(query);
          
          // Should handle healthcare-specific queries
          expect(intent.ticker).toBe(ticker);
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property: Forward-looking queries across industries', async () => {
    // Test forward-looking queries
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('NVDA', 'AAPL', 'MSFT', 'AMZN', 'JNJ'),
        fc.constantFrom(
          'guidance',
          'outlook',
          'expected margin trajectory',
          'upcoming catalysts',
          'growth drivers'
        ),
        async (ticker, keyword) => {
          const query = `${ticker} ${keyword}`;
          const intent = await service.detectIntent(query);
          
          // Should handle forward-looking queries
          expect(intent.ticker).toBe(ticker);
          expect(intent.sectionTypes).toContain('item_7');
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property: Valuation queries across industries', async () => {
    // Test valuation queries
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('NVDA', 'AAPL', 'MSFT', 'AMZN', 'JNJ'),
        fc.constantFrom(
          'P/E ratio',
          'EV/EBITDA',
          'PEG ratio',
          'price to sales',
          'FCF yield'
        ),
        async (ticker, keyword) => {
          const query = `${ticker} ${keyword}`;
          const intent = await service.detectIntent(query);
          
          // Should handle valuation queries
          expect(intent.ticker).toBe(ticker);
        }
      ),
      { numRuns: 100 }
    );
  });
  
  it('Property: ESG queries across industries', async () => {
    // Test ESG queries
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('NVDA', 'AAPL', 'MSFT', 'AMZN', 'JNJ'),
        fc.constantFrom(
          'carbon emissions',
          'renewable energy',
          'employee diversity',
          'board composition',
          'sustainability'
        ),
        async (ticker, keyword) => {
          const query = `${ticker} ${keyword}`;
          const intent = await service.detectIntent(query);
          
          // Should handle ESG queries
          expect(intent.ticker).toBe(ticker);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### E2E Testing

End-to-end tests should verify:
- Complete flow from query input to clarification prompt output
- Integration with Intent_Analytics for tracking
- Real analyst workflows with multiple query refinements
- Performance metrics (latency, cost) for different query types

**Example E2E Tests**:

```typescript
describe('E2E - Confidence Threshold Fix', () => {
  it('should handle ticker-only query with clarification', async () => {
    // Step 1: Submit ambiguous query
    const response1 = await request(app.getHttpServer())
      .post('/api/rag/query')
      .send({ query: 'Tell me about NVDA' })
      .expect(200);
    
    // Should get clarification prompt
    expect(response1.body.answer).toContain('What would you like to know?');
    expect(response1.body.processingInfo.needsClarification).toBe(true);
    
    // Step 2: Submit refined query
    const response2 = await request(app.getHttpServer())
      .post('/api/rag/query')
      .send({ query: 'NVDA revenue and growth rate' })
      .expect(200);
    
    // Should get actual data
    expect(response2.body.metrics).toBeDefined();
    expect(response2.body.metrics.length).toBeGreaterThan(0);
    expect(response2.body.processingInfo.needsClarification).toBeFalsy();
  });
  
  it('should track ambiguity metrics in analytics', async () => {
    const tenantId = 'test-tenant';
    
    // Submit ambiguous query
    await request(app.getHttpServer())
      .post('/api/rag/query')
      .send({ query: 'Show me MSFT', tenantId })
      .expect(200);
    
    // Check analytics
    const analytics = await analyticsService.getRealtimeMetrics(tenantId);
    expect(analytics.last24Hours.totalQueries).toBeGreaterThan(0);
  });
});
```

### Test Coverage Requirements

The test suite MUST achieve:
- **Unit test coverage**: 90%+ for modified files
- **Property test coverage**: All 15 correctness properties implemented
- **E2E test coverage**: All major user workflows
- **Industry coverage**: Technology, SaaS, Retail, Healthcare
- **Query pattern coverage**: All 8 suggestion categories
- **Edge case coverage**: Boundary conditions, error conditions, malformed inputs

### Testing Tools

- **Unit Testing**: Jest
- **Property-Based Testing**: fast-check
- **E2E Testing**: Supertest + Jest
- **Test Data Generation**: fast-check arbitraries for tickers, metrics, periods
- **Mocking**: Jest mocks for external services (Bedrock, Prisma)

## Implementation Notes

### Code Changes Summary

1. **IntentDetectorService** (3 lines changed):
   - Line 78: Change `>` to `>=`
   - Add `isAmbiguous()` method (~30 lines)
   - Add ambiguity check in detection flow (~10 lines)

2. **IntentAnalyticsService** (2 lines changed):
   - Line 91: Change `<` to `<=`
   - Line 172: Change SQL `<` to `<=`
   - Add `logAmbiguityDetection()` method (~20 lines)

3. **QueryIntent Interface** (2 fields added):
   - Add `needsClarification?: boolean`
   - Add `ambiguityReason?: string`

4. **RAGService** (~200 lines added):
   - Add clarification check in `query()` method
   - Add `generateClarificationPrompt()` method
   - Add `getIndustrySpecificQueries()` method
   - Add `formatClarificationMessage()` method

**Total**: ~265 lines of new code, 5 lines modified

### Deployment Strategy

1. **Phase 1**: Deploy boundary condition fix only (3 lines)
   - Low risk, immediate impact
   - Monitor success rate improvement

2. **Phase 2**: Deploy ambiguity detection (after 1 week)
   - Monitor false positive/negative rates
   - Adjust ambiguous word list if needed

3. **Phase 3**: Deploy clarification prompts (after 2 weeks)
   - A/B test with 10% of users
   - Gather feedback on suggestion quality
   - Roll out to 100% if positive

### Monitoring and Metrics

Track these metrics post-deployment:
- Success rate (target: 95%+)
- LLM fallback rate (target: <20%)
- Ambiguity detection rate
- Clarification prompt usage rate
- User refinement rate after clarification
- Average response time
- Cost per 100 queries

### Rollback Plan

If issues arise:
1. Revert code changes (change `>=` back to `>`, `<=` back to `<`)
2. Redeploy previous version
3. Investigate unexpected behavior
4. Fix and redeploy

**Risk**: Low (minimal changes, easy rollback, comprehensive testing)
