# Design Document: Provocations Engine

## Overview

The Provocations Engine is a reusable Document Intelligence & Comparison Engine architected for extensibility and modularity. The system performs temporal analysis, semantic similarity detection, and change tracking across document series. The MVP implementation focuses on SEC filings analysis with an adversarial research mode, but the core architecture supports any temporal document series.

### Design Philosophy

1. **Separation of Concerns**: Core engine is document-agnostic; document-specific logic lives in adapters
2. **Pluggable Architecture**: New document types and analysis modes can be added without modifying core engine
3. **Performance-First**: Pre-computation and caching ensure instant user experience
4. **Evidence-Based**: All findings must be grounded in source documents with exact references
5. **Hybrid UX**: Low-friction toggle in Research Assistant + dedicated Provocations tab for comprehensive analysis

### Key Architectural Decisions

- **Multi-step diff processing**: Prevents LLM hallucination by separating extraction, alignment, diff, and interpretation
- **Temporal indexing**: Section-level chunking enables precise cross-filing comparison
- **Semantic similarity**: Goes beyond text diff to detect conceptually related changes
- **Severity classification**: Consistent framework for prioritizing findings
- **Streaming responses**: Initial findings appear within 5 seconds for custom queries

## Architecture

### System Components

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
│  │  • Sentiment Mode (Future)                                │  │
│  │  • Commitment Tracking Mode (Future)                      │  │
│  │  • Custom Modes (Configurable)                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Research       │  │  Provocations   │  │   Scratchpad    │
│  Assistant      │  │      Tab        │  │   Integration   │
│  (workspace.    │  │  (workspace.    │  │                 │
│   html)         │  │   html)         │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Data Flow


```
1. Document Ingestion Flow:
   EDGAR → SEC Filing Adapter → Document Parser → Temporal Index

2. Pre-Computation Flow (Background):
   Temporal Index → Diff Engine → Semantic Similarity → Provocation Generator → Cache

3. User Query Flow (Foreground):
   Research Assistant → Analysis Mode Router → Cached Results / Live Analysis → Formatted Response

4. Auto-Generation Flow:
   Query Counter → Threshold Check → Provocation Generator → Provocations Tab Update
```

### Technology Stack

- **Backend**: NestJS (TypeScript)
- **LLM Integration**: AWS Bedrock (Claude)
- **Document Storage**: AWS S3 (existing SEC data lake)
- **Temporal Index**: PostgreSQL with JSONB for section-level storage
- **Semantic Similarity**: AWS Bedrock embeddings + vector similarity
- **Caching**: Redis for pre-computed provocations
- **Frontend**: Vanilla JavaScript (existing workspace.html pattern)

## Components and Interfaces

### 1. Core Engine Components

#### TemporalDiffEngine

```typescript
interface TemporalDiffEngine {
  /**
   * Compare two documents and identify changes
   */
  compareDocuments(
    sourceDoc: Document,
    targetDoc: Document,
    options: DiffOptions
  ): Promise<DocumentDiff>;

  /**
   * Align sections between two document versions
   */
  alignSections(
    sourceSections: Section[],
    targetSections: Section[]
  ): Promise<SectionAlignment[]>;

  /**
   * Classify changes as added, removed, modified, or unchanged
   */
  classifyChanges(
    alignment: SectionAlignment
  ): Promise<ChangeClassification>;
}

interface DocumentDiff {
  sourceDocument: DocumentMetadata;
  targetDocument: DocumentMetadata;
  sectionDiffs: SectionDiff[];
  summary: DiffSummary;
}

interface SectionDiff {
  sectionType: string;
  changeType: 'added' | 'removed' | 'modified' | 'unchanged';
  sourceContent?: string;
  targetContent?: string;
  specificChanges: Change[];
}

interface Change {
  type: 'paragraph_added' | 'paragraph_removed' | 'paragraph_modified' | 'language_shift';
  location: string;
  sourceText?: string;
  targetText?: string;
  semanticSimilarity?: number;
}
```

#### SemanticSimilarityEngine

```typescript
interface SemanticSimilarityEngine {
  /**
   * Calculate semantic similarity between two text segments
   */
  calculateSimilarity(text1: string, text2: string): Promise<number>;

  /**
   * Detect conceptually related changes beyond exact text matching
   */
  detectConceptualChanges(
    sourceText: string,
    targetText: string
  ): Promise<ConceptualChange>;

  /**
   * Measure qualifier language intensity
   */
  measureQualifierIntensity(text: string): Promise<QualifierScore>;
}

interface ConceptualChange {
  isConceptuallyDifferent: boolean;
  similarityScore: number;
  keyConceptsAdded: string[];
  keyConceptsRemoved: string[];
  toneShift?: 'more_confident' | 'less_confident' | 'neutral';
}

interface QualifierScore {
  intensityLevel: number; // 0-10 scale
  qualifiers: string[];
  confidenceIndicators: string[];
}
```


#### ProvocationGenerator

```typescript
interface ProvocationGenerator {
  /**
   * Generate provocations from document diffs
   */
  generateProvocations(
    diff: DocumentDiff,
    mode: AnalysisMode
  ): Promise<Provocation[]>;

  /**
   * Classify provocation severity
   */
  classifySeverity(
    finding: Finding,
    context: DocumentContext
  ): Promise<SeverityLevel>;

  /**
   * Prioritize provocations by materiality
   */
  prioritizeProvocations(
    provocations: Provocation[]
  ): Promise<Provocation[]>;
}

interface Provocation {
  id: string;
  title: string;
  severity: SeverityLevel;
  observation: string;
  filingReferences: FilingReference[];
  crossFilingDelta?: string;
  implication: string;
  challengeQuestion: string;
  category: ProvocationCategory;
  createdAt: Date;
}

type SeverityLevel = 'RED_FLAG' | 'AMBER' | 'GREEN_CHALLENGE';

type ProvocationCategory =
  | 'management_credibility'
  | 'risk_escalation'
  | 'accounting_red_flags'
  | 'competitive_moat'
  | 'capital_allocation'
  | 'guidance_reliability'
  | 'related_party';

interface FilingReference {
  filingType: string;
  filingDate: Date;
  section: string;
  pageNumber?: number;
  excerpt: string;
  url?: string;
}
```

#### ContradictionDetector

```typescript
interface ContradictionDetector {
  /**
   * Detect contradictions within and across documents
   */
  detectContradictions(
    documents: Document[]
  ): Promise<Contradiction[]>;

  /**
   * Compare forward-looking statements against results
   */
  compareStatementsToResults(
    priorStatements: Statement[],
    subsequentResults: FinancialData[]
  ): Promise<CredibilityAssessment>;

  /**
   * Identify segment vs consolidated narrative misalignments
   */
  detectNarrativeMisalignment(
    segmentData: SegmentData[],
    consolidatedNarrative: string
  ): Promise<Misalignment[]>;
}

interface Contradiction {
  type: 'statement_vs_results' | 'segment_vs_consolidated' | 'capex_vs_strategy' | 'cross_filing';
  severity: SeverityLevel;
  description: string;
  evidence: Evidence[];
}

interface Evidence {
  source: FilingReference;
  text: string;
  context: string;
}
```

