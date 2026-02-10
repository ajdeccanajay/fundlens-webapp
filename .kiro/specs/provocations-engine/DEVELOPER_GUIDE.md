# Provocations Engine - Developer Guide

## Architecture Overview

The Provocations Engine is a reusable Document Intelligence & Comparison Engine built with a pluggable architecture that separates document-agnostic core logic from document-specific adapters.

### Core Principles

1. **Separation of Concerns**: Core engine is document-agnostic; document-specific logic lives in adapters
2. **Pluggable Architecture**: New document types and analysis modes can be added without modifying core engine
3. **Performance-First**: Pre-computation and caching ensure instant user experience
4. **Evidence-Based**: All findings must be grounded in source documents with exact references
5. **Infrastructure Reuse**: Leverages existing FundLens components (RAG, Bedrock, S3, Redis)

### Technology Stack

- **Backend**: NestJS (TypeScript)
- **LLM Integration**: AWS Bedrock (Claude)
- **Document Storage**: AWS S3 (SEC data lake)
- **Database**: PostgreSQL with Prisma ORM
- **Semantic Similarity**: AWS Bedrock embeddings
- **Caching**: Redis
- **Frontend**: Vanilla JavaScript (workspace.html pattern)
- **Testing**: Jest, fast-check (property-based testing)

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Provocations Engine                       │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Core Engine (Document-Agnostic)              │  │
│  │                                                            │  │
│  │  • Temporal Diff Engine                                   │  │
│  │  • Semantic Similarity Engine                             │  │
│  │  • Change Detection Engine                                │  │
│  │  • Provocation Generator                                  │  │
│  │  • Severity Classifier                                    │  │
│  │  • Contradiction Detector                                 │  │
│  │  • Sentiment Analyzer                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ▲                                   │
│                              │                                   │
│  ┌──────────────────────────┴───────────────────────────────┐  │
│  │              Document Adapter Interface                   │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐            │
│         ▼                    ▼                     ▼            │
│  ┌─────────────┐   ┌──────────────────┐   ┌──────────────┐   │
│  │ SEC Filing  │   │   Transcript     │   │   Generic    │   │
│  │  Adapter    │   │    Adapter       │   │   Document   │   │
│  │   (MVP)     │   │   (Future)       │   │   Adapter    │   │
│  └─────────────┘   └──────────────────┘   └──────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Analysis Mode Framework                      │  │
│  │                                                            │  │
│  │  • Provocations Mode (MVP)                                │  │
│  │  • Sentiment Mode (MVP)                                   │  │
│  │  • Custom Modes (Extensible)                              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

### Core Tables

```sql
-- Provocations table
CREATE TABLE provocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(20) NOT NULL,
  analysis_mode VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL,
  category VARCHAR(50) NOT NULL,
  observation TEXT NOT NULL,
  filing_references JSONB NOT NULL,
  cross_filing_delta TEXT,
  implication TEXT NOT NULL,
  challenge_question TEXT NOT NULL,
  source_classifications JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX idx_provocations_ticker ON provocations(ticker);
CREATE INDEX idx_provocations_mode ON provocations(analysis_mode);
CREATE INDEX idx_provocations_severity ON provocations(severity);
CREATE INDEX idx_provocations_ticker_mode ON provocations(ticker, analysis_mode);

-- Query counter for auto-generation trigger
CREATE TABLE research_query_counter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(20) NOT NULL,
  query_count INTEGER DEFAULT 0,
  last_query_at TIMESTAMP,
  provocations_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_query_counter_ticker ON research_query_counter(ticker);
```

### Prisma Models

