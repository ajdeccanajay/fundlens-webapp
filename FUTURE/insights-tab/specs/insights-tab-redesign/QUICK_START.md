# Insights Tab Redesign - Quick Start Guide

## 🚀 Getting Started

This guide will help you start implementing the Insights tab redesign.

---

## 📚 Read First

1. **[README.md](./README.md)** - Project overview (5 min read)
2. **[requirements.md](./requirements.md)** - What we're building (15 min read)
3. **[design.md](./design.md)** - How we're building it (20 min read)

---

## 🛠️ Development Setup

### Prerequisites
```bash
# Ensure you have:
- Node.js 18+
- PostgreSQL running
- AWS credentials configured (for Bedrock)
```

### Install Dependencies
```bash
npm install
```

### Run Tests
```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:e2e

# E2E tests
npm run test:playwright

# All tests
npm test
```

### Start Development Server
```bash
npm run start:dev
```

---

## 📋 Implementation Checklist

### Phase 1: Week 1

#### Day 1-2: Anomaly Detection
- [ ] Create `src/deals/anomaly-detection.service.ts`
- [ ] Implement statistical outlier detection
- [ ] Implement sequential change detection
- [ ] Write unit tests
- [ ] Add API endpoints to `insights.controller.ts`

**Files to Create:**
```
src/deals/anomaly-detection.service.ts
test/unit/anomaly-detection.service.spec.ts
```

**Files to Modify:**
```
src/deals/insights.controller.ts
src/deals/deals.module.ts (add service to providers)
```

#### Day 3-4: Metric Explorer
- [ ] Create `src/deals/metric-explorer.service.ts`
- [ ] Implement metric selection logic
- [ ] Implement period comparison logic
- [ ] Write unit tests
- [ ] Add API endpoints

**Files to Create:**
```
src/deals/metric-explorer.service.ts
test/unit/metric-explorer.service.spec.ts
```

#### Day 5: Frontend Integration
- [ ] Add anomaly detection section to `workspace.html`
- [ ] Add metric explorer section
- [ ] Style with design system
- [ ] Write Playwright tests

**Files to Modify:**
```
public/app/deals/workspace.html
public/css/workspace-enhancements.css
test/e2e/insights-tab.e2e-spec.ts
```

---

## 🧪 Testing Workflow

### 1. Write Tests First (TDD)
```typescript
// test/unit/anomaly-detection.service.spec.ts
describe('AnomalyDetectionService', () => {
  it('should detect statistical outliers', async () => {
    // Arrange
    const metrics = createTestMetrics();
    
    // Act
    const anomalies = await service.detectStatisticalOutliers(dealId);
    
    // Assert
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('statistical_outlier');
  });
});
```

### 2. Implement Service
```typescript
// src/deals/anomaly-detection.service.ts
@Injectable()
export class AnomalyDetectionService {
  async detectStatisticalOutliers(dealId: number): Promise<Anomaly[]> {
    // Implementation
  }
}
```

### 3. Run Tests
```bash
npm run test:unit -- anomaly-detection.service.spec.ts
```

### 4. Add Integration Tests
```typescript
// test/e2e/insights-anomalies.e2e-spec.ts
describe('GET /api/deals/:dealId/insights/anomalies', () => {
  it('should return anomalies', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/deals/${dealId}/insights/anomalies`)
      .expect(200);
    
    expect(response.body.anomalies).toBeInstanceOf(Array);
  });
});
```

### 5. Add E2E Tests
```typescript
// test/e2e/insights-tab.e2e-spec.ts
test('should display anomalies', async ({ page }) => {
  await page.goto('/app/deals/workspace.html?dealId=1');
  await page.click('[data-testid="insights-tab"]');
  
  const anomalies = await page.$$('[data-testid="anomaly-card"]');
  expect(anomalies.length).toBeGreaterThan(0);
});
```

---

## 📝 Code Style Guide

### Service Pattern
```typescript
@Injectable()
export class MyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  async myMethod(param: string): Promise<Result> {
    try {
      this.logger.log(`Starting myMethod with ${param}`);
      
      // Implementation
      const result = await this.prisma.myTable.findMany();
      
      this.logger.log(`Completed myMethod: ${result.length} items`);
      return result;
      
    } catch (error) {
      this.logger.error(`Failed myMethod: ${error.message}`);
      throw new InternalServerErrorException('Operation failed');
    }
  }
}
```

### Controller Pattern
```typescript
@Controller('deals/:dealId/insights')
export class InsightsController {
  constructor(private readonly service: MyService) {}

