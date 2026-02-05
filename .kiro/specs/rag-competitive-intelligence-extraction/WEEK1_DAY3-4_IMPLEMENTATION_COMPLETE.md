# Week 1, Day 3-4: LLM Intent Fallback + Analytics - IMPLEMENTATION GUIDE

**Status**: Ready to implement  
**Goal**: Implement hybrid intent detection with per-tenant analytics and admin dashboard  
**Timeline**: 2 days

---

## Overview

This implementation adds:
1. **LLM fallback** for intent detection (Claude 3.5 Haiku)
2. **Analytics tracking** per tenant
3. **Admin API** for viewing metrics and taking action
4. **Admin UI** for dashboard visualization
5. **Complete test coverage** (unit + E2E)

---

## Phase 1: Backend Implementation (6 hours)

### Step 1.1: Database Schema (30 min)

**File**: `prisma/migrations/20260204_add_intent_analytics.sql`
- ✅ Already created
- Tables: `intent_detection_logs`, `intent_analytics_summary`, `intent_failed_patterns`

**Action**: Apply migration
```bash
node scripts/apply-intent-analytics-migration.js
```

### Step 1.2: Intent Analytics Service (2 hours)

**File**: `src/rag/intent-analytics.service.ts`
- ✅ Already created
- Methods:
  - `logDetection()` - Log every intent detection
  - `getSummary()` - Get aggregated metrics
  - `computeSummary()` - Compute metrics for a period
  - `getFailedPatterns()` - Get patterns for review
  - `updatePatternStatus()` - Mark patterns as reviewed/implemented
  - `getRealtimeMetrics()` - Get last 24h/7d metrics

**Action**: No changes needed

### Step 1.3: Update Intent Detector Service (2 hours)

**File**: `src/rag/intent-detector.service.ts`

**Changes needed**:
1. Add `IntentAnalyticsService` to constructor
2. Add `tenantId` parameter to `detectIntent()`
3. Implement `detectWithLLM()` method
4. Implement `parseLLMResponse()` method
5. Implement `detectGeneric()` method
6. Implement `calculateLLMCost()` method
7. Add analytics logging after each detection

**Reference**: See `src/rag/intent-detector.service.complete.ts` for full implementation

**Key methods to add**:
```typescript
private async detectWithLLM(query: string): Promise<QueryIntent> {
  // Use Claude 3.5 Haiku for structured extraction
  const prompt = `Extract structured intent from: "${query}"...`;
  const response = await this.bedrock.invokeClaude({
    prompt,
    modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    max_tokens: 500,
  });
  return this.parseLLMResponse(response, query);
}

private detectGeneric(query: string): QueryIntent {
  // Always succeeds with low confidence
  return {
    type: 'semantic',
    confidence: 0.4,
    originalQuery: query,
    needsNarrative: true,
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
  };
}

private calculateLLMCost(query: string): number {
  // Claude 3.5 Haiku: $0.25/1M input, $1.25/1M output
  const inputTokens = (query.length + 500) / 4;
  const outputTokens = 150;
  return (inputTokens / 1_000_000) * 0.25 + (outputTokens / 1_000_000) * 1.25;
}
```

### Step 1.4: Update RAG Module (30 min)

**File**: `src/rag/rag.module.ts`

**Changes**:
```typescript
import { IntentAnalyticsService } from './intent-analytics.service';

@Module({
  providers: [
    // ... existing providers
    IntentAnalyticsService,
  ],
  exports: [
    // ... existing exports
    IntentAnalyticsService,
  ],
})
export class RagModule {}
```

### Step 1.5: Update RAG Service (30 min)

**File**: `src/rag/rag.service.ts`

**Changes**:
- Pass `tenantId` to `intentDetector.detectIntent(query, tenantId)`

---

## Phase 2: Admin API (3 hours)

### Step 2.1: Intent Analytics Controller (2 hours)

**File**: `src/admin/intent-analytics.controller.ts`