```typescript
model Provocation {
  id                    String    @id @default(uuid())
  ticker                String
  analysisMode          String    @map("analysis_mode")
  title                 String
  severity              String
  category              String
  observation           String
  filingReferences      Json      @map("filing_references")
  crossFilingDelta      String?   @map("cross_filing_delta")
  implication           String
  challengeQuestion     String    @map("challenge_question")
  sourceClassifications Json?     @map("source_classifications")
  createdAt             DateTime  @default(now()) @map("created_at")
  expiresAt             DateTime? @map("expires_at")

  @@index([ticker])
  @@index([analysisMode])
  @@index([severity])
  @@index([ticker, analysisMode])
  @@map("provocations")
}

model ResearchQueryCounter {
  id                     String    @id @default(uuid())
  ticker                 String    @unique
  queryCount             Int       @default(0) @map("query_count")
  lastQueryAt            DateTime? @map("last_query_at")
  provocationsGenerated  Boolean   @default(false) @map("provocations_generated")
  createdAt              DateTime  @default(now()) @map("created_at")
  updatedAt              DateTime  @updatedAt @map("updated_at")

  @@map("research_query_counter")
}
```

## API Endpoints

### Provocations Controller

```typescript
// Get available analysis modes for a ticker
GET /api/provocations/:ticker/modes
Response: {
  success: boolean;
  ticker: string;
  modes: AnalysisMode[];
}

// Switch analysis mode
POST /api/provocations/mode
Body: { mode: string }
Response: {
  success: boolean;
  mode: string;
  description: string;
  presetQuestions: PresetQuestion[];
}

// Analyze provocations for a ticker
POST /api/provocations/analyze
Body: { ticker: string; mode: string }
Response: {
  success: boolean;
  ticker: string;
  mode: string;
  provocations: Provocation[];
  count: number;
  metadata: AnalysisMetadata;
}

// Get cached provocations
GET /api/provocations/:ticker?mode=provocations
Response: {
  success: boolean;
  ticker: string;
  mode: string;
  provocations: Provocation[];
}

// Execute preset question
GET /api/provocations/:ticker/preset/:questionId?mode=provocations
Response: {
  success: boolean;
  ticker: string;
  mode: string;
  question: string;
  provocations: Provocation[];
}

// Get query count for auto-generation
GET /api/provocations/:ticker/query-count
Response: {
  success: boolean;
  ticker: string;
  queryCount: number;
  provocationsGenerated: boolean;
  lastQueryAt: Date;
}

// Get contradictions
GET /api/provocations/:ticker/contradictions
Response: {
  success: boolean;
  ticker: string;
  contradictions: Contradiction[];
}

// Get management credibility assessment
GET /api/provocations/:ticker/credibility
Response: {
  success: boolean;
  ticker: string;
  assessment: CredibilityAssessment;
}

// Get sentiment analysis
GET /api/provocations/:ticker/sentiment
Response: {
  success: boolean;
  ticker: string;
  sentiments: SentimentAnalysis[];
  deltas: SentimentDelta[];
}
```

## Core Services

### TemporalDiffEngine

**Location**: `src/deals/temporal-diff-engine.service.ts`

**Purpose**: Compares documents across time to detect changes

**Key Methods**:
```typescript
class TemporalDiffEngine {
  // Compare two documents and identify changes
  async compareDocuments(
    sourceDoc: Document,
    targetDoc: Document,
    options: DiffOptions
  ): Promise<DocumentDiff>;

  // Align sections between two document versions
  async alignSections(
    sourceSections: Section[],
    targetSections: Section[]
  ): Promise<SectionAlignment[]>;

  // Classify changes as added, removed, modified, or unchanged
  async classifyChanges(
    alignment: SectionAlignment
  ): Promise<ChangeClassification>;
}
```

**Dependencies**:
- `SemanticSimilarityEngine` for semantic matching
- `PrismaService` for data access
- `BedrockService` for LLM interpretation

### SemanticSimilarityEngine

**Location**: `src/deals/semantic-similarity-engine.service.ts`

**Purpose**: Detects conceptually related changes beyond exact text matching

**Key Methods**:
```typescript
class SemanticSimilarityEngine {
  // Calculate semantic similarity between two text segments
  async calculateSimilarity(text1: string, text2: string): Promise<number>;

  // Detect conceptually related changes
  async detectConceptualChanges(
    sourceText: string,
    targetText: string
  ): Promise<ConceptualChange>;

  // Measure qualifier language intensity
  async measureQualifierIntensity(text: string): Promise<QualifierScore>;
}
```

**Dependencies**:
- `BedrockService` for embeddings

### ProvocationGenerator

**Location**: `src/deals/provocation-generator.service.ts`

