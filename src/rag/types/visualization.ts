/**
 * Visualization types for RAG response chart rendering.
 *
 * The canonical shape uses suggestedChartType + data (rows/columns) + meta.
 * Legacy fields (chartType, labels, datasets, options) are retained for
 * backward compatibility with VisualizationGeneratorService consumers.
 */

export type ChartType =
  | 'line'
  | 'bar'
  | 'grouped_bar'
  | 'stacked_bar'
  | 'waterfall'
  | 'table'
  | 'pie'
  | 'groupedBar'; // legacy alias kept for existing consumers

export interface ChartDataset {
  label: string;          // e.g., "Revenue", "YoY Growth %"
  data: number[];         // Numeric values aligned with labels
  type?: 'line' | 'bar'; // Override for mixed charts
  yAxisID?: string;       // For dual-axis charts (e.g., value + growth %)
}

export interface VisualizationPayload {
  // ── Canonical fields (design spec) ──────────────────────────────
  suggestedChartType?: ChartType | null;
  data?: {
    rows: Array<{
      ticker: string;
      period: string;
      filingType: string;
      metrics: Record<string, number | null>;
    }>;
    columns: Array<{
      canonical_id: string;
      display_name: string;
      format: 'currency' | 'percentage' | 'ratio' | 'integer';
      unit_scale: 'ones' | 'thousands' | 'millions' | 'billions';
    }>;
  };
  meta?: {
    title: string;
    tickers: string[];
    periods: string[];
    source: string;
    freshnessWarning?: string;
  };

  // ── Legacy fields (backward compat with VisualizationGeneratorService) ──
  chartType?: ChartType;
  title?: string;
  labels?: string[];
  datasets?: ChartDataset[];
  options?: {
    currency?: boolean;
    percentage?: boolean;
    dualAxis?: boolean;
  };
}