```typescript
import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';
import { IntentAnalyticsService } from '../rag/intent-analytics.service';

@Controller('admin/intent-analytics')
@UseGuards(PlatformAdminGuard)
export class IntentAnalyticsController {
  constructor(private readonly analytics: IntentAnalyticsService) {}

  /**
   * GET /admin/intent-analytics/realtime?tenantId=acme
   * Get real-time metrics (last 24h/7d)
   */
  @Get('realtime')
  async getRealtimeMetrics(@Query('tenantId') tenantId: string) {
    return this.analytics.getRealtimeMetrics(tenantId);
  }

  /**
   * GET /admin/intent-analytics/summary?tenantId=acme&start=2024-02-01&end=2024-02-07
   * Get aggregated summary for a period
   */
  @Get('summary')
  async getSummary(
    @Query('tenantId') tenantId: string,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    const periodStart = new Date(start);
    const periodEnd = new Date(end);
    return this.analytics.getSummary(tenantId, periodStart, periodEnd);
  }

  /**
   * POST /admin/intent-analytics/compute-summary
   * Compute summary for a period (run manually or via cron)
   */
  @Post('compute-summary')
  async computeSummary(
    @Body() body: { tenantId: string; start: string; end: string },
  ) {
    const periodStart = new Date(body.start);
    const periodEnd = new Date(body.end);
    return this.analytics.computeSummary(body.tenantId, periodStart, periodEnd);
  }

  /**
   * GET /admin/intent-analytics/failed-patterns?tenantId=acme&status=pending
   * Get failed patterns for review
   */
  @Get('failed-patterns')
  async getFailedPatterns(
    @Query('tenantId') tenantId: string,
    @Query('status') status?: 'pending' | 'reviewed' | 'implemented' | 'rejected',
  ) {
    return this.analytics.getFailedPatterns(tenantId, status);
  }

  /**
   * POST /admin/intent-analytics/update-pattern
   * Update pattern status (mark as reviewed/implemented/rejected)
   */
  @Post('update-pattern')
  async updatePattern(
    @Body() body: {
      patternId: string;
      status: 'pending' | 'reviewed' | 'implemented' | 'rejected';
      reviewedBy: string;
      notes?: string;
    },
  ) {
    await this.analytics.updatePatternStatus(
      body.patternId,
      body.status,
      body.reviewedBy,
      body.notes,
    );
    return { success: true };
  }

  /**
   * GET /admin/intent-analytics/tenants
   * Get list of all tenants with analytics data
   */
  @Get('tenants')
  async getTenants() {
    // TODO: Implement tenant list query
    return { tenants: [] };
  }
}
```

### Step 2.2: Update Admin Module (30 min)

**File**: `src/admin/admin.module.ts`

```typescript
import { IntentAnalyticsController } from './intent-analytics.controller';
import { IntentAnalyticsService } from '../rag/intent-analytics.service';

@Module({
  imports: [RagModule], // Import RagModule to get IntentAnalyticsService
  controllers: [
    // ... existing controllers
    IntentAnalyticsController,
  ],
})
export class AdminModule {}
```

---

## Phase 3: Admin UI (4 hours)

### Step 3.1: Intent Analytics Dashboard HTML (2 hours)

