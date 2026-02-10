# Requirements Document: Provocations Engine

## Introduction

The Provocations Engine is a reusable Document Intelligence & Comparison Engine designed to perform temporal analysis, semantic similarity detection, and change tracking across document series. The MVP implementation focuses on SEC filings analysis with an adversarial research mode that stress-tests investment theses by surfacing risks, contradictions, and inconvenient truths hidden in regulatory filings.

The system is architected as a generic, pluggable engine that can be extended beyond SEC filings to handle uploaded documents, call transcripts, and any temporal document series requiring change detection and intelligence extraction.

## Glossary

- **Provocations_Engine**: The core document intelligence system that performs temporal differencing, semantic analysis, and change detection
- **Document_Adapter**: Pluggable component that normalizes different document types (SEC filings, transcripts, PDFs) into a common format for analysis
- **Analysis_Mode**: Configurable analysis behavior (Provocations, Sentiment, Commitment Tracking, Custom)
- **SEC_Filing_Adapter**: Document adapter specifically for 10-K, 10-Q, and 8-K filings
- **Cross_Filing_Diff**: Temporal comparison of language, structure, and content across multiple filings
- **Provocation**: A structured finding that surfaces risks, contradictions, or challenges to an investment thesis
- **Research_Assistant**: The conversational interface in workspace.html where analysts interact with the system
- **Provocations_Tab**: Dedicated tab in workspace.html (alongside Quantitative, Qualitative, and Export tabs) that displays auto-generated provocations and analysis
- **Scratchpad**: User workspace for saving and organizing research findings
- **Severity_Classification**: Risk categorization system (RED FLAG, AMBER, GREEN CHALLENGE)
- **Temporal_Index**: Time-ordered storage of documents with section-level chunking for comparison
- **Semantic_Similarity_Engine**: Component that detects conceptually related language changes beyond exact text matching
- **Management_Credibility_Tracker**: Analysis mode that compares forward-looking statements against subsequent results
- **Filing_Section**: Structured component of SEC filings (Risk Factors, MD&A, Accounting Policies, etc.)

## Requirements

### Requirement 1: Core Engine Architecture

**User Story:** As a system architect, I want a reusable, document-agnostic core engine, so that the system can analyze any temporal document series beyond just SEC filings.

#### Acceptance Criteria

1. THE Provocations_Engine SHALL provide document-agnostic temporal differencing capabilities
2. THE Provocations_Engine SHALL support pluggable Document_Adapters for different document types
3. THE Provocations_Engine SHALL support configurable Analysis_Modes
4. WHEN a new document type is added, THE Provocations_Engine SHALL process it without core engine modifications
5. THE Provocations_Engine SHALL maintain a Temporal_Index of all analyzed documents with section-level granularity

### Requirement 2: SEC Filing Adapter (MVP)

**User Story:** As a financial analyst, I want to analyze SEC filings (10-K, 10-Q, 8-K), so that I can identify risks and contradictions in regulatory disclosures.

#### Acceptance Criteria

1. THE SEC_Filing_Adapter SHALL retrieve full-text 10-K, 10-Q, and 8-K filings from EDGAR
2. THE SEC_Filing_Adapter SHALL parse filings into structured Filing_Sections (Risk Factors, MD&A, Accounting Policies, Financial Statements, Footnotes)
3. WHEN a filing is ingested, THE SEC_Filing_Adapter SHALL extract metadata including filing date, company identifier, and filing type
4. THE SEC_Filing_Adapter SHALL normalize section identifiers across different filing formats
5. THE SEC_Filing_Adapter SHALL handle both HTML and XBRL filing formats

### Requirement 3: Cross-Filing Language Differencing

**User Story:** As a financial analyst, I want to compare language across multiple filings over time, so that I can detect material changes in risk disclosures, management tone, and accounting policies.

#### Acceptance Criteria

1. WHEN comparing two filings, THE Provocations_Engine SHALL align corresponding Filing_Sections
2. THE Provocations_Engine SHALL detect added, removed, and modified paragraphs between filing versions
3. THE Semantic_Similarity_Engine SHALL identify conceptually related language changes beyond exact text matching
4. THE Provocations_Engine SHALL track Risk Factor evolution including additions, removals, and material rewording
5. THE Provocations_Engine SHALL detect accounting policy changes between filings
6. THE Provocations_Engine SHALL measure qualifier language intensity changes (e.g., "may" → "expect" → "confident")
7. WHEN language changes are detected, THE Provocations_Engine SHALL provide exact filing references for both versions

### Requirement 4: Provocation Generation

**User Story:** As a financial analyst, I want structured provocations with severity classifications, so that I can prioritize which findings require immediate attention.

#### Acceptance Criteria