**Purpose**: Generates structured provocations from document diffs

**Key Methods**:
```typescript
class ProvocationGenerator {
  // Generate provocations from document diffs
  async generateProvocations(
    diff: DocumentDiff,
    mode: AnalysisMode
  ): Promise<Provocation[]>;

  // Classify provocation severity
  async classifySeverity(
    finding: Finding,
    context: DocumentContext
  ): Promise<SeverityLevel>;

  // Prioritize provocations by materiality
  async prioritizeProvocations(
    provocations: Provocation[]
  ): Promise<Provocation[]>;
}
```

**Dependencies**:
- `BedrockService` for interpretation
- `PrismaService` for caching

### SentimentAnalyzer

**Location**: `src/deals/sentiment-analyzer.service.ts`

**Purpose**: Analyzes management tone and confidence shifts

**Key Methods**:
```typescript
class SentimentAnalyzer {
  // Calculate sentiment score for a section
  async calculateSentiment(
    text: string,
    context: DocumentContext
  ): Promise<SentimentScore>;

  // Detect sentiment delta between filings
  async detectSentimentDelta(
    sourceText: string,
    targetText: string
  ): Promise<SentimentDelta>;

  // Track confidence language
  async trackConfidenceLanguage(text: string): Promise<ConfidenceMetrics>;

  // Detect defensive language
  async detectDefensiveLanguage(text: string): Promise<DefensiveMetrics>;
}
```

**Dependencies**:
- `BedrockService` for sentiment analysis

### ContradictionDetector

**Location**: `src/deals/contradiction-detector.service.ts`

**Purpose**: Identifies contradictions within and across documents

**Key Methods**:
```typescript
class ContradictionDetector {
  // Detect contradictions within and across documents
  async detectContradictions(
    documents: Document[]
  ): Promise<Contradiction[]>;

  // Compare forward-looking statements against results
  async compareStatementsToResults(
    priorStatements: Statement[],
    subsequentResults: FinancialData[]
  ): Promise<CredibilityAssessment>;

  // Identify segment vs consolidated narrative misalignments
  async detectNarrativeMisalignment(
    segmentData: SegmentData[],
    consolidatedNarrative: string
  ): Promise<Misalignment[]>;
}
```

**Dependencies**:
- `BedrockService` for interpretation
- `PrismaService` for data access

### ManagementCredibilityTracker

**Location**: `src/deals/management-credibility.service.ts`

**Purpose**: Tracks management guidance accuracy over time

**Key Methods**:
```typescript
class ManagementCredibilityTracker {
  // Extract forward-looking statements from MD&A
  async extractForwardLookingStatements(
    mdaText: string
  ): Promise<Statement[]>;

  // Compare statements to actual results
  async compareToResults(
    statements: Statement[],
    results: FinancialData[]
  ): Promise<ComparisonResult[]>;

  // Detect guidance walk-backs
  async detectWalkBacks(
    priorStatements: Statement[],
    currentStatements: Statement[]
  ): Promise<WalkBack[]>;

  // Calculate historical accuracy metrics
  async calculateAccuracyMetrics(
    ticker: string
  ): Promise<AccuracyMetrics>;
}
```

**Dependencies**:
- `BedrockService` for extraction
- `PrismaService` for historical data

### AnalysisModeRegistry

**Location**: `src/deals/analysis-mode-registry.service.ts`

**Purpose**: Manages analysis modes and their configurations

**Key Methods**:
```typescript
class AnalysisModeRegistry {
  // Register a new analysis mode
  registerMode(mode: AnalysisMode): void;

  // Get mode configuration
  getMode(name: string): AnalysisMode | undefined;

  // List all available modes
  listModes(): AnalysisMode[];

  // Get preset questions for a mode
  getPresetQuestions(mode: string, ticker: string): PresetQuestion[];
}
```

**Built-in Modes**:
- `provocations`: Adversarial research analysis
- `sentiment`: Management tone tracking

## Extension Points

### Adding a New Document Type

1. **Create Document Adapter**:

