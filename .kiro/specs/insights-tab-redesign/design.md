# Insights Tab Redesign - Technical Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        INSIGHTS TAB                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Metric     │  │   Anomaly    │  │  Comp Table  │         │
│  │   Explorer   │  │  Detection   │  │   Builder    │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Change     │  │  Hierarchy   │  │  Footnote    │         │
│  │   Tracker    │  │   Viewer     │  │   Context    │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND SERVICES                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  InsightsController (existing)                           │  │
│  │  - GET /api/deals/:dealId/insights                       │  │
│  │  - GET /api/deals/:dealId/insights/anomalies             │  │
│  │  - GET /api/deals/:dealId/insights/comp-table            │  │
│  │  - GET /api/deals/:dealId/insights/changes               │  │
│  │  - POST /api/deals/:dealId/insights/export               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Service Layer                                           │  │
│  │  ┌────────────────┐  ┌────────────────┐                 │  │
│  │  │ Insights       │  │ Anomaly        │                 │  │
│  │  │ Service        │  │ Detection      │                 │  │
│  │  │ (existing)     │  │ Service (new)  │                 │  │
│  │  └────────────────┘  └────────────────┘                 │  │
│  │  ┌────────────────┐  ┌────────────────┐                 │  │
│  │  │ CompTable      │  │ ChangeTracker  │                 │  │
│  │  │ Service (new)  │  │ Service (new)  │                 │  │
│  │  └────────────────┘  └────────────────┘                 │  │
│  │  ┌────────────────┐  ┌────────────────┐                 │  │
│  │  │ MetricHierarchy│  │ FootnoteLinking│                 │  │
│  │  │ Service (exist)│  │ Service (exist)│                 │  │
│  │  └────────────────┘  └────────────────┘                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Data Layer (PostgreSQL)                                 │  │
│  │  - financial_metrics                                     │  │
│  │  - metric_hierarchy                                      │  │
│  │  - footnote_references                                   │  │
│  │  - narrative_chunks                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Design

### 1. Interactive Metric Explorer

**Frontend Component:** `MetricExplorer.vue` (or Alpine.js component)

```typescript
interface MetricExplorerState {
  selectedMetrics: string[];
  selectedPeriods: string[];
  viewMode: 'table' | 'chart' | 'sparkline';
  customViews: CustomView[];
  loading: boolean;
  data: MetricData[];
}

interface CustomView {
  id: string;
  name: string;
  metrics: string[];
  periods: string[];
  viewMode: string;
  createdAt: Date;
}

interface MetricData {
  metricName: string;
  period: string;
  value: number;
  yoyChange: number;
  trend: 'up' | 'down' | 'flat';
}
```

**API Endpoint:**
```typescript
GET /api/deals/:dealId/insights/metrics
Query params:
  - metrics: string[] (e.g., ['revenue', 'grossMargin'])
  - periods: string[] (e.g., ['FY2022', 'FY2023', 'FY2024'])
  - format: 'json' | 'excel'

Response:
{
  metrics: MetricData[],
  availableMetrics: string[],
  availablePeriods: string[]
}
```

**Backend Service:**
```typescript
@Injectable()
export class MetricExplorerService {
  async getMetrics(
    dealId: number,
    metrics: string[],
    periods: string[]
  ): Promise<MetricData[]> {
    // Query financial_metrics table
    // Calculate YoY changes
    // Determine trends
    return metricData;
  }

  async exportToExcel(
    dealId: number,
    metrics: string[],
    periods: string[]
  ): Promise<Buffer> {
    // Generate Excel file with formulas
    return excelBuffer;
  }
}
```

---

### 2. Anomaly Detection Dashboard

**Frontend Component:** `AnomalyDetector.vue`

```typescript
interface AnomalyDetectorState {
  anomalies: Anomaly[];
  filters: {
    types: AnomalyType[];
    severity: 'high' | 'medium' | 'low' | 'all';
  };
  dismissedAnomalies: string[];
  loading: boolean;
}

interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: 'high' | 'medium' | 'low';
  metric: string;
  period: string;
  value: number;
  expectedValue: number;
  deviation: number;
  description: string;
  context: string;
  actionable: boolean;
  dismissed: boolean;
}

type AnomalyType = 
  | 'statistical_outlier'
  | 'sequential_change'
  | 'peer_divergence'
  | 'trend_reversal'
  | 'management_tone_shift';
```

