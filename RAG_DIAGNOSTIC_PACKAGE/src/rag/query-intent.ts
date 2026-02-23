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
  type: 'user_document' | 'sec_filing' | 'metric';
  title: string;
  content: string;
  metadata: {
    ticker?: string;
    documentType?: string;
    filingType?: string;
    fiscalPeriod?: string;
    pageNumber?: number;
    chunkIndex?: number;
  };
}

export interface Source {
  type: 'metric' | 'narrative';
  ticker: string;
  filingType: string;
  fiscalPeriod: string;
  pageNumber?: number;
  section?: string;
}
