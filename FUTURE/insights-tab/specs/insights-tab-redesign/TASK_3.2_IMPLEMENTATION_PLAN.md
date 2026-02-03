# Task 3.2: Performance Optimization - Implementation Plan

**Date:** February 2, 2026  
**Task:** Phase 3, Task 3.2 - Performance Optimization  
**Priority:** HIGH  
**Estimated Time:** 2 days

---

## Overview

Optimize the Insights Tab for production-level performance with real-world data volumes. Focus on database query optimization, caching strategies, lazy loading, and performance monitoring.

---

## Current Performance Baseline

### Existing Optimizations ✅
1. **Caching:**
   - CompTableService: 1-day TTL
   - ChangeTrackerService: 1-hour TTL
   - AnomalyDetectionService: 1-hour TTL

2. **Database Indexes:**
   - `financial_metrics`: ticker, normalizedMetric, filingDate
   - `narrative_chunks`: ticker, filingType, sectionType, filingDate
   - `deals`: ticker, status, tenantId
   - `metric_hierarchy`: (needs review)
   - `footnote_references`: (needs review)

### Performance Targets
- ✅ Page load: <2 seconds
- ✅ Metric selection: <500ms
- ✅ Export generation: <3 seconds (currently ~200ms)
- ⏳ Anomaly detection: <1 second (needs verification)
- ⏳ Comp table: <1 second (needs verification)
- ⏳ Change tracker: <1 second (needs verification)

---

## Implementation Plan

### 1. Database Index Optimization

#### A. Add Missing Indexes for Insights Queries

**Metric Hierarchy Table:**
```sql
-- Add composite index for hierarchy queries
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_deal_period 
  ON metric_hierarchy(deal_id, fiscal_period);

-- Add index for parent lookups
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_parent 
  ON metric_hierarchy(parent_metric_id) 
  WHERE parent_metric_id IS NOT NULL;

-- Add index for metric name lookups
CREATE INDEX IF NOT EXISTS idx_metric_hierarchy_metric_name 
  ON metric_hierarchy(normalized_metric_name);
```

**Footnote References Table:**
```sql
-- Add composite index for footnote lookups
CREATE INDEX IF NOT EXISTS idx_footnote_refs_metric 
  ON footnote_references(metric_id);

-- Add index for deal-based queries
CREATE INDEX IF NOT EXISTS idx_footnote_refs_deal 
  ON footnote_references(deal_id);
```

**Financial Metrics - Additional Indexes:**
```sql
-- Add composite index for comp table queries
CREATE INDEX IF NOT EXISTS idx_financial_metrics_comp_table 
  ON financial_metrics(ticker, fiscal_period, normalized_metric) 
  WHERE filing_type = '10-K';

-- Add index for change tracker queries
CREATE INDEX IF NOT EXISTS idx_financial_metrics_change_tracker 
  ON financial_metrics(ticker, normalized_metric, fiscal_period, filing_date);
```

**Narrative Chunks - Additional Indexes:**
```sql
-- Add index for MD&A queries (change tracker)
CREATE INDEX IF NOT EXISTS idx_narrative_chunks_mda 
  ON narrative_chunks(ticker, filing_date, section_type) 
  WHERE section_type LIKE '%MD&A%';

-- Add index for risk factor queries
CREATE INDEX IF NOT EXISTS idx_narrative_chunks_risks 
  ON narrative_chunks(ticker, filing_date, section_type) 
  WHERE section_type LIKE '%Risk%';
```

#### B. Create Migration File

**File:** `prisma/migrations/add_insights_performance_indexes.sql`

### 2. Query Optimization

#### A. CompTableService Optimization

**Current Issue:** Multiple individual queries for each company/metric combination

**Optimization:**
```typescript
// BEFORE: N queries (one per company per metric)
for (const ticker of companies) {
  for (const metric of metrics) {
    const metricData = await this.prisma.financialMetric.findFirst({...});
  }
}

// AFTER: Single batch query
const metrics = await this.prisma.financialMetric.findMany({
  where: {
    ticker: { in: companies },
    normalizedMetric: { in: metrics },
    fiscalPeriod: period,
    filingType: '10-K',
  },
  orderBy: { filingDate: 'desc' },
});

// Group results in memory
const grouped = this.groupMetricsByTickerAndMetric(metrics);
```

#### B. ChangeTrackerService Optimization

**Current Issue:** Multiple queries for different change types

**Optimization:**
```typescript
// BEFORE: 4 separate queries
const [newDisclosures, languageChanges, metricChanges, accountingChanges] = 
  await Promise.all([...]);

// AFTER: Batch queries with Promise.all (already done ✅)
// Additional optimization: Use raw SQL for complex queries
const changes = await this.prisma.$queryRaw`
  SELECT ...
  FROM narrative_chunks
  WHERE ticker = ${ticker}
    AND filing_date IN (${fromDate}, ${toDate})
  ORDER BY filing_date