**API Endpoint:**
```typescript
GET /api/deals/:dealId/insights/anomalies
Query params:
  - types: AnomalyType[]
  - severity: string
  - dismissed: boolean

Response:
{
  anomalies: Anomaly[],
  summary: {
    total: number,
    byType: Record<AnomalyType, number>,
    bySeverity: Record<string, number>
  }
}
```

**Backend Service:**
```typescript
@Injectable()
export class AnomalyDetectionService {
  async detectAnomalies(dealId: number): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // 1. Statistical Outliers
    anomalies.push(...await this.detectStatisticalOutliers(dealId));

    // 2. Sequential Changes
    anomalies.push(...await this.detectSequentialChanges(dealId));

    // 3. Peer Divergence (if peer data available)
    anomalies.push(...await this.detectPeerDivergence(dealId));

    // 4. Trend Reversals
    anomalies.push(...await this.detectTrendReversals(dealId));

    // 5. Management Tone Shifts
    anomalies.push(...await this.detectToneShifts(dealId));

    return this.prioritizeAnomalies(anomalies);
  }

  private async detectStatisticalOutliers(
    dealId: number
  ): Promise<Anomaly[]> {
    // Get 5-year historical data for each metric
    const metrics = await this.getHistoricalMetrics(dealId);
    
    const outliers: Anomaly[] = [];
    
    for (const metric of metrics) {
      const mean = this.calculateMean(metric.values);
      const stdDev = this.calculateStdDev(metric.values);
      const latestValue = metric.values[metric.values.length - 1];
      
      // Check if latest value is >2σ from mean
      if (Math.abs(latestValue - mean) > 2 * stdDev) {
        outliers.push({
          id: `outlier-${metric.name}-${metric.period}`,
          type: 'statistical_outlier',
          severity: this.calculateSeverity(latestValue, mean, stdDev),
          metric: metric.name,
          period: metric.period,
          value: latestValue,
          expectedValue: mean,
          deviation: (latestValue - mean) / stdDev,
          description: `${metric.name} is ${Math.abs((latestValue - mean) / stdDev).toFixed(1)}σ from historical average`,
          context: `Historical range: ${mean - 2*stdDev} to ${mean + 2*stdDev}`,
          actionable: true,
          dismissed: false,
        });
      }
    }
    
    return outliers;
  }

  private async detectSequentialChanges(
    dealId: number
  ): Promise<Anomaly[]> {
    // Detect "first time in X quarters" patterns
    const metrics = await this.getQuarterlyMetrics(dealId);
    const changes: Anomaly[] = [];
    
    for (const metric of metrics) {
      const streak = this.findStreak(metric.values);
      
      if (streak.length >= 4) { // 4+ quarters
        changes.push({
          id: `sequential-${metric.name}-${metric.period}`,
          type: 'sequential_change',
          severity: 'medium',
          metric: metric.name,
          period: metric.period,
          value: metric.values[metric.values.length - 1],
          expectedValue: null,
          deviation: null,
          description: `First ${streak.direction} in ${streak.length} quarters`,
          context: `Previous trend: ${streak.previousDirection}`,
          actionable: true,
          dismissed: false,
        });
      }
    }
    
    return changes;
  }

  private async detectToneShifts(
    dealId: number
  ): Promise<Anomaly[]> {
    // Analyze keyword frequency in MD&A
    const keywords = ['headwinds', 'tailwinds', 'pressure', 'improving', 'challenging'];
    const shifts: Anomaly[] = [];
    
    for (const keyword of keywords) {
      const frequency = await this.getKeywordFrequency(dealId, keyword);
      
      if (frequency.change > 3) { // 3x increase
        shifts.push({
          id: `tone-${keyword}-${frequency.period}`,
          type: 'management_tone_shift',
          severity: 'low',
          metric: `Keyword: ${keyword}`,
          period: frequency.period,
          value: frequency.current,
          expectedValue: frequency.previous,
          deviation: frequency.change,
          description: `"${keyword}" mentioned ${frequency.current}x vs ${frequency.previous}x last quarter`,
          context: 'Check MD&A for context',
          actionable: true,
          dismissed: false,
        });
      }
    }
    
    return shifts;
  }

  private prioritizeAnomalies(anomalies: Anomaly[]): Anomaly[] {
    // Sort by severity, then by type
    return anomalies.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return a.type.localeCompare(b.type);
    });
  }
}
```

