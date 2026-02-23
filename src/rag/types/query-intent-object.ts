/**
 * QueryIntentObject (QIO) Type Definitions
 *
 * Intermediate representation between Haiku structured extraction
 * and the deterministic validation layer. These types define the
 * contract for the Haiku-first intent detection pipeline.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

export interface QueryIntentEntity {
  ticker: string;           // e.g. "AMZN"
  company: string;          // e.g. "Amazon"
  confidence: number;       // 0.0-1.0
}

export interface QueryIntentMetric {
  raw_name: string;         // as stated in query
  canonical_guess: string;  // Haiku's best normalization
  is_computed: boolean;     // requires formula resolution
}

export interface QueryIntentTimePeriod {
  type: 'latest' | 'specific_year' | 'specific_quarter' | 'range' | 'ttm' | 'ytd';
  value: number | null;
  unit: 'years' | 'quarters' | 'months' | null;
  raw_text: string;
}

export type QIOQueryType =
  | 'single_metric'
  | 'multi_metric'
  | 'comparative'
  | 'peer_benchmark'
  | 'trend_analysis'
  | 'concept_analysis'
  | 'narrative_only'
  | 'modeling'
  | 'sentiment'
  | 'screening';

export interface QueryIntentObject {
  entities: QueryIntentEntity[];
  metrics: QueryIntentMetric[];
  time_period: QueryIntentTimePeriod;
  query_type: QIOQueryType;
  needs_narrative: boolean;
  needs_peer_comparison: boolean;
  needs_computation: boolean;
  original_query: string;
}