1. WHEN a material finding is detected, THE Provocations_Engine SHALL generate a Provocation with observation, filing reference, implication, and challenge question
2. THE Provocations_Engine SHALL assign a Severity_Classification to each Provocation (RED FLAG, AMBER, or GREEN CHALLENGE)
3. THE Provocations_Engine SHALL include Cross_Filing_Delta information when comparing multiple documents
4. THE Provocations_Engine SHALL prioritize Provocations by materiality
5. WHEN no material findings exist for a category, THE Provocations_Engine SHALL explicitly state the absence of findings
6. THE Provocations_Engine SHALL ground all Provocations in specific document text with exact references

### Requirement 5: Contradiction Detection

**User Story:** As a financial analyst, I want to identify contradictions within and across filings, so that I can assess management credibility and identify hidden risks.

#### Acceptance Criteria

1. THE Provocations_Engine SHALL detect contradictions between management statements and reported financial results
2. THE Management_Credibility_Tracker SHALL compare forward-looking statements from prior filings against subsequent reported results
3. THE Provocations_Engine SHALL identify contradictions between segment-level performance and consolidated narratives
4. THE Provocations_Engine SHALL detect misalignments between stated capital allocation strategy and actual capex commitments
5. WHEN contradictions are detected, THE Provocations_Engine SHALL provide specific references to both conflicting statements

### Requirement 6: Hybrid UX - Research Assistant Integration

**User Story:** As a financial analyst, I want to toggle Provocations Mode in the Research Assistant (workspace.html), so that I can get adversarial analysis without leaving my workflow.

#### Acceptance Criteria

1. THE Research_Assistant SHALL provide a Provocations Mode toggle
2. WHEN Provocations Mode is active, THE Research_Assistant SHALL apply adversarial analysis to all queries
3. WHEN Provocations Mode is active, THE Research_Assistant SHALL display visual indicators (border color change) to signal adversarial mode
4. THE Research_Assistant SHALL display preset question chips when Provocations Mode is activated
5. THE Research_Assistant SHALL format responses using the Provocation structure with severity badges
6. WHEN a user clicks a preset question chip, THE Research_Assistant SHALL execute the corresponding analysis

### Requirement 7: Hybrid UX - Provocations Tab Auto-Generation

**User Story:** As a financial analyst, I want a dedicated Provocations tab in workspace.html (alongside Quantitative, Qualitative, and Export), so that I can quickly see the most material findings without manual queries.

#### Acceptance Criteria

1. WHEN three or more research queries are logged for a ticker, THE Provocations_Tab SHALL auto-generate provocations analysis
2. THE Provocations_Tab SHALL display the top 3-5 most material Provocations
3. THE Provocations_Tab SHALL include severity badges and challenge questions for each Provocation
4. THE Provocations_Tab SHALL provide a link to activate Provocations Mode in the Research_Assistant
5. THE Provocations_Tab SHALL update when new filings are ingested
6. THE Provocations_Tab SHALL be positioned alongside Quantitative, Qualitative, and Export tabs in workspace.html

### Requirement 8: Preset Question Categories

**User Story:** As a financial analyst, I want preset question categories, so that I can quickly access common analysis patterns without formulating queries from scratch.

#### Acceptance Criteria

1. THE Research_Assistant SHALL provide preset questions for Cross-Filing Language Analysis
2. THE Research_Assistant SHALL provide preset questions for Management Credibility assessment
3. THE Research_Assistant SHALL provide preset questions for Financial Red Flags detection
4. THE Research_Assistant SHALL provide preset questions for Thesis Stress Testing
5. THE Research_Assistant SHALL display 4-6 preset question chips based on available data for the ticker
6. WHEN insufficient data exists for a preset category, THE Research_Assistant SHALL hide that category's questions

### Requirement 9: Scratchpad Integration

**User Story:** As a financial analyst, I want to save Provocations to my Scratchpad, so that I can incorporate key findings into my investment memos.

#### Acceptance Criteria

1. WHEN viewing a Provocation, THE Research_Assistant SHALL provide a "Save to Scratchpad" action
2. WHEN a Provocation is saved, THE Scratchpad SHALL store the complete Provocation structure including severity, observation, reference, and challenge
3. THE Scratchpad SHALL maintain the original formatting and severity classification of saved Provocations
4. THE Scratchpad SHALL allow users to organize saved Provocations by ticker or category

### Requirement 10: Temporal Indexing and Pre-Computation

**User Story:** As a system operator, I want pre-computed language diffs, so that Provocations feel instant when analysts request them.

#### Acceptance Criteria

1. WHEN a ticker is loaded, THE Provocations_Engine SHALL pre-compute Cross_Filing_Diffs for the most recent 2-3 filings
2. THE Temporal_Index SHALL store filings with timestamps and section-level chunking
3. THE Temporal_Index SHALL enable section-level alignment between filings of different dates
4. THE Provocations_Engine SHALL cache computed Provocations for frequently accessed tickers
5. WHEN new filings are ingested, THE Provocations_Engine SHALL incrementally update pre-computed diffs

