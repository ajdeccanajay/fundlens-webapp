/**
 * Query Intent Types
 * Represents the parsed intent from a user's natural language query
 */

import { MetricResolution } from '../metric-resolution/types';
import { VisualizationPayload } from './visualization';

export type QueryType = 'structured' | 'semantic' | 'hybrid';

export type PeriodType = 'annual' | 'quarterly' | 'latest' | 'range';

export type DocumentType = '10-K' | '10-Q' | '8-K' | 'DEF 14A' | 'earnings_call' | 'news' | 'earnings_transcript' | 'user_upload';

export type SectionType = 'item_1' | 'item_1a' | 'item_2' | 'item_3' | 'item_7' | 'item_8' | 'item_11' | 'item_1_10q' | 'item_2_10q';

// ── ResponseType Taxonomy (Req 9.1–9.8) ─────────────────────────────────
// Classifies each RAG response into one of 8 categories that drive
// frontend rendering decisions.
export type ResponseType =
  | 'STRUCTURED_ONLY'
  | 'COMPUTED_ONLY'
  | 'HYBRID_SYNTHESIS'
  | 'PEER_COMPARISON'
  | 'TIME_SERIES'
  | 'CONCEPT_ANALYSIS'
  | 'DECOMPOSED_HYBRID'
  | 'NARRATIVE_ONLY';

/**
 * Classification context — the minimal shape needed by classifyResponseType().
 * Matches the fields available on FinancialAnalysisContext without creating
 * a circular import (FinancialAnalysisContext lives in hybrid-synthesis.service.ts).
 */
export interface ResponseClassificationInput {
  intent: QueryIntent;
  metrics: MetricResult[];
  narratives: ChunkResult[];
  computedResults: Array<{ canonical_id: string; value: number | null; [key: string]: any }>;
  peerData?: { rows: Array<{ ticker: string; value: number | null; rank: number }> };
  subQueryResults?: Array<{ subQuery: string; [key: string]: any }>;
  /** Optional concept match ID from ConceptRegistry (e.g. "leverage", "liquidity") */
  conceptMatchId?: string;
}

/**
 * Classify a RAG response into one of 8 ResponseTypes based on the
 * shape of the retrieval results and intent signals.
 *
 * Priority order (first match wins):
 *   1. DECOMPOSED_HYBRID — sub-queries present
 *   2. PEER_COMPARISON   — peer data with rows
 *   3. CONCEPT_ANALYSIS  — ConceptRegistry concept match
 *   4. TIME_SERIES       — trend intent with metrics
 *   5. COMPUTED_ONLY     — computed results only
 *   6. STRUCTURED_ONLY   — metrics only (no narratives, no computed)
 *   7. NARRATIVE_ONLY    — narratives only (no metrics, no computed)
 *   8. HYBRID_SYNTHESIS  — both metrics/computed and narratives
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8
 */
export function classifyResponseType(input: ResponseClassificationInput): ResponseType {
  // Req 9.7: Decomposed into sub-queries
  if (input.subQueryResults && input.subQueryResults.length > 0) {
    return 'DECOMPOSED_HYBRID';
  }

  // Req 9.5: Multiple tickers for same metrics (peer data present)
  if (input.peerData && input.peerData.rows.length > 0) {
    return 'PEER_COMPARISON';
  }

  // Req 9.6: ConceptRegistry concept match (leverage, liquidity, etc.)
  if (input.conceptMatchId) {
    return 'CONCEPT_ANALYSIS';
  }

  const hasMetrics = input.metrics.length > 0;
  const hasComputed = input.computedResults.length > 0;
  const hasNarratives = input.narratives.length > 0;

  // TIME_SERIES: trend intent with metrics available
  if (input.intent.needsTrend && (hasMetrics || hasComputed)) {
    return 'TIME_SERIES';
  }

  // Req 9.3: Computed metric only (no raw metrics, no narratives)
  if (hasComputed && !hasMetrics && !hasNarratives) {
    return 'COMPUTED_ONLY';
  }

  // Req 9.2: Single metric, single company, no narrative
  if (hasMetrics && !hasNarratives && !hasComputed) {
    return 'STRUCTURED_ONLY';
  }

  // Req 9.8: Semantic-only results with no metrics
  if (!hasMetrics && !hasComputed && hasNarratives) {
    return 'NARRATIVE_ONLY';
  }

  // Req 9.4: Both structured data and narrative context
  if ((hasMetrics || hasComputed) && hasNarratives) {
    return 'HYBRID_SYNTHESIS';
  }

  // Fallback — no data at all
  return 'NARRATIVE_ONLY';
}


export interface QueryIntent {
  // Query classification
  type: QueryType;
  