`;
```

#### C. AnomalyDetectionService Optimization

**Current Issue:** Fetching all historical data for statistical analysis

**Optimization:**
```typescript
// BEFORE: Fetch all metrics, then filter in memory
const allMetrics = await this.prisma.financialMetric.findMany({
  where: { ticker },
});

// AFTER: Use database aggregations
const stats = await this.prisma.$queryRaw`
  SELECT 
    normalized_metric,
    AVG(value) as mean,
    STDDEV(value) as std_dev,
    COUNT(*) as count
  FROM financial_metrics
  WHERE ticker = ${ticker}
    AND fiscal_period >= ${fiveYearsAgo}
  GROUP BY normalized_metric
`;
```

### 3. Caching Enhancements

#### A. Add Redis/In-Memory Cache (Optional)

**Current:** Simple Map-based caching  
**Enhancement:** Use Redis for distributed caching (future)

**For Now:** Optimize existing cache strategy

```typescript
// Add cache warming on app startup
@Injectable()
export class CacheWarmingService {
  async warmCache() {
    // Pre-load common queries
    const popularTickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN'];
    for (const ticker of popularTickers) {
      await this.anomalyDetectionService.detectAnomalies(ticker);
    }
  }
}
```

#### B. Add Cache Invalidation Strategy

```typescript
// Clear cache when new data is ingested
@Injectable()
export class DataIngestionService {
  async ingestNewFiling(ticker: string) {
    // ... ingest data ...
    
    // Invalidate caches
    this.compTableService.clearCache();
    this.changeTrackerService.clearCache();
    this.anomalyDetectionService.clearCache();
  }
}
```

### 4. Lazy Loading Implementation

#### A. Frontend Lazy Loading

**Current:** All sections load on page load  
**Enhancement:** Load sections on-demand

```javascript
// Add intersection observer for lazy loading
function insightsTab() {
  return {
    sectionsLoaded: {
      anomalies: false,
      compTable: false,
      changeTracker: false,
      hierarchy: false,
    },
    
    init() {
      this.setupLazyLoading();
    },
    
    setupLazyLoading() {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const section = entry.target.dataset.section;
            if (!this.sectionsLoaded[section]) {
              this.loadSection(section);
              this.sectionsLoaded[section] = true;
            }
          }
        });
      }, { rootMargin: '100px' });
      
      // Observe all sections
      document.querySelectorAll('[data-section]').forEach(el => {
        observer.observe(el);
      });
    },
    
    async loadSection(section) {
      switch(section) {
        case 'anomalies':
          await this.loadAnomalies();
          break;
        case 'compTable':
          // Don't auto-load, wait for user action
          break;
        case 'changeTracker':
          // Don't auto-load, wait for user action
          break;
        case 'hierarchy':
          await this.loadHierarchy();
          break;
      }
    }
  };
}
```

#### B. Backend Pagination

**For large datasets:**
```typescript
// Add pagination to comp table
async buildCompTable(options: CompTableOptions & { limit?: number; offset?: number }) {
  const limit = options.limit || 10;
  const offset = options.offset || 0;
  
  // Paginate companies
  const companies = options.companies.slice(offset, offset + limit);
  
  // Build table for paginated companies
  // ...
}
```

### 5. Performance Monitoring

#### A. Add Performance Logging

```typescript
// Create performance decorator
export function LogPerformance(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;
  
  descriptor.value = async function(...args: any[]) {
    const start = Date.now();
    const result = await originalMethod.apply(this, args);
    const duration = Date.now() - start;
    
    const logger = new Logger(target.constructor.name);
    logger.log(`${propertyKey} took ${duration}ms`);
    
    // Log slow queries (>1s)
    if (duration > 1000) {
      logger.warn(`SLOW QUERY: ${propertyKey} took ${duration}ms`);
    }
    
    return result;
  };
  
  return descriptor;
}

// Usage
@Injectable()
export class CompTableService {
  @LogPerformance
  async buildCompTable(options: CompTableOptions) {
    // ...
  }
}
```

#### B. Add Performance Metrics Endpoint

```typescript
@Controller('performance')
export class PerformanceController {
  @Get('metrics')
  async getMetrics() {
    return {
      cacheHitRate: this.calculateCacheHitRate(),
      avgQueryTime: this.calculateAvgQueryTime(),
      slowQueries: this.getSlowQueries(),
    };
  }
}
```

### 6. Loading States Enhancement

#### A. Add Skeleton Loaders

**Replace spinners with skeleton loaders:**
```html
<!-- Skeleton for comp table -->
<div x-show="compTable.loading" class="skeleton-loader">
  <div class="skeleton-row"></div>
  <div class="skeleton-row"></div>
  <div class="skeleton-row"></div>
</div>
```