### 2. Document Adapter Interface

```typescript
interface DocumentAdapter {
  /**
   * Retrieve document from source
   */
  retrieveDocument(identifier: string): Promise<RawDocument>;

  /**
   * Parse document into structured format
   */
  parseDocument(rawDoc: RawDocument): Promise<ParsedDocument>;

  /**
   * Extract sections from document
   */
  extractSections(parsedDoc: ParsedDocument): Promise<Section[]>;

  /**
   * Extract metadata
   */
  extractMetadata(parsedDoc: ParsedDocument): Promise<DocumentMetadata>;

  /**
   * Normalize section identifiers across document versions
   */
  normalizeSectionIdentifiers(sections: Section[]): Promise<Section[]>;
}

interface ParsedDocument {
  id: string;
  type: string;
  metadata: DocumentMetadata;
  sections: Section[];
  rawContent: string;
}

interface Section {
  id: string;
  type: string;
  title: string;
  content: string;
  subsections?: Section[];
  metadata: SectionMetadata;
}

interface DocumentMetadata {
  documentId: string;
  documentType: string;
  companyIdentifier: string;
  filingDate: Date;
  periodEndDate?: Date;
  format: string;
  sourceUrl?: string;
}
```


### 3. SEC Filing Adapter (MVP Implementation)

```typescript
class SECFilingAdapter implements DocumentAdapter {
  constructor(
    private edgarService: EDGARService,
    private parserService: SECParserService
  ) {}

  async retrieveDocument(cik: string, filingType: string, filingDate: Date): Promise<RawDocument> {
    // Retrieve from existing S3 data lake or EDGAR API
    const filingUrl = await this.edgarService.getFilingUrl(cik, filingType, filingDate);
    const content = await this.edgarService.fetchFiling(filingUrl);
    
    return {
      id: `${cik}-${filingType}-${filingDate.toISOString()}`,
      content,
      format: this.detectFormat(content),
      sourceUrl: filingUrl
    };
  }

  async parseDocument(rawDoc: RawDocument): Promise<ParsedDocument> {
    // Handle both HTML and XBRL formats
    if (rawDoc.format === 'XBRL') {
      return this.parserService.parseXBRL(rawDoc.content);
    } else {
      return this.parserService.parseHTML(rawDoc.content);
    }
  }

  async extractSections(parsedDoc: ParsedDocument): Promise<Section[]> {
    // Extract standard SEC filing sections
    const sectionExtractors = {
      '10-K': this.extract10KSections,
      '10-Q': this.extract10QSections,
      '8-K': this.extract8KSections
    };
    
    const extractor = sectionExtractors[parsedDoc.metadata.documentType];
    return extractor(parsedDoc);
  }

  private extract10KSections(doc: ParsedDocument): Section[] {
    return [
      this.extractSection(doc, 'Item 1', 'Business'),
      this.extractSection(doc, 'Item 1A', 'Risk Factors'),
      this.extractSection(doc, 'Item 7', 'MD&A'),
      this.extractSection(doc, 'Item 8', 'Financial Statements'),
      this.extractSection(doc, 'Item 15', 'Exhibits and Financial Statement Schedules'),
      // ... other sections
    ];
  }

  async normalizeSectionIdentifiers(sections: Section[]): Promise<Section[]> {
    // Map various section naming conventions to standard identifiers
    const normalizationMap = {
      'Risk Factors': ['Item 1A', 'ITEM 1A', 'Item 1A.', 'Risk Factors'],
      'MD&A': ['Item 7', 'ITEM 7', "Management's Discussion", 'MD&A'],
      // ... other mappings
    };
    
    return sections.map(section => ({
      ...section,
      type: this.normalizeType(section.type, normalizationMap)
    }));
  }
}
```

### 4. Analysis Mode Framework

```typescript
interface AnalysisMode {
  name: string;
  description: string;
  systemPrompt: string;
  presetQuestions: PresetQuestion[];
  processingRules: ProcessingRule[];
}

interface PresetQuestion {
  id: string;
  category: string;
  text: string;
  requiresData: string[]; // e.g., ['10-K', '10-Q']
}

interface ProcessingRule {
  name: string;
  condition: string;
  action: string;
  priority: number;
}

class AnalysisModeRegistry {
  private modes: Map<string, AnalysisMode> = new Map();

  registerMode(mode: AnalysisMode): void {
    this.modes.set(mode.name, mode);
  }

  getMode(name: string): AnalysisMode | undefined {
    return this.modes.get(name);
  }

  listModes(): AnalysisMode[] {
    return Array.from(this.modes.values());
  }
}

// Provocations Mode (MVP)
const provocationsMode: AnalysisMode = {
  name: 'provocations',
  description: 'Adversarial research analysis that stress-tests investment theses',
  systemPrompt: `You are the FundLens Provocations Engine — a senior adversarial research analyst...`,
  presetQuestions: [
    {
      id: 'risk-factors-delta',
      category: 'Cross-Filing Language Analysis',
      text: 'What risk factors were added, removed, or materially changed between the last two 10-Ks?',
      requiresData: ['10-K']
    },
    {
      id: 'mda-tone-shift',
      category: 'Cross-Filing Language Analysis',
      text: "How has management's tone in the MD&A section shifted over the last 4 quarters?",
      requiresData: ['10-Q', '10-K']
    },
    // ... more preset questions
  ],
  processingRules: [
    {
      name: 'prioritize_red_flags',
      condition: 'severity === RED_FLAG',
      action: 'place_first',
      priority: 1
    },
    {
      name: 'require_filing_reference',
      condition: 'always',
      action: 'validate_reference_exists',
      priority: 10
    }
  ]
};
```


### 5. Temporal Index Service

