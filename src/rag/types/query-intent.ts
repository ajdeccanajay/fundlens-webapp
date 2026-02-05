/**
 * Query Intent Types
 * Represents the parsed intent from a user's natural language query
 */

export type QueryType = 'structured' | 'semantic' | 'hybrid';

export type PeriodType = 'annual' | 'quarterly' | 'latest' | 'range';

export type DocumentType = '10-K' | '10-Q' | '8-K' | 'news' | 'earnings_transcript' | 'user_upload';

export type SectionType = 'mda' | 'risk_factors' | 'business' | 'notes' | 'financial_statements';

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
  metrics: string[];
  period?: string;
  periodType?: PeriodType;
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