**File**: `public/internal/intent-analytics.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Intent Analytics Dashboard - FundLens Admin</title>
  <link rel="stylesheet" href="/css/design-system.css">
  <style>
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .metric-card {
      background: var(--surface-color);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1.5rem;
    }
    .metric-value {
      font-size: 2rem;
      font-weight: 600;
      color: var(--primary-color);
    }
    .metric-label {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-top: 0.5rem;
    }
    .chart-container {
      background: var(--surface-color);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    .pattern-list {
      list-style: none;
      padding: 0;
    }
    .pattern-item {
      background: var(--surface-color);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .pattern-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-reviewed { background: #dbeafe; color: #1e40af; }
    .status-implemented { background: #d1fae5; color: #065f46; }
    .status-rejected { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <div class="admin-container">
    <header class="admin-header">
      <h1>Intent Analytics Dashboard</h1>
      <div class="tenant-selector">
        <label for="tenantSelect">Tenant:</label>
        <select id="tenantSelect">
          <option value="">All Tenants</option>
          <option value="acme">Acme Corp</option>
          <option value="demo">Demo Tenant</option>
        </select>
      </div>
    </header>

    <main class="admin-content">
      <!-- Real-time Metrics -->
      <section>
        <h2>Real-time Metrics (Last 24 Hours)</h2>
        <div class="metrics-grid" id="realtimeMetrics">
          <div class="metric-card">
            <div class="metric-value" id="totalQueries">-</div>
            <div class="metric-label">Total Queries</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="regexSuccessRate">-</div>
            <div class="metric-label">Regex Success Rate</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="llmFallbackRate">-</div>
            <div class="metric-label">LLM Fallback Rate</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="avgConfidence">-</div>
            <div class="metric-label">Avg Confidence</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="avgLatency">-</div>
            <div class="metric-label">Avg Latency (ms)</div>
          </div>
          <div class="metric-card">
            <div class="metric-value" id="llmCost">-</div>
            <div class="metric-label">LLM Cost (USD)</div>
          </div>
        </div>
      </section>

      <!-- Failed Patterns -->
      <section>
        <h2>Failed Query Patterns</h2>
        <div class="pattern-filters">
          <button class="btn" data-status="pending">Pending</button>
          <button class="btn" data-status="reviewed">Reviewed</button>
          <button class="btn" data-status="implemented">Implemented</button>
          <button class="btn" data-status="rejected">Rejected</button>
        </div>
        <ul class="pattern-list" id="patternList">
          <!-- Patterns loaded dynamically -->
        </ul>
      </section>
    </main>
  </div>

  <script>
    // Load metrics and patterns
    async function loadDashboard() {
      const tenantId = document.getElementById('tenantSelect').value || 'acme';
      
      // Load realtime metrics
      const metrics = await fetch(`/admin/intent-analytics/realtime?tenantId=${tenantId}`)
        .then(r => r.json());
      
      document.getElementById('totalQueries').textContent = metrics.last24Hours.totalQueries;
      document.getElementById('regexSuccessRate').textContent = 
        metrics.last24Hours.regexSuccessRate.toFixed(1) + '%';
      document.getElementById('llmFallbackRate').textContent = 
        metrics.last24Hours.llmFallbackRate.toFixed(1) + '%';
      document.getElementById('avgConfidence').textContent = 
        metrics.last24Hours.avgConfidence.toFixed(2);
      document.getElementById('avgLatency').textContent = 
        metrics.last24Hours.avgLatencyMs + 'ms';
      document.getElementById('llmCost').textContent = 
        '$' + metrics.last24Hours.llmCostUsd.toFixed(4);
      
      // Load failed patterns
      loadPatterns(tenantId, 'pending');
    }

    async function loadPatterns(tenantId, status) {
      const patterns = await fetch(
        `/admin/intent-analytics/failed-patterns?tenantId=${tenantId}&status=${status}`
      ).then(r => r.json());
      
      const list = document.getElementById('patternList');
      list.innerHTML = patterns.map(p => `
        <li class="pattern-item">
          <div>
            <strong>Pattern:</strong> ${p.queryPattern}
            <span class="status-badge status-${p.status}">${p.status}</span>
          </div>
          <div><strong>Occurrences:</strong> ${p.occurrenceCount}</div>
          <div><strong>Examples:</strong> ${p.exampleQueries.slice(0, 3).join(', ')}</div>
          ${p.suggestedRegex ? `<div><strong>Suggested Regex:</strong> <code>${p.suggestedRegex}</code></div>` : ''}
          <div class="pattern-actions">
            <button class="btn btn-primary" onclick="updatePattern('${p.id}', 'reviewed')">
              Mark Reviewed
            </button>
            <button class="btn btn-success" onclick="updatePattern('${p.id}', 'implemented')">
              Mark Implemented
            </button>
            <button class="btn btn-danger" onclick="updatePattern('${p.id}', 'rejected')">
              Reject
            </button>
          </div>
        </li>
      `).join('');
    }

    async function updatePattern(patternId, status) {
      const reviewedBy = 'admin'; // TODO: Get from auth
      const notes = prompt('Add notes (optional):');
      
      await fetch('/admin/intent-analytics/update-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patternId, status, reviewedBy, notes }),
      });
      
      loadDashboard();
    }

    // Event listeners
    document.getElementById('tenantSelect').addEventListener('change', loadDashboard);
    document.querySelectorAll('.pattern-filters button').forEach(btn => {
      btn.addEventListener('click', () => {
        const status = btn.dataset.status;
        const tenantId = document.getElementById('tenantSelect').value || 'acme';
        loadPatterns(tenantId, status);
      });
    });

    // Initial load
    loadDashboard();
    
    // Auto-refresh every 30 seconds
    setInterval(loadDashboard, 30000);
  </script>
</body>
</html>
```