  @Get('anomalies')
  async getAnomalies(
    @Param('dealId', ParseIntPipe) dealId: number,
    @Query('types') types?: string[],
  ): Promise<AnomalyResponse> {
    const anomalies = await this.service.detectAnomalies(dealId, types);
    return { anomalies, summary: this.calculateSummary(anomalies) };
  }
}
```

### Frontend Pattern (Alpine.js)
```javascript
function insightsTab() {
  return {
    // State
    anomalies: [],
    loading: false,
    error: null,
    
    // Lifecycle
    async init() {
      await this.loadAnomalies();
    },
    
    // Methods
    async loadAnomalies() {
      this.loading = true;
      this.error = null;
      
      try {
        const response = await fetch(`/api/deals/${this.dealId}/insights/anomalies`);
        const data = await response.json();
        this.anomalies = data.anomalies;
      } catch (error) {
        this.error = 'Failed to load anomalies';
        console.error(error);
      } finally {
        this.loading = false;
      }
    },
  };
}
```

---

## 🐛 Debugging Tips

### Backend Debugging
```bash
# Enable debug logging
DEBUG=* npm run start:dev

# Run specific test with logs
npm run test:unit -- --verbose anomaly-detection.service.spec.ts
```

### Frontend Debugging
```javascript
// Add to Alpine component
console.log('State:', this.$data);
console.log('Anomalies:', this.anomalies);
```

### Database Debugging
```typescript
// Enable Prisma query logging
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});
```

---

## 📊 Progress Tracking

### Daily Checklist
- [ ] Morning: Review tasks for the day
- [ ] Write tests first (TDD)
- [ ] Implement feature
- [ ] Run all tests
- [ ] Manual testing
- [ ] Code review
- [ ] Update task status
- [ ] Evening: Plan next day

### Weekly Checklist
- [ ] All tasks completed
- [ ] All tests passing
- [ ] Code reviewed and merged
- [ ] Documentation updated
- [ ] Demo to stakeholders
- [ ] Plan next week

---

## 🆘 Getting Help

### Common Issues

**Issue:** Tests failing with database errors  
**Solution:** Ensure PostgreSQL is running and DATABASE_URL is correct

**Issue:** Frontend not loading data  
**Solution:** Check browser console for errors, verify API endpoint

**Issue:** TypeScript errors  
**Solution:** Run `npm run build` to see all errors

### Resources
- **Slack:** #fundlens-insights
- **Documentation:** See [design.md](./design.md)
- **Code Examples:** See existing `insights.service.ts`

---

## ✅ Definition of Done

Before marking a task complete:

- [ ] Code written and follows style guide
- [ ] Unit tests written (80%+ coverage)
- [ ] Integration tests written
- [ ] E2E tests written (if applicable)
- [ ] Manual testing completed
- [ ] Code reviewed by peer
- [ ] Documentation updated
- [ ] PR approved and merged
- [ ] Deployed to staging
- [ ] QA sign-off

---

## 🎯 Success Criteria

### For Each Feature
- All tests passing
- No console errors
- Responsive design works
- Accessibility requirements met
- Performance targets met

### For Each Phase
- All features complete
- Demo to stakeholders
- Feedback incorporated
- Ready for next phase

---

## 📞 Contact

**Questions?** Ask in #fundlens-insights Slack channel

**Blockers?** Tag @tech-lead in Slack

**Bugs?** Create Jira ticket with FUND-XXX prefix

---

## 🎉 You're Ready!

Start with **Phase 1, Task 1.1: Anomaly Detection Service**

See [tasks.md](./tasks.md) for detailed task breakdown.

Good luck! 🚀
