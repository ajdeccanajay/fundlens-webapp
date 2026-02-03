// GICS Sector-based Industry Types (11 sectors)
// https://www.msci.com/our-solutions/indexes/gics
export type IndustryType = 
  | 'energy'                  // GICS 10 - Energy
  | 'materials'               // GICS 15 - Materials
  | 'industrials'             // GICS 20 - Industrials
  | 'consumer_discretionary'  // GICS 25 - Consumer Discretionary
  | 'consumer_staples'        // GICS 30 - Consumer Staples
  | 'health_care'             // GICS 35 - Health Care
  | 'financials'              // GICS 40 - Financials (includes banks, insurance)
  | 'information_technology'  // GICS 45 - Information Technology
  | 'communication_services'  // GICS 50 - Communication Services (includes media, telecom)
  | 'utilities'               // GICS 55 - Utilities
  | 'real_estate';            // GICS 60 - Real Estate (includes REITs)

// Enums
export enum StatementType {
  INCOME_STATEMENT = 'income_statement',
  BALANCE_SHEET = 'balance_sheet',
  CASH_FLOW = 'cash_flow',
}

export enum FilingType {
  TEN_K = '10-K',
  TEN_Q = '10-Q',
  EIGHT_K = '8-K',
}

export enum ExportMode {
  ANNUAL = 'annual',
  QUARTERLY = 'quarterly',
  COMBINED = 'combined',
}

// Request/Response interfaces
export interface ExportRequest {
  filingType: FilingType;
  exportMode: ExportMode;
  years: string[];
  quarters?: string[];
  statements: StatementType[];
  includeCalculatedMetrics?: boolean;
}

export interface Export8KRequest {
  startDate: string;
  endDate: string;
}

export interface AvailablePeriodsResponse {
  annualPeriods: string[];
  quarterlyPeriods: { year: string; quarters: string[] }[];
  has8KFilings: boolean;
  earliest8KDate?: string;
  latest8KDate?: string;
}

// Data interfaces
export interface MetricDefinition {
  normalizedMetric: string;
  displayName: string;
  isHeader?: boolean;
  indent?: number;
  format?: 'currency' | 'percentage' | 'number' | 'eps';
}

export interface MetricRow {
  displayName: string;
  normalizedMetric: string;
  values: Map<string, number | null>;
  reportingUnits: Map<string, string>;  // period -> reporting_unit (units, thousands, millions, billions)
  isHeader?: boolean;
  indent?: number;
  format?: 'currency' | 'percentage' | 'number' | 'eps';
  parentMetric?: string;  // Parent metric for hierarchical relationships
}

export interface StatementData {
  statementType: StatementType;
  filingType: FilingType;
  periods: string[];
  metrics: MetricRow[];
}

export interface ExportOptions {
  ticker: string;
  companyName: string;
  filingType: FilingType;
  exportMode: ExportMode;
  years: string[];
  quarters?: string[];
  statements: StatementType[];
  includeCalculatedMetrics: boolean;
}

export interface WorksheetOptions {
  name: string;
  headerInfo: {
    companyName: string;
    ticker: string;
    statementType: string;
    filingType: string;
  };
  columns: string[];
  rows: MetricRow[];
}

export interface ExportResult {
  buffer: Buffer;
  filename: string;
}

export interface RawFinancialMetric {
  id: string;
  ticker: string;
  normalized_metric: string;
  raw_label: string;
  value: number;
  reporting_unit: string;  // Original scale from SEC: units, thousands, millions, billions
  fiscal_period: string;
  period_type: string;
  filing_type: string;
  statement_type: string;
  filing_date: Date;
  confidence_score: number;
}