### Requirement 11: Multi-Step Diff Processing

**User Story:** As a system architect, I want a multi-step diff processing pipeline, so that language comparisons are grounded and avoid hallucination.

#### Acceptance Criteria

1. THE Provocations_Engine SHALL extract specific sections from both source and target filings
2. THE Provocations_Engine SHALL align paragraphs and topics between filing versions
3. THE Provocations_Engine SHALL classify each aligned pair as unchanged, modified, added, or removed
4. WHEN modifications are detected, THE Provocations_Engine SHALL identify specific language changes
5. THE Provocations_Engine SHALL interpret material changes and generate Provocations using the defined framework

### Requirement 12: Extensibility for Future Document Types

**User Story:** As a product manager, I want the system to support future document types, so that we can expand beyond SEC filings to transcripts and uploaded documents.

#### Acceptance Criteria

1. THE Provocations_Engine SHALL define a standard Document_Adapter interface
2. THE Document_Adapter interface SHALL specify methods for document retrieval, parsing, section extraction, and metadata extraction
3. THE Provocations_Engine SHALL support registration of new Document_Adapters at runtime
4. WHEN a new Document_Adapter is registered, THE Provocations_Engine SHALL make it available for analysis without system restart
5. THE Provocations_Engine SHALL maintain adapter-specific configuration for document type handling

### Requirement 13: Analysis Mode Configuration

**User Story:** As a product manager, I want configurable Analysis Modes, so that the system can perform different types of intelligence extraction beyond adversarial provocations.

#### Acceptance Criteria

1. THE Provocations_Engine SHALL support multiple Analysis_Modes (Provocations, Sentiment, Commitment Tracking, Custom)
2. WHEN an Analysis_Mode is selected, THE Provocations_Engine SHALL apply mode-specific processing rules
3. THE Provocations_Engine SHALL allow users to switch between Analysis_Modes without re-processing documents
4. THE Provocations_Engine SHALL maintain separate output formats for different Analysis_Modes
5. THE Provocations_Engine SHALL support custom Analysis_Modes defined through configuration

### Requirement 14: Severity Classification Rules

**User Story:** As a financial analyst, I want consistent severity classifications, so that I can trust the prioritization of findings.

#### Acceptance Criteria

1. THE Provocations_Engine SHALL classify findings as RED FLAG when they represent material risks that could significantly impact investment thesis
2. THE Provocations_Engine SHALL classify findings as AMBER when they represent noteworthy patterns requiring monitoring
3. THE Provocations_Engine SHALL classify findings as GREEN CHALLENGE when they represent intellectually important questions that strengthen thesis if answered
4. THE Provocations_Engine SHALL apply consistent severity criteria across all document types
5. THE Provocations_Engine SHALL provide severity classification rationale for each Provocation

### Requirement 15: Data Scope and Grounding

**User Story:** As a compliance officer, I want all findings grounded in source documents, so that analysts can verify claims and maintain audit trails.

#### Acceptance Criteria

1. THE Provocations_Engine SHALL reference specific filing type, date, and section for every Provocation
2. THE Provocations_Engine SHALL include page numbers or section identifiers in filing references
3. THE Provocations_Engine SHALL quote or closely paraphrase specific changed language when comparing filings
4. THE Provocations_Engine SHALL not generate Provocations based on speculation without documentary evidence
5. WHEN an analyst requests source verification, THE Provocations_Engine SHALL provide direct links to referenced filing sections

### Requirement 16: Management Credibility Analysis

**User Story:** As a financial analyst, I want to assess management credibility, so that I can evaluate the reliability of forward-looking statements.

#### Acceptance Criteria

1. THE Management_Credibility_Tracker SHALL extract forward-looking statements from MD&A sections
2. THE Management_Credibility_Tracker SHALL compare extracted statements against subsequent reported results
3. THE Management_Credibility_Tracker SHALL identify instances where management over-promised or under-delivered
4. THE Management_Credibility_Tracker SHALL track instances where management quietly walked back prior guidance
5. THE Management_Credibility_Tracker SHALL calculate historical accuracy metrics for management guidance

### Requirement 17: Performance and Responsiveness

**User Story:** As a financial analyst, I want instant responses in Provocations Mode, so that my research workflow is not interrupted.

#### Acceptance Criteria

1. WHEN Provocations Mode is activated, THE Research_Assistant SHALL display preset questions within 500ms
2. WHEN a preset question is clicked, THE Provocations_Engine SHALL return results within 3 seconds for pre-computed analyses
3. WHEN a custom query is submitted, THE Provocations_Engine SHALL provide streaming responses with initial findings within 5 seconds
4. THE Provocations_Engine SHALL process background pre-computation without impacting foreground query performance
5. THE Provocations_Engine SHALL cache frequently accessed analyses to improve response times
