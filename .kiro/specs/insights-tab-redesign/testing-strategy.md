# Insights Tab Redesign - Testing Strategy

## Testing Pyramid

```
                    ┌─────────────┐
                    │   E2E Tests │  (10%)
                    │   Playwright│
                    └─────────────┘
                  ┌───────────────────┐
                  │ Integration Tests │  (20%)
                  │   Jest + Supertest│
                  └───────────────────┘
              ┌─────────────────────────────┐
              │      Unit Tests             │  (70%)
              │      Jest                   │
              └─────────────────────────────┘
```

**Target Coverage:**
- Unit Tests: 80%+ coverage
- Integration Tests: All API endpoints
- E2E Tests: Critical user flows

---

## Unit Testing

### Services to Test

#### 1. AnomalyDetectionService
**File:** `test/unit/anomaly-detection.service.spec.ts`

**Test Cases:**
```typescript
describe('AnomalyDetectionService', () => {
  describe('detectStatisticalOutliers', () => {
    it('should detect values >2σ from mean', async () => {
      // Given: Historical data with outlier
      const metrics = [
        { period: 'FY2020', value: 100 },
        { period: 'FY2021', value: 105 },
        { period: 'FY2022', value: 110 },
        { period: 'FY2023', value: 115 },
        { period: 'FY2024', value: 200 }, // Outlier
      ];
      
      // When: Detect outliers
      const outliers = await service.detectStatisticalOutliers(dealId);
      
      // Then: Should detect FY2024 as outlier
      expect(outliers).toHaveLength(1);
      expect(outliers[0].period).toBe('FY2024');
      expect(outliers[0].severity).toBe('high');
    });

    it('should not detect values within 2σ', async () => {
      // Test normal variation
    });

    it('should handle missing data gracefully', async () => {
      // Test with null values
    });
  });

  describe('detectSequentialChanges', () => {
    it('should detect first increase in 4+ quarters', async () => {
      // Test streak detection
    });

    it('should detect first decrease in 4+ quarters', async () => {
      // Test reverse streak
    });

    it('should not detect short streaks (<4 quarters)', async () => {
      // Test threshold
    });
  });

  describe('detectToneShifts', () => {
    it('should detect 3x increase in keyword frequency', async () => {
      // Test keyword analysis
    });

    it('should ignore minor frequency changes', async () => {
      // Test threshold
    });
  });

  describe('prioritizeAnomalies', () => {
    it('should sort by severity then type', async () => {
      // Test sorting logic
    });
  });
});
```

See `testing-unit-tests.md` for complete unit test specifications.

---

## Integration Testing

### API Endpoints to Test

#### 1. Anomaly Detection Endpoints
**File:** `test/e2e/insights-anomalies.e2e-spec.ts`