```typescript
interface TemporalIndexService {
  /**
   * Store document with temporal metadata
   */
  indexDocument(
    document: ParsedDocument,
    sections: Section[]
  ): Promise<void>;

  /**
   * Retrieve documents for a company within a time range
   */
  getDocuments(
    companyId: string,
    startDate: Date,
    endDate: Date,
    documentTypes?: string[]
  ): Promise<ParsedDocument[]>;

  /**
   * Get specific section across multiple document versions
   */
  getSectionHistory(
    companyId: string,
    sectionType: string,
    startDate: Date,
    endDate: Date
  ): Promise<SectionVersion[]>;

  /**
   * Query for documents with specific characteristics
   */
  queryDocuments(query: DocumentQuery): Promise<ParsedDocument[]>;
}

interface SectionVersion {
  documentId: string;
  filingDate: Date;
  sectionType: string;
  content: string;
  metadata: SectionMetadata;
}

interface DocumentQuery {
  companyId?: string;
  documentTypes?: string[];
  dateRange?: { start: Date; end: Date };
  sectionTypes?: string[];
  hasChanges?: boolean;
}

// PostgreSQL Schema
/*
CREATE TABLE documents (
  id UUID PRIMARY KEY,
  company_id VARCHAR(20) NOT NULL,
  document_type VARCHAR(10) NOT NULL,
  filing_date TIMESTAMP NOT NULL,
  period_end_date TIMESTAMP,
  metadata JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_company_date (company_id, filing_date),
  INDEX idx_document_type (document_type)
);

CREATE TABLE document_sections (
  id UUID PRIMARY KEY,
  document_id UUID REFERENCES documents(id),
  section_type VARCHAR(50) NOT NULL,
  section_title TEXT,
  content TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_document_section (document_id, section_type),
  INDEX idx_content_hash (content_hash)
);

CREATE TABLE section_diffs (
  id UUID PRIMARY KEY,
  source_section_id UUID REFERENCES document_sections(id),
  target_section_id UUID REFERENCES document_sections(id),
  diff_data JSONB NOT NULL,
  computed_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_section_pair (source_section_id, target_section_id)
);

CREATE TABLE provocations_cache (
  id UUID PRIMARY KEY,
  company_id VARCHAR(20) NOT NULL,
  analysis_mode VARCHAR(50) NOT NULL,
  provocations JSONB NOT NULL,
  source_documents UUID[] NOT NULL,
  computed_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  INDEX idx_company_mode (company_id, analysis_mode)
);
*/
```

### 6. Pre-Computation Service

```typescript
interface PreComputationService {
  /**
   * Pre-compute diffs when new filing is ingested
   */
  preComputeDiffs(
    newDocument: ParsedDocument,
    companyId: string
  ): Promise<void>;

  /**
   * Pre-generate provocations for frequently accessed tickers
   */
  preGenerateProvocations(
    companyId: string,
    mode: AnalysisMode
  ): Promise<Provocation[]>;

  /**
   * Schedule background pre-computation jobs
   */
  schedulePreComputation(
    companyIds: string[],
    priority: 'high' | 'normal' | 'low'
  ): Promise<void>;

  /**
   * Check if pre-computed results are available
   */
  hasPreComputedResults(
    companyId: string,
    mode: string
  ): Promise<boolean>;
}

class PreComputationServiceImpl implements PreComputationService {
  async preComputeDiffs(newDocument: ParsedDocument, companyId: string): Promise<void> {
    // Get the 2-3 most recent prior filings
    const priorDocs = await this.temporalIndex.getDocuments(
      companyId,
      new Date(Date.now() - 365 * 3 * 24 * 60 * 60 * 1000), // 3 years back
      newDocument.metadata.filingDate,
      [newDocument.metadata.documentType]
    );

    // Take the 2 most recent
    const recentPriors = priorDocs.slice(-2);

    // Compute diffs between new document and each prior
    for (const priorDoc of recentPriors) {
      const diff = await this.diffEngine.compareDocuments(priorDoc, newDocument, {
        includeSemanticSimilarity: true,
        detectConceptualChanges: true
      });

      // Store diff in database
      await this.storeDiff(diff);
    }
  }

  async preGenerateProvocations(companyId: string, mode: AnalysisMode): Promise<Provocation[]> {
    // Check if already cached
    const cached = await this.cache.get(`provocations:${companyId}:${mode.name}`);
    if (cached && !this.isExpired(cached)) {
      return cached.provocations;
    }

    // Get recent documents
    const documents = await this.temporalIndex.getDocuments(
      companyId,
      new Date(Date.now() - 365 * 2 * 24 * 60 * 60 * 1000), // 2 years
      new Date()
    );

    // Get pre-computed diffs
    const diffs = await this.getPreComputedDiffs(documents);

    // Generate provocations
    const provocations = await this.provocationGenerator.generateProvocations(diffs, mode);

    // Cache results
    await this.cache.set(`provocations:${companyId}:${mode.name}`, {
      provocations,
      computedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });

    return provocations;
  }
}
```


### 7. Multi-Step Diff Processing Pipeline