### Step 3.2: Add Link to Platform Admin (30 min)

**File**: `public/internal/platform-admin.html`

Add navigation link:
```html
<nav>
  <a href="/internal/intent-analytics.html">Intent Analytics</a>
</nav>
```

---

## Phase 4: Testing (5 hours)

### Step 4.1: Unit Tests (3 hours)

**File**: `test/unit/intent-analytics.service.spec.ts`

```typescript
describe('IntentAnalyticsService', () => {
  it('should log detection', async () => {
    await service.logDetection({
      tenantId: 'test',
      query: 'What is AAPL revenue?',
      detectedIntent: mockIntent,
      detectionMethod: 'regex',
      confidence: 0.9,
      success: true,
      latencyMs: 50,
    });
    // Verify log was created
  });

  it('should compute summary', async () => {
    const summary = await service.computeSummary(
      'test',
      new Date('2024-02-01'),
      new Date('2024-02-08'),
    );
    expect(summary.totalQueries).toBeGreaterThan(0);
  });

  it('should track failed patterns', async () => {
    // Log multiple failed queries with same pattern
    // Verify pattern is tracked
  });
});
```

**File**: `test/unit/intent-detector-llm.spec.ts`

```typescript
describe('IntentDetectorService - LLM Fallback', () => {
  it('should use regex for high confidence queries', async () => {
    const intent = await service.detectIntent('What is AAPL revenue?', 'test');
    expect(intent.confidence).toBeGreaterThan(0.7);
    // Verify analytics logged with method='regex'
  });

  it('should fallback to LLM for low confidence queries', async () => {
    const intent = await service.detectIntent('Tell me about Apple competitors', 'test');
    // Verify LLM was called
    // Verify analytics logged with method='llm'
  });

  it('should use generic fallback on LLM failure', async () => {
    // Mock LLM failure
    const intent = await service.detectIntent('invalid query', 'test');
    expect(intent.confidence).toBeLessThan(0.5);
    // Verify analytics logged with method='generic'
  });

  it('should calculate LLM cost correctly', async () => {
    // Test cost calculation
  });
});
```

**File**: `test/unit/intent-analytics.controller.spec.ts`

```typescript
describe('IntentAnalyticsController', () => {
  it('GET /admin/intent-analytics/realtime', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/intent-analytics/realtime?tenantId=test')
      .expect(200);
    
    expect(response.body.last24Hours).toBeDefined();
    expect(response.body.last7Days).toBeDefined();
  });

  it('GET /admin/intent-analytics/failed-patterns', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/intent-analytics/failed-patterns?tenantId=test&status=pending')
      .expect(200);
    
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('POST /admin/intent-analytics/update-pattern', async () => {
    await request(app.getHttpServer())
      .post('/admin/intent-analytics/update-pattern')
      .send({
        patternId: 'test-id',
        status: 'reviewed',
        reviewedBy: 'admin',
        notes: 'Test notes',
      })
      .expect(200);
  });
});
```

### Step 4.2: E2E Tests (2 hours)

**File**: `test/e2e/intent-analytics-dashboard.e2e-spec.ts`