```typescript
// src/deals/adapters/transcript-adapter.service.ts
@Injectable()
export class TranscriptAdapter implements DocumentAdapter {
  async retrieveDocument(identifier: string): Promise<RawDocument> {
    // Implement transcript retrieval
  }

  async parseDocument(rawDoc: RawDocument): Promise<ParsedDocument> {
    // Implement transcript parsing
  }

  async extractSections(parsedDoc: ParsedDocument): Promise<Section[]> {
    // Implement section extraction
  }

  async extractMetadata(parsedDoc: ParsedDocument): Promise<DocumentMetadata> {
    // Implement metadata extraction
  }

  async normalizeSectionIdentifiers(sections: Section[]): Promise<Section[]> {
    // Implement section normalization
  }
}
```

2. **Register Adapter**:

```typescript
// In module configuration
@Module({
  providers: [
    SECFilingAdapter,
    TranscriptAdapter, // Add new adapter
    TemporalDiffEngine,
    // ...
  ],
})
export class DealsModule {}
```

3. **Use Adapter**:

```typescript
// The core engine automatically uses the appropriate adapter
const adapter = this.getAdapter(documentType);
const document = await adapter.retrieveDocument(identifier);
```

### Adding a New Analysis Mode

1. **Define Mode Configuration**:

```typescript
// src/deals/modes/commitment-tracking-mode.ts
export const commitmentTrackingMode: AnalysisMode = {
  name: 'commitment_tracking',
  description: 'Track management commitments and follow-through',
  systemPrompt: `You are analyzing management commitments...`,
  presetQuestions: [
    {
      id: 'commitment-tracking-1',
      category: 'Commitment Tracking',
      text: 'What commitments did management make in prior filings?',
      requiresData: ['10-K', '10-Q'],
    },
    // ... more questions
  ],
  processingRules: [
    {
      name: 'extract_commitments',
      condition: 'always',
      action: 'identify_commitment_language',
      priority: 1,
    },
  ],
};
```

2. **Register Mode**:

```typescript
// In service initialization
@Injectable()
export class AnalysisModeRegistry {
  constructor() {
    this.registerMode(provocationsMode);
    this.registerMode(sentimentMode);
    this.registerMode(commitmentTrackingMode); // Add new mode
  }
}
```

3. **Implement Mode-Specific Logic** (if needed):

```typescript
// In ProvocationGenerator
async generateProvocations(diff: DocumentDiff, mode: AnalysisMode): Promise<Provocation[]> {
  if (mode.name === 'commitment_tracking') {
    return this.generateCommitmentProvocations(diff);
  }
  // ... other modes
}
```

## Testing Strategy

### Unit Tests

**Location**: `test/unit/`

**Coverage**:
- Core engine components
- Document adapters
- Analysis modes
- Error handling

**Example**:
```typescript
describe('TemporalDiffEngine', () => {
  it('should align sections with identical types', () => {
    // Test specific example
  });

  it('should handle missing sections gracefully', () => {
    // Test edge case
  });
});
```

### Property-Based Tests

**Location**: `test/properties/`

**Library**: `fast-check`

**Coverage**:
- Universal correctness properties
- Randomized input testing
- 100+ iterations per property

**Example**:
```typescript
// Feature: provocations-engine, Property 7: Provocation Structure Completeness
describe('Property: Provocation Structure Completeness', () => {
  it('should have all required fields for any provocation', () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          ticker: fc.string(),
          mode: fc.constantFrom('provocations', 'sentiment'),
          // ... more fields
        }),
        async (input) => {
          const provocations = await generator.generateProvocations(input);
          
          for (const prov of provocations) {
            expect(prov).toHaveProperty('title');
            expect(prov).toHaveProperty('severity');
            expect(prov).toHaveProperty('observation');
            // ... verify all required fields
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### E2E Tests

**Location**: `test/e2e/`

**Coverage**:
- Complete user flows
- Real SEC filing data
- Performance requirements
- Error scenarios

**Files**:
- `provocations-mode.e2e-spec.ts` (21 tests)
- `sentiment-mode.e2e-spec.ts` (18 tests)
- `provocations-auto-generation.e2e-spec.ts` (17 tests)
- `provocations-precomputation.e2e-spec.ts` (18 tests)

## Performance Optimization

### Pre-Computation Strategy

1. **Trigger on Filing Ingestion**:
```typescript
// In SEC processing pipeline
async onFilingIngested(ticker: string, filing: Filing) {
  // Trigger background pre-computation
  await this.preComputationService.preComputeDiffs(filing, ticker);
}
```

2. **Cache Results**:
```typescript
// Store in database for fast retrieval
await this.prisma.provocation.createMany({
  data: provocations.map(p => ({
    ...p,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  })),
});
```

3. **Serve from Cache**:
```typescript
// Check cache first
const cached = await this.prisma.provocation.findMany({
  where: {
    ticker,
    analysisMode: mode,
    expiresAt: { gt: new Date() },
  },
});