```typescript
interface DiffPipeline {
  /**
   * Execute the complete diff pipeline
   */
  executePipeline(
    sourceDoc: ParsedDocument,
    targetDoc: ParsedDocument
  ): Promise<PipelineResult>;
}

class DiffPipelineImpl implements DiffPipeline {
  async executePipeline(sourceDoc: ParsedDocument, targetDoc: ParsedDocument): Promise<PipelineResult> {
    // Step 1: Extract sections
    const sourceSections = await this.extractRelevantSections(sourceDoc);
    const targetSections = await this.extractRelevantSections(targetDoc);

    // Step 2: Align sections
    const alignments = await this.alignSections(sourceSections, targetSections);

    // Step 3: Classify changes
    const classifications = await this.classifyChanges(alignments);

    // Step 4: Interpret material changes
    const interpretations = await this.interpretChanges(classifications);

    return {
      sourceDocument: sourceDoc.metadata,
      targetDocument: targetDoc.metadata,
      alignments,
      classifications,
      interpretations,
      summary: this.generateSummary(interpretations)
    };
  }

  private async extractRelevantSections(doc: ParsedDocument): Promise<Section[]> {
    // Extract sections relevant for comparison
    const relevantTypes = [
      'Risk Factors',
      'MD&A',
      'Accounting Policies',
      'Commitments and Contingencies'
    ];

    return doc.sections.filter(s => relevantTypes.includes(s.type));
  }

  private async alignSections(
    sourceSections: Section[],
    targetSections: Section[]
  ): Promise<SectionAlignment[]> {
    const alignments: SectionAlignment[] = [];

    for (const sourceSection of sourceSections) {
      // Find corresponding section in target
      const targetSection = targetSections.find(t => t.type === sourceSection.type);

      if (targetSection) {
        // Both exist - align paragraphs
        const paragraphAlignments = await this.alignParagraphs(
          sourceSection.content,
          targetSection.content
        );

        alignments.push({
          sectionType: sourceSection.type,
          sourceSection,
          targetSection,
          paragraphAlignments,
          alignmentType: 'matched'
        });
      } else {
        // Section removed in target
        alignments.push({
          sectionType: sourceSection.type,
          sourceSection,
          targetSection: null,
          paragraphAlignments: [],
          alignmentType: 'removed'
        });
      }
    }

    // Check for sections added in target
    for (const targetSection of targetSections) {
      const sourceSection = sourceSections.find(s => s.type === targetSection.type);
      if (!sourceSection) {
        alignments.push({
          sectionType: targetSection.type,
          sourceSection: null,
          targetSection,
          paragraphAlignments: [],
          alignmentType: 'added'
        });
      }
    }

    return alignments;
  }

  private async alignParagraphs(
    sourceContent: string,
    targetContent: string
  ): Promise<ParagraphAlignment[]> {
    // Split into paragraphs
    const sourceParagraphs = this.splitIntoParagraphs(sourceContent);
    const targetParagraphs = this.splitIntoParagraphs(targetContent);

    // Use semantic similarity to align paragraphs
    const alignments: ParagraphAlignment[] = [];

    for (let i = 0; i < sourceParagraphs.length; i++) {
      const sourcePara = sourceParagraphs[i];
      let bestMatch: { index: number; similarity: number } | null = null;

      for (let j = 0; j < targetParagraphs.length; j++) {
        const targetPara = targetParagraphs[j];
        const similarity = await this.semanticSimilarity.calculateSimilarity(
          sourcePara,
          targetPara
        );

        if (similarity > 0.7 && (!bestMatch || similarity > bestMatch.similarity)) {
          bestMatch = { index: j, similarity };
        }
      }

      if (bestMatch) {
        alignments.push({
          sourceIndex: i,
          targetIndex: bestMatch.index,
          sourceText: sourcePara,
          targetText: targetParagraphs[bestMatch.index],
          similarity: bestMatch.similarity
        });
      } else {
        alignments.push({
          sourceIndex: i,
          targetIndex: null,
          sourceText: sourcePara,
          targetText: null,
          similarity: 0
        });
      }
    }

    return alignments;
  }

  private async classifyChanges(alignments: SectionAlignment[]): Promise<ChangeClassification[]> {
    const classifications: ChangeClassification[] = [];

    for (const alignment of alignments) {
      if (alignment.alignmentType === 'added') {
        classifications.push({
          sectionType: alignment.sectionType,
          changeType: 'section_added',
          severity: 'AMBER',
          details: `New section added: ${alignment.sectionType}`
        });
      } else if (alignment.alignmentType === 'removed') {
        classifications.push({
          sectionType: alignment.sectionType,
          changeType: 'section_removed',
          severity: 'AMBER',
          details: `Section removed: ${alignment.sectionType}`
        });
      } else {
        // Analyze paragraph-level changes
        for (const paraAlign of alignment.paragraphAlignments) {
          if (paraAlign.targetIndex === null) {
            classifications.push({
              sectionType: alignment.sectionType,
              changeType: 'paragraph_removed',
              severity: 'GREEN_CHALLENGE',
              sourceText: paraAlign.sourceText,
              details: 'Paragraph removed from section'
            });
          } else if (paraAlign.similarity < 0.95) {
            // Material modification
            const conceptualChange = await this.semanticSimilarity.detectConceptualChanges(
              paraAlign.sourceText,
              paraAlign.targetText!
            );

            classifications.push({
              sectionType: alignment.sectionType,
              changeType: 'paragraph_modified',
              severity: this.determineSeverity(conceptualChange),
              sourceText: paraAlign.sourceText,
              targetText: paraAlign.targetText,
              conceptualChange,
              details: 'Material language modification detected'
            });
          }
        }
      }
    }

    return classifications;
  }

  private async interpretChanges(classifications: ChangeClassification[]): Promise<Interpretation[]> {
    // Use LLM to interpret material changes
    const interpretations: Interpretation[] = [];

    for (const classification of classifications) {
      if (classification.severity === 'RED_FLAG' || classification.severity === 'AMBER') {
        const prompt = this.buildInterpretationPrompt(classification);
        const interpretation = await this.llm.interpret(prompt);

        interpretations.push({
          classification,
          interpretation: interpretation.text,
          implication: interpretation.implication,
          challengeQuestion: interpretation.challengeQuestion
        });
      }
    }

    return interpretations;
  }
}
```


## Data Models

### Core Data Models

```typescript
// Document Models
interface Document {
  id: string;
  companyId: string;
  documentType: string;
  filingDate: Date;
  periodEndDate?: Date;
  sections: Section[];
  metadata: DocumentMetadata;
}

interface Section {
  id: string;
  documentId: string;
  type: string;
  title: string;
  content: string;
  contentHash: string;
  subsections?: Section[];
  metadata: SectionMetadata;
}

interface SectionMetadata {
  pageNumber?: number;
  wordCount: number;
  paragraphCount: number;
  extractedAt: Date;
}

// Diff Models
interface SectionAlignment {
  sectionType: string;
  sourceSection: Section | null;
  targetSection: Section | null;
  paragraphAlignments: ParagraphAlignment[];
  alignmentType: 'matched' | 'added' | 'removed';
}

interface ParagraphAlignment {
  sourceIndex: number;
  targetIndex: number | null;
  sourceText: string;
  targetText: string | null;
  similarity: number;
}

interface ChangeClassification {
  sectionType: string;
  changeType: 'section_added' | 'section_removed' | 'paragraph_added' | 'paragraph_removed' | 'paragraph_modified';
  severity: SeverityLevel;
  sourceText?: string;
  targetText?: string;
  conceptualChange?: ConceptualChange;
  details: string;
}

// Provocation Models
interface Provocation {
  id: string;
  companyId: string;
  title: string;
  severity: SeverityLevel;
  category: ProvocationCategory;
  observation: string;
  filingReferences: FilingReference[];
  crossFilingDelta?: string;
  implication: string;
  challengeQuestion: string;
  sourceClassifications: string[]; // IDs of ChangeClassifications
  createdAt: Date;
  expiresAt?: Date;
}

interface FilingReference {
  documentId: string;
  filingType: string;
  filingDate: Date;
  section: string;
  pageNumber?: number;
  excerpt: string;
  url?: string;
}

// Analysis Models
interface AnalysisRequest {
  companyId: string;
  mode: string;
  query?: string;
  presetQuestionId?: string;
  options: AnalysisOptions;
}

interface AnalysisOptions {
  includePreComputed: boolean;
  maxProvocations?: number;
  severityFilter?: SeverityLevel[];
  categoryFilter?: ProvocationCategory[];
  dateRange?: { start: Date; end: Date };
}

interface AnalysisResponse {
  companyId: string;
  mode: string;
  provocations: Provocation[];
  metadata: AnalysisMetadata;
}

interface AnalysisMetadata {
  documentsAnalyzed: number;
  preComputedUsed: boolean;
  computationTime: number;
  cacheHit: boolean;
  generatedAt: Date;
}

// Cache Models
interface CachedProvocations {
  companyId: string;
  mode: string;
  provocations: Provocation[];
  sourceDocuments: string[];
  computedAt: Date;
  expiresAt: Date;
}
```