**Test Cases:**
```typescript
describe('GET /api/deals/:dealId/insights/anomalies', () => {
  it('should return anomalies for valid deal', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/deals/${dealId}/insights/anomalies`)
      .expect(200);

    expect(response.body).toHaveProperty('anomalies');
    expect(response.body).toHaveProperty('summary');
    expect(response.body.anomalies).toBeInstanceOf(Array);
  });

  it('should filter by anomaly type', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/deals/${dealId}/insights/anomalies`)
      .query({ types: ['statistical_outlier'] })
      .expect(200);

    expect(response.body.anomalies.every(a => 
      a.type === 'statistical_outlier'
    )).toBe(true);
  });

  it('should filter by severity', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/deals/${dealId}/insights/anomalies`)
      .query({ severity: 'high' })
      .expect(200);

    expect(response.body.anomalies.every(a => 
      a.severity === 'high'
    )).toBe(true);
  });

  it('should return 404 for invalid deal', async () => {
    await request(app.getHttpServer())
      .get('/api/deals/99999/insights/anomalies')
      .expect(404);
  });

  it('should handle database errors gracefully', async () => {
    // Mock database failure
    // Expect 500 with error message
  });
});
```

See `testing-integration-tests.md` for complete integration test specifications.

---

## E2E Testing

### Critical User Flows

#### Flow 1: Anomaly Detection Workflow
**File:** `test/e2e/insights-anomaly-workflow.spec.ts`

**Scenario:**
```typescript
test('Analyst detects and investigates anomaly', async ({ page }) => {
  // 1. Navigate to Insights tab
  await page.goto('/app/deals/workspace.html?dealId=1');
  await page.click('[data-testid="insights-tab"]');
  
  // 2. Wait for anomalies to load
  await page.waitForSelector('[data-testid="anomaly-card"]');
  
  // 3. Verify anomalies displayed
  const anomalyCards = await page.$$('[data-testid="anomaly-card"]');
  expect(anomalyCards.length).toBeGreaterThan(0);
  
  // 4. Click first anomaly to expand
  await anomalyCards[0].click();
  
  // 5. Verify details shown
  await expect(page.locator('[data-testid="anomaly-description"]'))
    .toBeVisible();
  await expect(page.locator('[data-testid="anomaly-context"]'))
    .toBeVisible();
  
  // 6. Click "Research This" button
  await page.click('[data-testid="research-anomaly-btn"]');
  
  // 7. Verify Research Assistant opens with pre-filled question
  await expect(page.locator('[data-testid="research-query"]'))
    .toHaveValue(/Why did .+ change/);
  
  // 8. Dismiss anomaly
  await page.click('[data-testid="insights-tab"]');
  await page.click('[data-testid="dismiss-anomaly-btn"]');
  
  // 9. Verify anomaly dismissed
  await expect(anomalyCards[0]).toHaveClass(/dismissed/);
});
```

See `testing-e2e-tests.md` for complete E2E test specifications.

---

## Performance Testing

### Load Testing
```typescript
describe('Performance Tests', () => {
  it('should load anomalies in <1 second', async () => {
    const start = Date.now();
    await service.detectAnomalies(dealId);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(1000);
  });

  it('should handle 100 concurrent requests', async () => {
    const promises = Array(100).fill(null).map(() =>
      service.detectAnomalies(dealId)
    );
    
    await expect(Promise.all(promises)).resolves.toBeDefined();
  });
});
```

---

## Test Data Management

### Fixtures
```typescript
// test/fixtures/insights-test-data.ts
export const testDeal = {
  id: 1,
  ticker: 'TEST',
  name: 'Test Company',
  tenantId: 1,
};

export const testMetrics = [
  {
    dealId: 1,
    metricName: 'revenue',
    fiscalPeriod: 'FY2024',
    value: 50000000000,
    statementType: 'income_statement',
  },
  // ... more metrics
];

export const testAnomalies = [
  {
    id: 'outlier-revenue-FY2024',
    type: 'statistical_outlier',
    severity: 'high',
    metric: 'revenue',
    period: 'FY2024',
    value: 50000000000,
    expectedValue: 40000000000,
    deviation: 2.5,
  },
  // ... more anomalies
];
```

---

## Continuous Integration

### GitHub Actions Workflow
```yaml
name: Insights Tab Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:unit
      
      - name: Run integration tests
        run: npm run test:e2e
      
      - name: Run E2E tests
        run: npm run test:playwright
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

---

## Test Coverage Goals

| Component | Unit | Integration | E2E | Total |
|-----------|------|-------------|-----|-------|
| Anomaly Detection | 90% | 100% | 80% | 90% |
| Metric Explorer | 85% | 100% | 80% | 85% |
| Comp Table | 85% | 100% | 70% | 80% |
| Change Tracker | 80% | 100% | 70% | 80% |
| Hierarchy | 80% | 100% | 80% | 85% |
| **Overall** | **85%** | **100%** | **75%** | **85%** |

---

## Next Steps

1. Review testing strategy
2. Set up test infrastructure
3. Write tests alongside implementation
4. Run tests in CI/CD pipeline
5. Monitor coverage and quality metrics