if (cached.length > 0) {
  return cached; // Fast path
}

// Compute if not cached
return this.computeProvocations(ticker, mode);
```

### Caching Strategy

- **Cache Key**: `ticker:mode`
- **Expiration**: 7 days
- **Invalidation**: On new filing ingestion
- **Storage**: PostgreSQL (provocations table)

### Performance Targets

- Preset questions display: <500ms
- Pre-computed queries: <3 seconds
- Custom queries (streaming): <5 seconds first response
- Background processing: No impact on foreground queries

## Deployment

### Prerequisites

1. **Database Migrations**:
```bash
npm run prisma:migrate:deploy
```

2. **Environment Variables**:
```bash
# AWS Bedrock
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://...
```

3. **SEC Filing Data**:
```bash
# Ensure SEC data is ingested
npm run ingest:sec -- --tickers AAPL,MSFT,GOOGL
```

### Deployment Steps

1. **Build Application**:
```bash
npm run build
```

2. **Run Migrations**:
```bash
npm run prisma:migrate:deploy
```

3. **Start Application**:
```bash
npm run start:prod
```

4. **Verify Health**:
```bash
curl http://localhost:3000/health
```

### Monitoring

**Key Metrics**:
- Provocation generation time
- Cache hit rate
- Query counter accuracy
- Error rates by endpoint
- LLM API latency

**Alerts**:
- Error rate > 10/minute
- LLM error rate > 20%
- Cache unavailable > 5 minutes
- Parsing error rate > 30%

## Troubleshooting

### Common Issues

**Issue**: "No provocations found"
**Cause**: Insufficient filing data
**Solution**: Ensure at least 2 filings are ingested for the ticker

**Issue**: Slow response times
**Cause**: Cache miss or first-time computation
**Solution**: Pre-compute provocations for frequently accessed tickers

**Issue**: "Unknown mode" error
**Cause**: Mode not registered
**Solution**: Verify mode is registered in `AnalysisModeRegistry`

**Issue**: Parsing errors
**Cause**: Malformed SEC filing HTML
**Solution**: Implement fallback parsing strategies

### Debug Mode

Enable debug logging:
```typescript
// In service
this.logger.debug('Generating provocations', { ticker, mode, diffCount });
```

View logs:
```bash
# Development
npm run start:dev

# Production
tail -f logs/app.log | grep provocations
```

## Contributing

### Code Style

- Follow NestJS conventions
- Use TypeScript strict mode
- Write comprehensive tests (unit + property + E2E)
- Document all public APIs

### Pull Request Process

1. Create feature branch
2. Implement changes with tests
3. Run full test suite: `npm test`
4. Run E2E tests: `npm run test:e2e`
5. Update documentation
6. Submit PR with description

### Testing Requirements

- Unit test coverage: >80%
- All property tests passing (100 iterations)
- All E2E tests passing
- No TypeScript errors
- No linting errors

## Resources

- **Requirements**: `.kiro/specs/provocations-engine/requirements.md`
- **Design**: `.kiro/specs/provocations-engine/design.md`
- **Tasks**: `.kiro/specs/provocations-engine/tasks.md`
- **User Guide**: `.kiro/specs/provocations-engine/USER_GUIDE.md`
- **API Reference**: [Link to API docs]
- **Architecture Diagrams**: [Link to diagrams]

## Support

For developer questions:
- Slack: #provocations-engine
- Email: dev@fundlens.com
- Documentation: [Link to full docs]