### Database Schema

```sql
-- Documents table
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR(20) NOT NULL,
  document_type VARCHAR(10) NOT NULL,
  filing_date TIMESTAMP NOT NULL,
  period_end_date TIMESTAMP,
  metadata JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_documents_company_date ON documents(company_id, filing_date DESC);
CREATE INDEX idx_documents_type ON documents(document_type);
CREATE INDEX idx_documents_company_type_date ON documents(company_id, document_type, filing_date DESC);

-- Document sections table
CREATE TABLE document_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_type VARCHAR(100) NOT NULL,
  section_title TEXT,
  content TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sections_document ON document_sections(document_id);
CREATE INDEX idx_sections_type ON document_sections(section_type);
CREATE INDEX idx_sections_hash ON document_sections(content_hash);

-- Section diffs table (pre-computed)
CREATE TABLE section_diffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_section_id UUID NOT NULL REFERENCES document_sections(id) ON DELETE CASCADE,
  target_section_id UUID NOT NULL REFERENCES document_sections(id) ON DELETE CASCADE,
  diff_data JSONB NOT NULL,
  computed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_diffs_source ON section_diffs(source_section_id);
CREATE INDEX idx_diffs_target ON section_diffs(target_section_id);
CREATE UNIQUE INDEX idx_diffs_pair ON section_diffs(source_section_id, target_section_id);

-- Provocations table
CREATE TABLE provocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR(20) NOT NULL,
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

CREATE INDEX idx_provocations_company ON provocations(company_id);
CREATE INDEX idx_provocations_mode ON provocations(analysis_mode);
CREATE INDEX idx_provocations_severity ON provocations(severity);
CREATE INDEX idx_provocations_company_mode ON provocations(company_id, analysis_mode);

-- Provocations cache table
CREATE TABLE provocations_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR(20) NOT NULL,
  analysis_mode VARCHAR(50) NOT NULL,
  provocations JSONB NOT NULL,
  source_documents UUID[] NOT NULL,
  computed_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_cache_company_mode ON provocations_cache(company_id, analysis_mode);
CREATE INDEX idx_cache_expires ON provocations_cache(expires_at);

-- Query counter for auto-generation trigger
CREATE TABLE research_query_counter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR(20) NOT NULL,
  query_count INTEGER DEFAULT 0,
  last_query_at TIMESTAMP,
  provocations_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_query_counter_company ON research_query_counter(company_id);
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing all acceptance criteria, I identified several areas where properties can be consolidated:

- **Document processing properties** (1.1, 1.2, 1.5, 2.2, 2.3, 2.4) can be combined into comprehensive document handling properties
- **Change detection properties** (3.1, 3.2, 3.4, 3.5, 11.2, 11.3, 11.4) overlap significantly and can be unified
- **Provocation structure properties** (4.1, 4.2, 4.6, 7.3, 9.2, 9.3, 15.1, 15.2, 15.3) all validate provocation completeness
- **Severity classification properties** (14.1, 14.2, 14.3, 14.4, 14.5) can be combined into a single comprehensive property
- **Performance properties** (17.1, 17.2, 17.3, 17.4, 17.5) can be consolidated into key performance indicators

The following properties represent the unique, non-redundant validation requirements:

### Core Engine Properties

**Property 1: Document-Agnostic Processing**
*For any* document type with a registered adapter, the Provocations Engine should successfully process the document and generate temporal diffs without requiring core engine modifications.
**Validates: Requirements 1.1, 1.2, 1.4**

**Property 2: Temporal Index Completeness**
*For any* document ingested into the system, the Temporal Index should store it with complete metadata (filing date, company identifier, document type) and section-level granularity.
**Validates: Requirements 1.5, 2.3, 10.2**

**Property 3: Section Alignment Consistency**
*For any* pair of documents from the same company, the engine should align corresponding sections and classify each alignment as matched, added, or removed.
**Validates: Requirements 3.1, 11.1, 11.2**

**Property 4: Change Detection Completeness**
*For any* aligned section pair, the engine should detect and classify all changes (added, removed, modified, unchanged) at the paragraph level.
**Validates: Requirements 3.2, 3.4, 3.5, 11.3, 11.4**

**Property 5: Semantic Similarity Beyond Text Matching**
*For any* pair of text segments with conceptual changes but high lexical similarity (e.g., "we may experience" vs "we have experienced"), the Semantic Similarity Engine should detect the conceptual difference and flag it as a material change.
**Validates: Requirements 3.3, 3.6**

**Property 6: Filing Reference Completeness**
*For any* detected change or provocation, the system should include exact filing references containing filing type, date, section, and text excerpt for all source documents.
**Validates: Requirements 3.7, 4.6, 15.1, 15.2, 15.3, 15.4**

### Provocation Generation Properties

**Property 7: Provocation Structure Completeness**
*For any* generated provocation, it should contain all required fields: title, severity, observation, filing references, implication, challenge question, and category.
**Validates: Requirements 4.1, 4.2, 7.3, 9.2, 9.3**

**Property 8: Cross-Filing Delta Inclusion**
*For any* provocation generated from comparing multiple documents, the provocation should include cross-filing delta information describing what changed between versions.
**Validates: Requirements 4.3**

**Property 9: Materiality-Based Prioritization**
*For any* set of provocations, when sorted by the engine's prioritization algorithm, RED FLAG provocations should appear before AMBER, and AMBER before GREEN CHALLENGE.
**Validates: Requirements 4.4**

**Property 10: Evidence-Based Grounding**
*For any* provocation, all observations and implications should be traceable to specific document text, with no speculative claims lacking documentary evidence.
**Validates: Requirements 4.6, 15.4**

**Property 11: Severity Classification Consistency**
*For any* finding, the severity classification (RED FLAG, AMBER, GREEN CHALLENGE) should be consistent across document types and include rationale explaining the classification.
**Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5**

### Contradiction Detection Properties

**Property 12: Statement vs Results Contradiction Detection**
*For any* forward-looking statement in a prior filing and subsequent reported results, if the results materially differ from the statement, the system should detect and flag the contradiction.
**Validates: Requirements 5.1, 5.2, 16.2, 16.3**

**Property 13: Dual Reference Provision for Contradictions**
*For any* detected contradiction, the system should provide specific references to both conflicting statements or data points.
**Validates: Requirements 5.5**

**Property 14: Segment vs Consolidated Misalignment Detection**
*For any* document containing both segment-level data and consolidated narrative, if the narrative contradicts the segment performance, the system should detect and flag the misalignment.
**Validates: Requirements 5.3**

**Property 15: Capital Allocation Alignment Detection**
*For any* document pair containing stated capital allocation strategy and actual capex data, if actual spending materially differs from stated strategy, the system should detect and flag the misalignment.
**Validates: Requirements 5.4**

### Adapter and Extensibility Properties

**Property 16: Section Normalization Across Formats**
*For any* SEC filing in HTML or XBRL format, the SEC Filing Adapter should normalize section identifiers to standard types (e.g., "Item 1A", "ITEM 1A", "Risk Factors" all map to "Risk Factors").
**Validates: Requirements 2.4**

**Property 17: Runtime Adapter Registration**
*For any* new Document Adapter registered at runtime, the engine should immediately make it available for document processing without system restart.
**Validates: Requirements 12.3, 12.4**

**Property 18: Adapter Configuration Persistence**
*For any* registered Document Adapter with specific configuration, the system should maintain that configuration across sessions and apply it consistently.
**Validates: Requirements 12.5**

### Analysis Mode Properties

**Property 19: Mode-Specific Processing**
*For any* analysis mode and document set, switching between modes should produce different outputs according to each mode's processing rules without re-processing the underlying documents.
**Validates: Requirements 13.1, 13.2, 13.3, 13.4**

**Property 20: Custom Mode Support**
*For any* custom analysis mode defined through configuration, the system should execute it with the same capabilities as built-in modes.
**Validates: Requirements 13.5**

### User Interface Properties

**Property 21: Adversarial Analysis Application**
*For any* query submitted when Provocations Mode is active, the Research Assistant should apply adversarial analysis and format the response with provocation structure and severity badges.
**Validates: Requirements 6.2, 6.5**

**Property 22: Preset Question Count Constraint**
*For any* ticker with available data, the Research Assistant should display between 4 and 6 preset question chips based on data availability.
**Validates: Requirements 8.5**

**Property 23: Scratchpad Structure Preservation**
*For any* provocation saved to the Scratchpad, the saved version should maintain complete structure including severity, observation, references, implication, and challenge question.
**Validates: Requirements 9.2, 9.3**

**Property 24: Auto-Generation Display Constraint**
*For any* auto-generated provocations in the Provocations Tab, the display should show between 3 and 5 of the most material provocations.
**Validates: Requirements 7.2**

### Performance Properties

**Property 25: Preset Question Display Performance**
*For any* activation of Provocations Mode, preset questions should appear within 500ms.
**Validates: Requirements 17.1**

**Property 26: Pre-Computed Query Performance**
*For any* preset question with pre-computed results, the system should return complete results within 3 seconds.
**Validates: Requirements 17.2**

**Property 27: Streaming Response Performance**
*For any* custom query without pre-computed results, the system should provide initial findings within 5 seconds via streaming response.
**Validates: Requirements 17.3**

**Property 28: Background Processing Isolation**
*For any* foreground query, its performance should not degrade by more than 10% when background pre-computation is running.
**Validates: Requirements 17.4**

**Property 29: Cache Effectiveness**
*For any* frequently accessed ticker (>3 queries in 24 hours), cached results should improve response time by at least 50% compared to uncached queries.
**Validates: Requirements 17.5**

### Management Credibility Properties

**Property 30: Forward-Looking Statement Extraction**
*For any* MD&A section, the Management Credibility Tracker should extract all forward-looking statements containing commitment language ("will", "expect", "plan", "intend").
**Validates: Requirements 16.1**

**Property 31: Guidance Walk-Back Detection**
*For any* forward-looking statement in a prior filing that is materially softened or removed in a subsequent filing without explanation, the system should detect and flag the walk-back.
**Validates: Requirements 16.4**

**Property 32: Historical Accuracy Calculation**
*For any* company with at least 4 quarters of forward-looking statements and subsequent results, the system should calculate an accuracy metric comparing stated guidance to actual performance.
**Validates: Requirements 16.5**


## Error Handling

### Error Categories

#### 1. Document Retrieval Errors

```typescript
class DocumentRetrievalError extends Error {
  constructor(
    public documentId: string,
    public source: string,
    public reason: string
  ) {
    super(`Failed to retrieve document ${documentId} from ${source}: ${reason}`);
  }
}