---

### 3. Comp Table Builder

**Frontend Component:** `CompTableBuilder.vue`

```typescript
interface CompTableState {
  companies: string[]; // tickers
  metrics: string[];
  period: string;
  data: CompTableData;
  loading: boolean;
}

interface CompTableData {
  headers: string[];
  rows: CompTableRow[];
  summary: {
    median: Record<string, number>;
    mean: Record<string, number>;
    percentiles: Record<string, Record<string, number>>;
  };
}

interface CompTableRow {
  ticker: string;
  companyName: string;
  values: Record<string, number>;
  percentiles: Record<string, number>; // 0-100
  outliers: string[]; // metric names that are outliers
}
```

**API Endpoint:**
```typescript
GET /api/deals/:dealId/insights/comp-table
Query params:
  - companies: string[] (tickers)
  - metrics: string[]
  - period: string

Response:
{
  data: CompTableData,
  availableCompanies: string[],
  availableMetrics: string[]
}
```

**Backend Service:**
```typescript
@Injectable()
export class CompTableService {
  async buildCompTable(
    dealId: number,
    companies: string[],
    metrics: string[],
    period: string
  ): Promise<CompTableData> {
    const rows: CompTableRow[] = [];
    
    for (const ticker of companies) {
      const deal = await this.findDealByTicker(ticker);
      if (!deal) continue;
      
      const values: Record<string, number> = {};
      for (const metric of metrics) {
        values[metric] = await this.getMetricValue(deal.id, metric, period);
      }
      
      rows.push({
        ticker,
        companyName: deal.name,
        values,
        percentiles: {}, // calculated later
        outliers: [],
      });
    }
    
    // Calculate percentiles and identify outliers
    const summary = this.calculateSummaryStats(rows, metrics);
    this.calculatePercentiles(rows, summary, metrics);
    this.identifyOutliers(rows, summary, metrics);
    
    return {
      headers: ['Ticker', 'Company', ...metrics],
      rows,
      summary,
    };
  }

  private calculateSummaryStats(
    rows: CompTableRow[],
    metrics: string[]
  ): CompTableData['summary'] {
    const summary: CompTableData['summary'] = {
      median: {},
      mean: {},
      percentiles: {},
    };
    
    for (const metric of metrics) {
      const values = rows.map(r => r.values[metric]).filter(v => v != null);
      
      summary.median[metric] = this.calculateMedian(values);
      summary.mean[metric] = this.calculateMean(values);
      summary.percentiles[metric] = {
        p25: this.calculatePercentile(values, 25),
        p50: this.calculatePercentile(values, 50),
        p75: this.calculatePercentile(values, 75),
      };
    }
    
    return summary;
  }

  private calculatePercentiles(
    rows: CompTableRow[],
    summary: CompTableData['summary'],
    metrics: string[]
  ): void {
    for (const row of rows) {
      for (const metric of metrics) {
        const value = row.values[metric];
        if (value == null) continue;
        
        // Calculate percentile rank (0-100)
        const allValues = rows.map(r => r.values[metric]).filter(v => v != null);
        const rank = allValues.filter(v => v < value).length;
        row.percentiles[metric] = (rank / allValues.length) * 100;
      }
    }
  }

  private identifyOutliers(
    rows: CompTableRow[],
    summary: CompTableData['summary'],
    metrics: string[]
  ): void {
    for (const row of rows) {
      for (const metric of metrics) {
        const percentile = row.percentiles[metric];
        
        // Top/bottom quartile are outliers
        if (percentile >= 75 || percentile <= 25) {
          row.outliers.push(metric);
        }
      }
    }
  }
}
```

---

### 4. Change Tracker

**Frontend Component:** `ChangeTracker.vue`

```typescript
interface ChangeTrackerState {
  period1: string;
  period2: string;
  changes: Change[];
  filters: {
    types: ChangeType[];
    materiality: 'all' | 'material' | 'immaterial';
  };
  loading: boolean;
}

interface Change {
  id: string;
  type: ChangeType;
  category: string;
  description: string;
  period1Value: any;
  period2Value: any;
  delta: number | null;
  material: boolean;
  context: string;
}

type ChangeType = 
  | 'new_disclosure'
  | 'language_change'
  | 'metric_change'
  | 'accounting_change';
```