```typescript
describe('Intent Analytics Dashboard E2E', () => {
  it('should display realtime metrics', async () => {
    await page.goto('http://localhost:3000/internal/intent-analytics.html');
    
    // Wait for metrics to load
    await page.waitForSelector('#totalQueries');
    
    const totalQueries = await page.$eval('#totalQueries', el => el.textContent);
    expect(totalQueries).not.toBe('-');
  });

  it('should load failed patterns', async () => {
    await page.goto('http://localhost:3000/internal/intent-analytics.html');
    
    // Click pending filter
    await page.click('button[data-status="pending"]');
    
    // Wait for patterns to load
    await page.waitForSelector('.pattern-item');
    
    const patterns = await page.$$('.pattern-item');
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('should update pattern status', async () => {
    await page.goto('http://localhost:3000/internal/intent-analytics.html');
    
    // Click mark reviewed button
    await page.click('.pattern-item button.btn-primary');
    
    // Verify pattern moved to reviewed
    await page.click('button[data-status="reviewed"]');
    await page.waitForSelector('.status-reviewed');
  });

  it('should switch tenants', async () => {
    await page.goto('http://localhost:3000/internal/intent-analytics.html');
    
    // Select different tenant
    await page.select('#tenantSelect', 'demo');
    
    // Verify metrics updated
    await page.waitForFunction(() => {
      return document.getElementById('totalQueries').textContent !== '-';
    });
  });
});
```

---

## Phase 5: Integration & Deployment (2 hours)

### Step 5.1: Apply Migration

```bash
node scripts/apply-intent-analytics-migration.js
```

### Step 5.2: Update Environment Variables

Add to `.env`:
```
# Intent Analytics
INTENT_ANALYTICS_ENABLED=true
INTENT_ANALYTICS_LOG_LEVEL=info
```

### Step 5.3: Run Tests

```bash
# Unit tests
npm run test:unit -- intent-analytics
npm run test:unit -- intent-detector-llm

# E2E tests
npm run test:e2e -- intent-analytics-dashboard
```

### Step 5.4: Manual Testing

1. Start server: `npm run start:dev`
2. Open dashboard: `http://localhost:3000/internal/intent-analytics.html`
3. Run test queries via RAG API
4. Verify metrics update in dashboard
5. Test pattern review workflow

---

## Success Criteria

### Backend
- ✅ LLM fallback implemented with Claude 3.5 Haiku
- ✅ Analytics logging works for all detection methods
- ✅ Failed patterns are tracked automatically
- ✅ Admin API endpoints return correct data

### Frontend
- ✅ Dashboard displays real-time metrics
- ✅ Failed patterns list loads correctly
- ✅ Pattern status updates work
- ✅ Tenant switching works

### Testing
- ✅ All unit tests pass (>90% coverage)
- ✅ All E2E tests pass
- ✅ Manual testing successful

### Performance
- ✅ Regex detection < 100ms
- ✅ LLM fallback < 3s
- ✅ LLM fallback rate < 20%
- ✅ Overall accuracy > 95%

---

## Next Steps

After Day 3-4 complete:
1. **Day 5**: Implement monitoring dashboard (Grafana/CloudWatch)
2. **Week 2**: Data backfill for top 10 tickers
3. **Production**: Deploy with monitoring

---

## Cost Estimates

### LLM Costs (Claude 3.5 Haiku)
- Input: $0.25 per 1M tokens
- Output: $1.25 per 1M tokens
- Estimated: ~$0.0001 per query
- At 20% fallback rate: ~$10-15/month for 100K queries

### Infrastructure
- PostgreSQL: Minimal (3 new tables)
- No additional services needed

---

## Rollback Plan

If issues arise:
1. Set `INTENT_ANALYTICS_ENABLED=false` in `.env`
2. Revert to regex-only detection
3. Analytics data preserved for later analysis

---

## Documentation

Update these files:
- `README.md` - Add intent analytics section
- `ARCHITECTURE_RAG_SYSTEM.md` - Document hybrid detection
- `.kiro/specs/rag-competitive-intelligence-extraction/PRODUCTION_READINESS_ASSESSMENT.md` - Mark Day 3-4 complete