  // Company identification
  ticker?: string | string[];
  
  // Metrics requested
  metrics?: string[];
  
  // Time period
  period?: string; // e.g., "FY2024", "Q4-2024", "latest"
  periodType?: PeriodType;
  periodStart?: string; // For range queries
  periodEnd?: string;
  
  // Document filtering
  documentTypes?: DocumentType[];
  sectionTypes?: SectionType[];
  subsectionName?: string; // Target subsection within identified section (Phase 2)
  
  // Query characteristics
  needsNarrative: boolean;
  needsComparison: boolean;
  needsComputation: boolean;
  needsTrend: boolean;
  
  // Confidence
  confidence: number; // 0-1
  
  // Ambiguity detection (Phase 2)
  needsClarification?: boolean; // True if query is ambiguous and needs clarification
  ambiguityReason?: string; // Reason for ambiguity (for debugging)
  
  // Peer comparison (Multi-Ticker Peer Comparison feature)
  needsPeerComparison?: boolean; // True when query asks about peers/competitors
  
  // LLM-suggested chart type for visualization
  suggestedChart?: string | null;
  
  // Advisory retrieval paths from LLM
  retrievalPaths?: string[];
  
  // Original query
  originalQuery: string;
}

export interface RetrievalPlan {
  useStructured: boolean;
  useSemantic: boolean;
  structuredQuery?: StructuredQuery;
  semanticQuery?: SemanticQuery;
}

export interface StructuredQuery {
  tickers: string[];
  metrics: MetricResolution[];
  period?: string;
  periodType?: PeriodType;
  periodStart?: string;
  periodEnd?: string;
  filingTypes: DocumentType[];
  includeComputed: boolean;
}

export interface SemanticQuery {
  query: string;
  tickers?: string[];
  documentTypes: DocumentType[];
  sectionTypes?: SectionType[];
  period?: string;
  maxResults: number;
}

export interface MetricResult {
  ticker: string;
  normalizedMetric: string;
  rawLabel: string;
  value: number;
  fiscalPeriod: string;
  periodType: string;
  filingType: string;
  statementType: string;
  statementDate: Date;
  filingDate: Date;
  sourcePage?: number;
  confidenceScore: number;
  /** Display name from MetricResolution — used in user-facing output instead of formatMetricLabel() */
  displayName?: string;
}

export interface ChunkResult {
  content: string;
  score: number;
  metadata: {
    ticker: string;
    documentType: string;
    filingType?: string;
    sectionType?: string;
    fiscalPeriod?: string;
    filingDate?: string;
    pageNumber?: number;
    chunkIndex: number;
  };
  location?: {
    s3Location?: string;
  };
}

export interface RAGResponse {
  answer: string;
  intent: QueryIntent;
  metrics?: MetricResult[];
  narratives?: ChunkResult[];
  sources: Source[];
  citations?: Citation[]; // Add citations support
  visualization?: VisualizationPayload; // Chart data when visualization is applicable
  timestamp: Date;
  latency: number;
  cost: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  processingInfo?: {
    structuredMetrics: number;
    semanticNarratives: number;
    userDocumentChunks: number; // Add user document chunks count
    uploadedDocChunks?: number; // Spec §7.1 Source 1+2: uploaded doc chunks from intel_document_chunks
    usedBedrockKB: boolean;
    usedClaudeGeneration: boolean;
    hybridProcessing: boolean;
    fromCache?: boolean; // Whether response was from cache
    modelTier?: string; // Model tier used (haiku/sonnet/opus)
    parallelExecution?: boolean; // Whether parallel execution was used
    optimizationDecisions?: string[]; // Optimization reasoning
    needsClarification?: boolean; // Whether clarification prompt was generated
    sessionDocsUnavailable?: boolean; // Whether session doc retrieval failed (graceful degradation)
  };
}

export interface Citation {
  id: string;
  number?: number; // Citation number for frontend rendering [1], [2], etc.
  citationNumber?: number; // Alias for number for compatibility
  type: 'user_document' | 'sec_filing' | 'metric';
  sourceType?: 'SEC_FILING' | 'USER_UPLOAD'; // For frontend styling
  title: string;
  content: string;
  excerpt?: string; // For modal display
  metadata: {
    ticker?: string;
    documentType?: string;
    filingType?: string;
    fiscalPeriod?: string;
    pageNumber?: number;
    chunkIndex?: number;
  };
  // Flattened metadata for easier access
  ticker?: string;
  filingType?: string;
  fiscalPeriod?: string;
  section?: string;
  pageNumber?: number;
}

export interface Source {
  type: 'metric' | 'narrative';
  ticker: string;
  filingType: string;
  fiscalPeriod: string;
  pageNumber?: number;
  section?: string;
}