// Handling Strategy:
// - Retry with exponential backoff (3 attempts)
// - Log failure for manual review
// - Return partial results if other documents succeeded
// - Notify user of missing documents in response metadata
```

#### 2. Parsing Errors

```typescript
class DocumentParsingError extends Error {
  constructor(
    public documentId: string,
    public format: string,
    public section: string,
    public reason: string
  ) {
    super(`Failed to parse ${format} document ${documentId} at section ${section}: ${reason}`);
  }
}

// Handling Strategy:
// - Attempt fallback parsing strategies (HTML → text extraction)
// - Mark section as unparseable in metadata
// - Continue processing other sections
// - Include parsing warnings in response
// - Flag document for manual review if critical sections fail
```

#### 3. Semantic Similarity Errors

```typescript
class SemanticSimilarityError extends Error {
  constructor(
    public text1Length: number,
    public text2Length: number,
    public reason: string
  ) {
    super(`Semantic similarity calculation failed: ${reason}`);
  }
}

// Handling Strategy:
// - Fall back to lexical similarity (Levenshtein distance)
// - Log error for monitoring
// - Continue with reduced confidence in change detection
// - Mark affected comparisons with lower confidence score
```

#### 4. LLM Integration Errors

```typescript
class LLMIntegrationError extends Error {
  constructor(
    public operation: string,
    public provider: string,
    public reason: string
  ) {
    super(`LLM operation ${operation} failed with ${provider}: ${reason}`);
  }
}

// Handling Strategy:
// - Retry with exponential backoff (3 attempts)
// - Fall back to cached results if available
// - Return partial results with degraded quality warning
// - For interpretation failures, return raw diff data
// - Monitor error rates and alert on threshold breach
```

#### 5. Cache Errors

```typescript
class CacheError extends Error {
  constructor(
    public operation: 'read' | 'write' | 'invalidate',
    public key: string,
    public reason: string
  ) {
    super(`Cache ${operation} failed for key ${key}: ${reason}`);
  }
}

// Handling Strategy:
// - Continue without cache (performance degradation acceptable)
// - Log error for monitoring
// - Attempt cache reconnection in background
// - Alert if cache unavailable for >5 minutes
```

#### 6. Data Consistency Errors

```typescript
class DataConsistencyError extends Error {
  constructor(
    public entityType: string,
    public entityId: string,
    public inconsistency: string
  ) {
    super(`Data inconsistency in ${entityType} ${entityId}: ${inconsistency}`);
  }
}

