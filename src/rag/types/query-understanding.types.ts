/**
 * Query Understanding Layer (QUL) Types
 * Spec: FundLens_QUL_Specification_v1.md, Section 3
 *
 * These types define the contract between query understanding and query execution.
 * Every downstream service consumes QueryUnderstanding.
 */

// ── Query Intent Enum ────────────────────────────────────────────────
export type QueryIntent =
  | 'METRIC_LOOKUP'
  | 'METRIC_TREND'
  | 'METRIC_COMPARISON'
  | 'NARRATIVE_SEARCH'
  | 'HYBRID_ANALYSIS'
  | 'SEGMENT_ANALYSIS'
  | 'PEER_SCREENING'
  | 'CROSS_TRANSCRIPT'
  | 'DEAL_ANALYSIS'
  | 'DEAL_COMPARISON'
  | 'MANAGEMENT_ASSESSMENT'
  | 'RED_FLAG_DETECTION'
  | 'PROVOCATION'
  | 'IC_MEMO_GENERATION'
  | 'DOCUMENT_INTAKE'
  | 'UPLOADED_DOC_QUERY'
  | 'CLARIFICATION_NEEDED'
  | 'INVALID';

// ── Retrieval Path ───────────────────────────────────────────────────
export type RetrievalPath =
  | 'structured_db'
  | 'semantic_kb'
  | 'uploaded_doc_rag'
  | 'earnings_transcript'
  | 'peer_comparison'
  | 'formula_engine'
  | 'deal_library';

// ── Chart Type ───────────────────────────────────────────────────────
export type ChartType =
  | 'line_chart'
  | 'bar_chart'
  | 'stacked_bar'
  | 'pie_chart'
  | 'metric_card'
  | 'none';

// ── Entity Type ──────────────────────────────────────────────────────
export type EntityType =
  | 'public_company'
  | 'private_company'
  | 'subsidiary'
  | 'fund'
  | 'uploaded_entity';

export type EntitySource =
  | 'explicit'
  | 'workspace_context'
  | 'coreference'
  | 'uploaded_document'
  | 'peer_resolution';

// ── Resolved Entity ──────────────────────────────────────────────────
export interface ResolvedEntity {
  name: string;
  ticker?: string;
  entityType: EntityType;
  source: EntitySource;
  parentTicker?: string;
  documentId?: string;
}

// ── Temporal Scope ───────────────────────────────────────────────────
export interface TemporalScope {
  type: 'latest' | 'specific_period' | 'range' | 'trailing' | 'all_available';
  periods?: string[];
  rangeStart?: string;
  rangeEnd?: string;
  fiscalYearEndMonth?: number;
}

// ── Sub-Query ────────────────────────────────────────────────────────
export interface SubQuery {
  intent: QueryIntent;
  entity: string | ResolvedEntity;
  metric?: string;
  temporal?: TemporalScope;
  path: RetrievalPath;

  // Deterministic engine hints (spec §8.7)
  metricType?: 'atomic' | 'computed' | 'concept' | 'extracted';
  requiresFormula?: boolean;
  extractionSource?: 'postgresql' | 'uploaded_document' | 'external_feed';
  conceptId?: string;
}

// ── Workspace Context (input to QUL) ─────────────────────────────────
export interface WorkspaceContext {
  ticker?: string;
  companyName?: string;
  domain: 'public_equity' | 'private_equity' | 'uploaded_docs';
  dealName?: string;
}

// ── Uploaded Document Metadata (input to QUL) ────────────────────────
export interface UploadedDocumentMeta {
  id: string;
  name: string;
  type?: string;
  entity?: string;
  ticker?: string;
}

// ── Conversation Message (input to QUL) ──────────────────────────────
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content?: string;
  summary?: string;
}

// ── QueryUnderstanding — the main QUL output ─────────────────────────
export interface QueryUnderstanding {
  // Entity resolution
  entities: ResolvedEntity[];
  primaryEntity?: ResolvedEntity;
  useWorkspaceContext: boolean;

  // Query classification
  intent: QueryIntent;
  domain: 'public_equity' | 'private_equity' | 'cross_domain' | 'uploaded_doc';
  complexity: 'simple' | 'multi_part' | 'comparative' | 'screening';

  // Query quality
  isValidQuery: boolean;
  queryQualityScore: number;
  rejectionReason?: string;

  // Temporal resolution
  temporalScope: TemporalScope;

  // Decomposition
  subQueries?: SubQuery[];
  unifyingInstruction?: string;

  // Routing hints
  suggestedRetrievalPaths: RetrievalPath[];
  suggestedChart?: ChartType;
  needsPeerComparison: boolean;
  peerContext?: string;

  // Metadata
  resolvedBy: 'tier1_haiku' | 'tier2_cache';
  confidence: number;
  rawQuery: string;
  normalizedQuery: string;

  // Internal flags
  _fallbackMode?: boolean;
}

// ── Haiku Raw Output (what Haiku returns before validation) ──────────
export interface HaikuRawOutput {
  entities?: any[];
  primaryEntity?: any;
  useWorkspaceContext?: boolean;
  intent?: string;
  domain?: string;
  complexity?: string;
  isValidQuery?: boolean;
  queryQualityScore?: number;
  rejectionReason?: string;
  temporalScope?: any;
  subQueries?: any[];
  unifyingInstruction?: string;
  suggestedRetrievalPaths?: string[];
  suggestedChart?: string;
  needsPeerComparison?: boolean;
  peerContext?: string;
  confidence?: number;
  normalizedQuery?: string;
}