**API Endpoint:**
```typescript
GET /api/deals/:dealId/insights/changes
Query params:
  - period1: string
  - period2: string
  - types: ChangeType[]
  - materiality: string

Response:
{
  changes: Change[],
  summary: {
    total: number,
    byType: Record<ChangeType, number>,
    material: number
  }
}
```

**Backend Service:**
```typescript
@Injectable()
export class ChangeTrackerService {
  async detectChanges(
    dealId: number,
    period1: string,
    period2: string
  ): Promise<Change[]> {
    const changes: Change[] = [];
    
    // 1. New Disclosures
    changes.push(...await this.detectNewDisclosures(dealId, period1, period2));
    
    // 2. Language Changes
    changes.push(...await this.detectLanguageChanges(dealId, period1, period2));
    
    // 3. Metric Changes
    changes.push(...await this.detectMetricChanges(dealId, period1, period2));
    
    // 4. Accounting Changes
    changes.push(...await this.detectAccountingChanges(dealId, period1, period2));
    
    return this.sortByMateriality(changes);
  }

  private async detectNewDisclosures(
    dealId: number,
    period1: string,
    period2: string
  ): Promise<Change[]> {
    // Compare narrative_chunks between periods
    const chunks1 = await this.getNarrativeChunks(dealId, period1);
    const chunks2 = await this.getNarrativeChunks(dealId, period2);
    
    const newSections = chunks2.filter(c2 => 
      !chunks1.some(c1 => c1.sectionType === c2.sectionType)
    );
    
    return newSections.map(section => ({
      id: `disclosure-${section.id}`,
      type: 'new_disclosure',
      category: section.sectionType,
      description: `New section: ${section.sectionType}`,
      period1Value: null,
      period2Value: section.content.substring(0, 200),
      delta: null,
      material: true,
      context: `Added in ${period2}`,
    }));
  }

  private async detectMetricChanges(
    dealId: number,
    period1: string,
    period2: string
  ): Promise<Change[]> {
    const metrics1 = await this.getMetrics(dealId, period1);
    const metrics2 = await this.getMetrics(dealId, period2);
    
    const changes: Change[] = [];
    
    for (const metric of metrics2) {
      const prevMetric = metrics1.find(m => m.metricName === metric.metricName);
      if (!prevMetric) continue;
      
      const delta = ((metric.value - prevMetric.value) / prevMetric.value) * 100;
      
      // Material if >10% change
      if (Math.abs(delta) > 10) {
        changes.push({
          id: `metric-${metric.metricName}`,
          type: 'metric_change',
          category: metric.metricName,
          description: `${metric.metricName} changed ${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`,
          period1Value: prevMetric.value,
          period2Value: metric.value,
          delta,
          material: Math.abs(delta) > 20,
          context: `${period1}: ${prevMetric.value} → ${period2}: ${metric.value}`,
        }));
      }
    }
    
    return changes;
  }

  private async detectLanguageChanges(
    dealId: number,
    period1: string,
    period2: string
  ): Promise<Change[]> {
    const keywords = [
      'headwinds', 'tailwinds', 'pressure', 'improving', 
      'challenging', 'uncertainty', 'growth', 'decline'
    ];
    
    const changes: Change[] = [];
    
    for (const keyword of keywords) {
      const freq1 = await this.getKeywordFrequency(dealId, period1, keyword);
      const freq2 = await this.getKeywordFrequency(dealId, period2, keyword);
      
      const delta = freq2 - freq1;
      
      if (Math.abs(delta) >= 3) { // 3+ mention change
        changes.push({
          id: `language-${keyword}`,
          type: 'language_change',
          category: 'MD&A Tone',
          description: `"${keyword}" mentioned ${freq2}x vs ${freq1}x`,
          period1Value: freq1,
          period2Value: freq2,
          delta,
          material: Math.abs(delta) >= 5,
          context: 'Check MD&A for context',
        }));
      }
    }
    
    return changes;
  }

  private sortByMateriality(changes: Change[]): Change[] {
    return changes.sort((a, b) => {
      if (a.material !== b.material) {
        return a.material ? -1 : 1;
      }
      return Math.abs(b.delta || 0) - Math.abs(a.delta || 0);
    });
  }
}
```

---

## Database Schema

**No new tables required!** All features use existing tables:

```sql
-- Existing tables used:
- financial_metrics (metrics data)
- metric_hierarchy (hierarchy relationships)
- footnote_references (footnote links)
- narrative_chunks (MD&A text)
- deals (company info)
```

---

## API Endpoints Summary

```typescript
// Metric Explorer
GET    /api/deals/:dealId/insights/metrics
POST   /api/deals/:dealId/insights/metrics/export

// Anomaly Detection
GET    /api/deals/:dealId/insights/anomalies
POST   /api/deals/:dealId/insights/anomalies/:id/dismiss

// Comp Table
GET    /api/deals/:dealId/insights/comp-table
POST   /api/deals/:dealId/insights/comp-table/export

// Change Tracker
GET    /api/deals/:dealId/insights/changes

// Hierarchy (existing)
GET    /api/deals/:dealId/hierarchy/:period

// Footnotes (existing)
GET    /api/deals/:dealId/footnotes/:metricId
```

---

## Frontend State Management

Using Alpine.js (existing pattern):

```javascript
function insightsTab() {
  return {
    // State
    activeSection: 'explorer', // 'explorer' | 'anomalies' | 'comp' | 'changes' | 'hierarchy'
    loading: {
      explorer: false,
      anomalies: false,
      comp: false,
      changes: false,
    },
    
    // Metric Explorer
    selectedMetrics: [],
    selectedPeriods: [],
    metricData: [],
    
    // Anomaly Detection
    anomalies: [],
    anomalyFilters: {
      types: [],
      severity: 'all',
    },
    
    // Comp Table
    compCompanies: [],
    compMetrics: [],
    compData: null,
    
    // Change Tracker
    changePeriod1: '',
    changePeriod2: '',
    changes: [],
    
    // Methods
    async loadMetrics() { /* ... */ },
    async loadAnomalies() { /* ... */ },
    async loadCompTable() { /* ... */ },
    async loadChanges() { /* ... */ },
    async exportToExcel(section) { /* ... */ },
  };
}
```

---

## Performance Optimization

### Caching Strategy
```typescript
// Cache anomalies for 1 hour (they don't change frequently)
@Cacheable({ ttl: 3600 })
async detectAnomalies(dealId: number): Promise<Anomaly[]> {
  // ...
}

// Cache comp table for 1 day
@Cacheable({ ttl: 86400 })
async buildCompTable(/* ... */): Promise<CompTableData> {
  // ...
}
```

### Database Indexing
```sql
-- Add indexes for common queries
CREATE INDEX idx_financial_metrics_deal_period 
  ON financial_metrics(deal_id, fiscal_period);

CREATE INDEX idx_narrative_chunks_deal_section 
  ON narrative_chunks(deal_id, section_type);

CREATE INDEX idx_metric_hierarchy_deal_period 
  ON metric_hierarchy(deal_id, fiscal_period);
```

### Lazy Loading
- Load anomalies only when tab is opened
- Load comp table only when companies are selected
- Load changes only when periods are selected

---

## Error Handling

```typescript
// Graceful degradation
try {
  const anomalies = await this.anomalyDetectionService.detectAnomalies(dealId);
  return { anomalies, error: null };
} catch (error) {
  this.logger.error(`Failed to detect anomalies: ${error.message}`);
  return { 
    anomalies: [], 
    error: 'Anomaly detection temporarily unavailable' 
  };
}
```

---

## Security Considerations

1. **Tenant Isolation:** All queries filtered by tenant_id
2. **Rate Limiting:** Max 100 requests/minute per user
3. **Input Validation:** Validate all metric names, periods, tickers
4. **SQL Injection:** Use parameterized queries only
5. **Export Size Limits:** Max 10MB Excel files

---

## Monitoring & Logging

```typescript
// Log key events
this.logger.log(`Anomalies detected for deal ${dealId}: ${anomalies.length}`);
this.logger.log(`Comp table built for ${companies.length} companies`);
this.logger.log(`Changes detected: ${changes.length} (${materialChanges} material)`);

// Track performance
const startTime = Date.now();
const result = await this.detectAnomalies(dealId);
const duration = Date.now() - startTime;
this.logger.log(`Anomaly detection took ${duration}ms`);
```

---

## Next Steps

1. Review and approve design
2. Create detailed tasks (see tasks.md)
3. Write comprehensive tests (see testing-strategy.md)
4. Implement Phase 1 features
5. User testing and iteration