**CSS:**
```css
.skeleton-loader {
  animation: pulse 1.5s ease-in-out infinite;
}

.skeleton-row {
  height: 40px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  margin-bottom: 8px;
  border-radius: 4px;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

#### B. Add Progress Indicators

```javascript
// Show progress for long operations
async exportCompTable() {
  this.compTable.exportProgress = 0;
  
  // Simulate progress
  const interval = setInterval(() => {
    this.compTable.exportProgress += 10;
    if (this.compTable.exportProgress >= 90) {
      clearInterval(interval);
    }
  }, 200);
  
  try {
    const result = await fetch(...);
    this.compTable.exportProgress = 100;
    // Download file
  } finally {
    setTimeout(() => {
      this.compTable.exportProgress = 0;
    }, 1000);
  }
}
```

### 7. Performance Testing

#### A. Create Performance Test Suite

**File:** `test/e2e/insights-tab-performance.e2e-spec.ts`

```typescript
describe('Insights Tab Performance (E2E)', () => {
  it('should load page in <2 seconds', async () => {
    const start = Date.now();
    await page.goto('/deals/workspace');
    await page.waitForSelector('[data-section="anomalies"]');
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(2000);
  });
  
  it('should detect anomalies in <1 second', async () => {
    const start = Date.now();
    await request(app.getHttpServer())
      .get(`/api/deals/${dealId}/insights/anomalies`)
      .expect(200);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(1000);
  });
  
  it('should build comp table in <1 second', async () => {
    const start = Date.now();
    await request(app.getHttpServer())
      .get(`/api/deals/${dealId}/insights/comp-table?companies=AAPL,MSFT&metrics=revenue&period=FY2024`)
      .expect(200);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(1000);
  });
});
```

#### B. Add Load Testing

**File:** `test/load/insights-load-test.js`

```javascript
// Using k6 or artillery
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  vus: 10, // 10 virtual users
  duration: '30s',
};

export default function() {
  let response = http.get('http://localhost:3000/api/deals/1/insights/anomalies');
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 1s': (r) => r.timings.duration < 1000,
  });
  sleep(1);
}
```

---

## Implementation Order

### Day 1: Database & Query Optimization
1. ✅ Create migration file with new indexes
2. ✅ Apply migration to database
3. ✅ Optimize CompTableService queries (batch loading)
4. ✅ Optimize ChangeTrackerService queries
5. ✅ Optimize AnomalyDetectionService queries
6. ✅ Add performance logging decorator
7. ✅ Test query performance

### Day 2: Frontend & Monitoring
1. ✅ Implement lazy loading for sections
2. ✅ Add skeleton loaders
3. ✅ Add progress indicators
4. ✅ Create performance test suite
5. ✅ Run performance tests
6. ✅ Document optimizations
7. ✅ Create changelog

---

## Acceptance Criteria

- [ ] Page load <2 seconds ✅ (already met)
- [ ] Metric selection <500ms ✅ (already met)
- [ ] Export generation <3 seconds ✅ (already met)
- [ ] Anomaly detection <1 second (verify)
- [ ] Comp table <1 second (verify)
- [ ] Change tracker <1 second (verify)
- [ ] All tests passing
- [ ] Performance tests added
- [ ] Database indexes added
- [ ] Lazy loading implemented

---

## Files to Create/Modify

### Backend
- `prisma/migrations/add_insights_performance_indexes.sql` (NEW)
- `src/deals/comp-table.service.ts` (optimize queries)
- `src/deals/change-tracker.service.ts` (optimize queries)
- `src/deals/anomaly-detection.service.ts` (optimize queries)
- `src/common/decorators/log-performance.decorator.ts` (NEW)

### Frontend
- `public/app/deals/workspace.html` (lazy loading, skeleton loaders)
- `public/css/workspace-enhancements.css` (skeleton loader styles)

### Tests
- `test/e2e/insights-tab-performance.e2e-spec.ts` (NEW)

### Documentation
- `CHANGELOG-2026-02-02-PERFORMANCE-OPTIMIZATION.md` (NEW)
- `.kiro/specs/insights-tab-redesign/PHASE3_TASK2_COMPLETE.md` (NEW)

---

## Risk Mitigation

### Risk: Database Migration Issues
**Mitigation:** Test migration on dev database first, have rollback plan

### Risk: Breaking Existing Functionality
**Mitigation:** Run full test suite after each optimization

### Risk: Over-Optimization
**Mitigation:** Measure before and after, only optimize what's needed

---

## Success Metrics

- Query time reduced by 50%+
- Cache hit rate >80%
- Zero slow queries (>1s) in production
- User-perceived performance improved
- All acceptance criteria met

---

**Status:** Ready to implement  
**Next Step:** Create database migration file