// Handling Strategy:
// - Log error with full context for investigation
// - Attempt data reconciliation if possible
// - Return error to user with explanation
// - Flag affected entities for manual review
// - Trigger data integrity check job
```

### Error Response Format

```typescript
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
    recoverable: boolean;
    suggestedAction?: string;
  };
  partialResults?: any;
  metadata: {
    requestId: string;
    timestamp: Date;
    affectedResources: string[];
  };
}

// Example:
{
  success: false,
  error: {
    code: 'DOCUMENT_PARSING_ERROR',
    message: 'Failed to parse Risk Factors section from 10-K filing',
    details: {
      documentId: 'AAPL-10K-2024-09-30',
      section: 'Item 1A',
      reason: 'Malformed HTML structure'
    },
    recoverable: true,
    suggestedAction: 'Retry with fallback parser or contact support'
  },
  partialResults: {
    // Other sections that parsed successfully
    parsedSections: ['MD&A', 'Financial Statements']
  },
  metadata: {
    requestId: 'req_abc123',
    timestamp: '2024-02-10T10:30:00Z',
    affectedResources: ['AAPL-10K-2024-09-30']
  }
}
```

### Graceful Degradation Strategy

1. **Missing Documents**: Proceed with available documents, note gaps in response
2. **Partial Parsing**: Use successfully parsed sections, flag unparseable sections
3. **LLM Unavailable**: Return raw diffs without interpretation, cache for later processing
4. **Cache Unavailable**: Compute on-demand, accept performance degradation
5. **Semantic Similarity Failure**: Fall back to lexical similarity with confidence penalty

### Monitoring and Alerting

```typescript
interface ErrorMetrics {
  errorRate: number; // errors per minute
  errorsByType: Map<string, number>;
  affectedUsers: Set<string>;
  affectedCompanies: Set<string>;
  averageRecoveryTime: number; // milliseconds
}

// Alert Thresholds:
// - Error rate > 10/minute: Page on-call engineer
// - LLM error rate > 20%: Switch to fallback provider
// - Cache unavailable > 5 minutes: Page infrastructure team
// - Parsing error rate > 30%: Investigate data quality issues
// - Any DataConsistencyError: Immediate investigation
```


## Testing Strategy

### Dual Testing Approach

The Provocations Engine requires both unit testing and property-based testing for comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, error conditions, and integration points
- **Property tests**: Verify universal properties across all inputs through randomization
- Both approaches are complementary and necessary for production readiness

### Property-Based Testing Configuration

**Library Selection**: 
- TypeScript: `fast-check` (mature, well-maintained, excellent TypeScript support)
- Minimum 100 iterations per property test (due to randomization)
- Each property test must reference its design document property via comment tag

**Tag Format**:
```typescript
// Feature: provocations-engine, Property 1: Document-Agnostic Processing
```

### Testing Layers

#### 1. Unit Tests

**Core Engine Components**:
```typescript
describe('TemporalDiffEngine', () => {
  it('should align sections with identical types', () => {
    // Test specific example of section alignment
  });

  it('should handle missing sections gracefully', () => {
    // Test edge case: section exists in source but not target
  });

  it('should detect paragraph additions', () => {
    // Test specific example of added paragraph
  });

  it('should handle empty documents', () => {
    // Test edge case: empty document
  });
});

describe('SemanticSimilarityEngine', () => {
  it('should detect conceptual change from "may" to "have"', () => {
    // Test specific example of qualifier escalation
  });

  it('should handle identical text', () => {
    // Test edge case: no change
  });

  it('should handle very long text segments', () => {
    // Test edge case: performance with large inputs
  });
});

