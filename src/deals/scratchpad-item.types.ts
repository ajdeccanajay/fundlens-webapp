/**
 * TypeScript interfaces for Research Scratchpad Redesign
 * Feature: research-scratchpad-redesign
 * Requirements: 2.1, 2.2, 3.1, 5.1, 6.1, 7.1, 9.1
 */

export type ItemType = 'direct_answer' | 'revenue_framework' | 'trend_analysis' | 'provocation';

export interface ScratchpadItem {
  id: string;
  workspaceId: string;
  type: ItemType;
  content: DirectAnswer | RevenueFramework | TrendAnalysis | Provocation;
  sources?: SourceCitation[];
  savedAt: string; // ISO timestamp
  savedFrom?: {
    chatMessageId?: string;
    query?: string;
  };
  metadata?: {
    ticker?: string;
    filingPeriod?: string;
    tags?: string[];
  };
}

export interface DirectAnswer {
  text: string;
  confidence?: number | 'high' | 'medium' | 'low';
  sourceCount: number;
}

export interface RevenueFramework {
  pointInTime: ProductCategory[];
  overTime: ProductCategory[];
}

export interface ProductCategory {
  name: string;
  icon: 'phone' | 'laptop' | 'tablet' | 'services' | 'other';
  description?: string;
}

export interface TrendAnalysis {
  metric: string; // "Revenue", "Operating Income", etc.
  data: YearlyData[];
}

export interface YearlyData {
  year: number;
  value: number; // in millions
  yoyChange: number; // percentage
}

export interface Provocation {
  question: string;
  context?: string;
}

export interface SourceCitation {
  filingType: '10-K' | '10-Q' | '8-K';
  filingDate: string; // ISO date
  url: string;
  ticker: string;
}

// API Request/Response types
export interface SaveItemRequest {
  workspaceId: string;
  type: ItemType;
  content: DirectAnswer | RevenueFramework | TrendAnalysis | Provocation;
  sources?: SourceCitation[];
  savedFrom?: {
    chatMessageId?: string;
    query?: string;
  };
  metadata?: {
    ticker?: string;
    filingPeriod?: string;
    tags?: string[];
  };
}

export interface GetItemsResponse {
  items: ScratchpadItem[];
  totalCount: number;
}

export interface ExportRequest {
  workspaceId: string;
  format: 'markdown' | 'text' | 'json';
  itemIds?: string[];
}

export interface ExportResponse {
  content: string;
  filename: string;
}