describe('ProvocationGenerator', () => {
  it('should generate provocation with all required fields', () => {
    // Test specific example of provocation generation
  });

  it('should classify material risk as RED FLAG', () => {
    // Test specific severity classification
  });

  it('should handle no findings gracefully', () => {
    // Test edge case: no material changes
  });
});
```

**Document Adapters**:
```typescript
describe('SECFilingAdapter', () => {
  it('should retrieve 10-K from EDGAR', () => {
    // Test specific filing retrieval
  });

  it('should parse HTML format filing', () => {
    // Test specific format
  });

  it('should parse XBRL format filing', () => {
    // Test specific format
  });

  it('should normalize "Item 1A" and "Risk Factors" to same type', () => {
    // Test specific normalization case
  });

  it('should handle malformed HTML gracefully', () => {
    // Test error condition
  });
});
```

**Integration Tests**:
```typescript
describe('End-to-End Provocations Flow', () => {
  it('should generate provocations for AAPL 10-K comparison', () => {
    // Test complete flow with real data
  });

  it('should pre-compute diffs on new filing ingestion', () => {
    // Test background processing integration
  });

  it('should serve cached results for repeat queries', () => {
    // Test caching integration
  });

  it('should update Provocations Tab after 3 queries', () => {
    // Test auto-generation trigger
  });
});
```

#### 2. Property-Based Tests

**Property 1: Document-Agnostic Processing**
```typescript
// Feature: provocations-engine, Property 1: Document-Agnostic Processing
describe('Property: Document-Agnostic Processing', () => {
  it('should process any document type with registered adapter', () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          documentType: fc.constantFrom('10-K', '10-Q', '8-K', 'transcript', 'pdf'),
          companyId: fc.string({ minLength: 1, maxLength: 10 }),
          content: fc.string({ minLength: 100, maxLength: 10000 }),
          sections: fc.array(fc.record({
            type: fc.string(),
            content: fc.string({ minLength: 50 })
          }), { minLength: 1, maxLength: 10 })
        }),
        async (document) => {
          // Register adapter for document type if not exists
          const adapter = getOrCreateAdapter(document.documentType);
          
          // Process document
          const result = await engine.processDocument(document, adapter);
          
          // Verify processing succeeded
          expect(result.success).toBe(true);
          expect(result.temporalIndex).toBeDefined();
          expect(result.sections.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

**Property 2: Temporal Index Completeness**
```typescript
// Feature: provocations-engine, Property 2: Temporal Index Completeness
describe('Property: Temporal Index Completeness', () => {
  it('should store all documents with complete metadata and sections', () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          companyId: fc.string({ minLength: 1, maxLength: 10 }),
          documentType: fc.constantFrom('10-K', '10-Q', '8-K'),
          filingDate: fc.date(),
          sections: fc.array(fc.record({
            type: fc.string(),
            content: fc.string({ minLength: 50 })
          }), { minLength: 1 })
        }),
        async (document) => {
          // Ingest document
          await engine.ingestDocument(document);
          
          // Retrieve from temporal index
          const indexed = await temporalIndex.getDocument(
            document.companyId,
            document.documentType,
            document.filingDate
          );
          
          // Verify completeness
          expect(indexed).toBeDefined();
          expect(indexed.metadata.companyId).toBe(document.companyId);
          expect(indexed.metadata.documentType).toBe(document.documentType);
          expect(indexed.metadata.filingDate).toEqual(document.filingDate);
          expect(indexed.sections.length).toBe(document.sections.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

**Property 4: Change Detection Completeness**
```typescript
// Feature: provocations-engine, Property 4: Change Detection Completeness
describe('Property: Change Detection Completeness', () => {
  it('should detect all paragraph-level changes', () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          sourceSection: fc.record({
            type: fc.string(),
            paragraphs: fc.array(fc.string({ minLength: 50 }), { minLength: 1, maxLength: 20 })
          }),
          targetSection: fc.record({
            type: fc.string(),
            paragraphs: fc.array(fc.string({ minLength: 50 }), { minLength: 1, maxLength: 20 })
          })
        }),
        async ({ sourceSection, targetSection }) => {
          // Ensure same section type
          targetSection.type = sourceSection.type;
          
          // Detect changes
          const changes = await engine.detectChanges(sourceSection, targetSection);
          
          // Verify all paragraphs are classified
          const totalParagraphs = Math.max(
            sourceSection.paragraphs.length,
            targetSection.paragraphs.length
          );
          
          const classifiedChanges = changes.filter(c =>
            ['added', 'removed', 'modified', 'unchanged'].includes(c.type)
          );
          
          expect(classifiedChanges.length).toBeGreaterThanOrEqual(totalParagraphs);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

**Property 7: Provocation Structure Completeness**
```typescript
// Feature: provocations-engine, Property 7: Provocation Structure Completeness
describe('Property: Provocation Structure Completeness', () => {
  it('should generate provocations with all required fields', () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          diff: fc.record({
            sourceDoc: fc.record({ id: fc.string(), type: fc.string() }),
            targetDoc: fc.record({ id: fc.string(), type: fc.string() }),
            changes: fc.array(fc.record({
              type: fc.constantFrom('added', 'removed', 'modified'),
              severity: fc.constantFrom('RED_FLAG', 'AMBER', 'GREEN_CHALLENGE'),
              sourceText: fc.string(),
              targetText: fc.string()
            }), { minLength: 1 })
          })
        }),
        async ({ diff }) => {
          // Generate provocations
          const provocations = await generator.generateProvocations(diff, 'provocations');
          
          // Verify each provocation has all required fields
          for (const provocation of provocations) {
            expect(provocation.title).toBeDefined();
            expect(provocation.title.length).toBeGreaterThan(0);
            
            expect(provocation.severity).toMatch(/^(RED_FLAG|AMBER|GREEN_CHALLENGE)$/);
            
            expect(provocation.observation).toBeDefined();
            expect(provocation.observation.length).toBeGreaterThan(0);
            
            expect(provocation.filingReferences).toBeDefined();
            expect(provocation.filingReferences.length).toBeGreaterThan(0);
            
            expect(provocation.implication).toBeDefined();
            expect(provocation.implication.length).toBeGreaterThan(0);
            
            expect(provocation.challengeQuestion).toBeDefined();
            expect(provocation.challengeQuestion.length).toBeGreaterThan(0);
            
            expect(provocation.category).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

**Property 9: Materiality-Based Prioritization**
```typescript
// Feature: provocations-engine, Property 9: Materiality-Based Prioritization
describe('Property: Materiality-Based Prioritization', () => {
  it('should sort provocations by severity (RED > AMBER > GREEN)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({
          id: fc.string(),
          severity: fc.constantFrom('RED_FLAG', 'AMBER', 'GREEN_CHALLENGE'),
          title: fc.string()
        }), { minLength: 3, maxLength: 20 }),
        (provocations) => {
          // Prioritize
          const sorted = engine.prioritizeProvocations(provocations);
          
          // Verify ordering
          let lastSeverityRank = 0;
          const severityRanks = {
            'RED_FLAG': 3,
            'AMBER': 2,
            'GREEN_CHALLENGE': 1
          };
          
          for (const provocation of sorted) {
            const currentRank = severityRanks[provocation.severity];
            expect(currentRank).toBeLessThanOrEqual(lastSeverityRank || 3);
            lastSeverityRank = currentRank;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

**Property 25-27: Performance Properties**
```typescript
// Feature: provocations-engine, Property 25: Preset Question Display Performance
describe('Property: Preset Question Display Performance', () => {
  it('should display preset questions within 500ms', () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          companyId: fc.string({ minLength: 1, maxLength: 10 }),
          mode: fc.constant('provocations')
        }),
        async ({ companyId, mode }) => {
          const startTime = Date.now();
          
          // Activate provocations mode
          const questions = await researchAssistant.activateMode(companyId, mode);
          
          const endTime = Date.now();
          const duration = endTime - startTime;
          
          // Verify performance
          expect(duration).toBeLessThan(500);
          expect(questions.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: provocations-engine, Property 26: Pre-Computed Query Performance
describe('Property: Pre-Computed Query Performance', () => {
  it('should return pre-computed results within 3 seconds', () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          companyId: fc.string({ minLength: 1, maxLength: 10 }),
          presetQuestionId: fc.string()
        }),
        async ({ companyId, presetQuestionId }) => {
          // Pre-compute results
          await engine.preGenerateProvocations(companyId, 'provocations');
          
          const startTime = Date.now();
          
          // Execute preset question
          const results = await researchAssistant.executePresetQuestion(
            companyId,
            presetQuestionId
          );
          
          const endTime = Date.now();
          const duration = endTime - startTime;
          
          // Verify performance
          expect(duration).toBeLessThan(3000);
          expect(results.provocations.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Test Data Strategy

**Synthetic Data Generation**:
- Use `fast-check` generators for random document structures
- Generate realistic SEC filing content with controlled variations
- Create document pairs with known changes for validation

**Real Data Testing**:
- Maintain test fixtures with actual SEC filings (AAPL, MSFT, GOOGL)
- Use historical filings with known material changes
- Validate against manually reviewed provocations

**Edge Cases**:
- Empty documents
- Single-section documents
- Documents with no changes
- Documents with all sections changed
- Malformed HTML/XBRL
- Very large documents (>10MB)
- Documents with special characters and encoding issues

### Continuous Testing

**Pre-Commit**:
- Run all unit tests
- Run fast property tests (10 iterations)

**CI Pipeline**:
- Run all unit tests
- Run full property tests (100 iterations)
- Run integration tests
- Performance regression tests

**Nightly**:
- Extended property tests (1000 iterations)
- Real data validation against production filings
- Performance benchmarking
- Data consistency checks

### Test Coverage Goals

- Unit test coverage: >85% of code
- Property test coverage: 100% of correctness properties
- Integration test coverage: All critical user flows
- Error path coverage: All error handling branches

