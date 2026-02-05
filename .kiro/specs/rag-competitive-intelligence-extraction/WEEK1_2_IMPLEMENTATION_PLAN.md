# Week 1-2 Implementation Plan: Production Hardening

**Goal**: Complete critical enhancements to reach 100% production readiness  
**Timeline**: 10 business days  
**Priority**: P0 (Blocking production deployment)

---

## Week 1: Production Hardening

### Day 1-2: Prompt Versioning System

**Objective**: Enable prompt updates without code deployment

**Tasks**:

1. **Create database schema** (1 hour)
```sql
CREATE TABLE prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL,
  intent_type VARCHAR(50) NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  active BOOLEAN DEFAULT true,
  performance_metrics JSONB,
  UNIQUE(intent_type, version)
);

CREATE INDEX idx_prompt_templates_active ON prompt_templates(intent_type, active);
```

2. **Implement PromptLibraryService** (4 hours)
```typescript
// src/rag/prompt-library.service.ts
@Injectable()
export class PromptLibraryService {
  async getPrompt(intentType: string, version?: number): Promise<PromptTemplate>
  async createPrompt(intentType: string, systemPrompt: string): Promise<PromptTemplate>
  async updatePrompt(intentType: string, newPrompt: string): Promise<PromptTemplate>
  async rollbackPrompt(intentType: string, toVersion: number): Promise<void>
  async trackPerformance(promptId: string, metrics: any): Promise<void>
}
```

3. **Migrate existing prompts** (2 hours)
- Extract current prompts from `bedrock.service.ts`
- Insert into database as version 1.0
- Create intent-specific prompts (competitive, mda, footnote, general)

4. **Update BedrockService** (2 hours)
- Replace hardcoded prompts with database lookups
- Add prompt version to response metadata
- Add fallback to default prompt if database unavailable

5. **Testing** (2 hours)
- Test prompt retrieval
- Test prompt versioning
- Test rollback functionality
- Test performance tracking

**Deliverables**:
- ✅ `prompt_templates` table created
- ✅ `PromptLibraryService` implemented
- ✅ All prompts migrated to database
- ✅ BedrockService updated
- ✅ Tests passing

---

### Day 3-4: LLM Intent Fallback

**Objective**: Handle novel query phrasings with 95%+ accuracy

**Tasks**:

1. **Add detectWithLLM method** (3 hours)
```typescript
// src/rag/intent-detector.service.ts
private async detectWithLLM(query: string): Promise<QueryIntent> {
  const prompt = `Extract structured intent from this financial query:
Query: "${query}"

Return JSON with:
- ticker: string or array of tickers
- metrics: array of metric names
- sectionTypes: array of section types (item_1, item_7, item_8, item_1a)
- subsectionName: specific subsection if mentioned
- confidence: 0.0 to 1.0

Examples:
"Who are NVDA's competitors?" → { ticker: "NVDA", sectionTypes: ["item_1"], subsectionName: "Competition", confidence: 0.9 }
"What is AAPL's revenue recognition policy?" → { ticker: "AAPL", sectionTypes: ["item_8"], subsectionName: "Revenue Recognition", confidence: 0.85 }
`;

  const response = await this.bedrock.invokeClaude({ prompt, max_tokens: 500 });
  return this.parseL
LMResponse(response);
}
```

2. **Implement hybrid detection logic** (2 hours)
```typescript
async detectIntent(query: string): Promise<QueryIntent> {
  // 1. Try regex first (fast path)
  const regexIntent = this.detectWithRegex(query);
  if (regexIntent.confidence > 0.7) {
    this.logger.log('✅ Regex detection succeeded');
    return regexIntent;
  }
  
  // 2. Fallback to LLM
  this.logger.log('⚠️ Regex confidence low, falling back to LLM');
  const llmIntent = await this.detectWithLLM(query);
  if (llmIntent.confidence > 0.6) {
    this.logger.log('✅ LLM detection succeeded');
    return llmIntent;
  }
  
  // 3. Final fallback
  this.logger.log('⚠️ LLM confidence low, using generic detection');
  return this.detectGeneric(query);
}
```

3. **Add LLM usage monitoring** (1 hour)
- Log all LLM fallback events
- Track LLM usage cost
- Monitor LLM latency

4. **Testing** (3 hours)
- Test with 50+ diverse queries
- Test novel phrasings
- Test multi-intent queries
- Measure accuracy improvement (target: 80% → 95%)

**Deliverables**:
- ✅ `detectWithLLM()` implemented
- ✅ Hybrid detection logic working
- ✅ LLM usage monitoring in place
- ✅ Accuracy improved to 95%+

---

### Day 5: Monitoring Dashboard

**Objective**: Visualize system health and performance

**Tasks**:

1. **Set up Grafana/CloudWatch** (2 hours)
- Create dashboard
- Configure data sources
- Set up refresh intervals

2. **Add key metrics** (3 hours)
- Intent detection success rate (by method: regex vs LLM)
- Retrieval success rate (by ticker)
- Average confidence scores
- Latency p50, p95, p99
- Fallback chain usage frequency
- Multi-ticker query count
- Error rates by type

3. **Configure alerts** (2 hours)
- Alert when intent detection success rate < 90%
- Alert when retrieval success rate < 95%
- Alert when latency p95 > 5s
- Alert on multi-ticker mixing incidents
- Alert when LLM fallback usage > 30%

4. **Testing** (1 hour)
- Verify all metrics updating
- Test alert triggering
- Document dashboard usage

**Deliverables**:
- ✅ Monitoring dashboard operational
- ✅ All key metrics visible
- ✅ Alerts configured and tested
- ✅ Documentation complete

---

## Week 2: Data Backfill

### Day 1-3: Backfill Top 10 Tickers

**Objective**: Ensure subsection data available for most-queried tickers

**Tickers to Backfill**:
1. AAPL (Apple)
2. MSFT (Microsoft)
3. GOOGL (Alphabet/Google)
4. AMZN (Amazon)
5. TSLA (Tesla)
6. META (Meta/Facebook)
7. NVDA (Nvidia) - ✅ Already done
8. JPM (JPMorgan Chase)
9. BAC (Bank of America)
10. WFC (Wells Fargo)

**Tasks**:

1. **Run backfill script for each ticker** (6 hours total)
```bash
# For each ticker
node scripts/backfill-ticker-subsections.js AAPL
node scripts/backfill-ticker-subsections.js MSFT
# ... etc
```

Expected results per ticker:
- ~500-1000 chunks updated with subsections
- ~30-40% of chunks get subsection_name
- Item 1 (Business): ~40-50% coverage
- Item 7 (MD&A): ~35-45% coverage
- Item 8 (Financial Statements): ~25-35% coverage
- Item 1A (Risk Factors): ~30-40% coverage

2. **Verify subsection identification** (3 hours)
- Spot-check 10 chunks per ticker
- Verify subsection names are accurate
- Check for any parsing errors
- Document ticker-specific issues

3. **Create backfill summary report** (1 hour)
```
Ticker | Total Chunks | Updated | % Coverage | Issues
-------|--------------|---------|------------|-------
AAPL   | 2,450        | 892     | 36.4%      | None
MSFT   | 2,180        | 765     | 35.1%      | None
...
```

**Deliverables**:
- ✅ 9 tickers backfilled (NVDA already done)
- ✅ ~7,000-9,000 chunks updated total
- ✅ Verification complete
- ✅ Summary report created

---

### Day 4-5: Bedrock KB Sync

**Objective**: Sync all backfilled chunks to Bedrock KB

**Tasks**:

1. **Export chunks to S3** (2 hours)
```bash
# For each ticker
node scripts/sync-ticker-to-kb.js AAPL
node scripts/sync-ticker-to-kb.js MSFT
# ... etc
```

2. **Monitor Bedrock KB ingestion** (4 hours)
- Check ingestion job status
- Verify metadata indexing
- Monitor for failures
- Retry failed chunks

3. **Verify metadata filtering** (2 hours)
- Test subsection filtering for each ticker
- Verify ticker isolation
- Check fallback chains work

4. **Run end-to-end tests** (3 hours)
```bash
# Test each ticker
node scripts/test-ticker-subsection-retrieval.js AAPL
node scripts/test-ticker-subsection-retrieval.js MSFT
# ... etc
```

Test queries per ticker:
- Competitive intelligence query
- MD&A query
- Footnote query
- Multi-ticker comparison query

5. **Document issues** (1 hour)
- Note any ticker-specific problems
- Document workarounds
- Create tickets for future fixes

**Deliverables**:
- ✅ All 10 tickers synced to Bedrock KB
- ✅ Metadata filtering verified
- ✅ End-to-end tests passing (50/50 tests)
- ✅ Issues documented

---

## Success Criteria

### Week 1 Complete When:
- ✅ Prompt versioning system operational
- ✅ LLM intent fallback implemented
- ✅ Intent detection accuracy > 95%
- ✅ Monitoring dashboard showing all metrics
- ✅ Alerts configured and tested

### Week 2 Complete When:
- ✅ Top 10 tickers backfilled
- ✅ All chunks synced to Bedrock KB
- ✅ End-to-end tests passing for all tickers
- ✅ No critical issues blocking production

### Production Ready When:
- ✅ All Week 1 deliverables complete
- ✅ All Week 2 deliverables complete
- ✅ Rollback procedures documented
- ✅ Stakeholder sign-off obtained

---

## Risk Mitigation

### Risk 1: LLM Fallback Too Slow
**Mitigation**: 
- Set timeout to 3 seconds
- Fall back to generic detection if timeout
- Monitor LLM latency closely

### Risk 2: Backfill Script Failures
**Mitigation**:
- Run backfill in batches (100 chunks at a time)
- Implement retry logic
- Log all failures for manual review

### Risk 3: Bedrock KB Ingestion Delays
**Mitigation**:
- Monitor ingestion jobs every 30 minutes
- Have manual sync procedure ready
- Document troubleshooting steps

### Risk 4: Monitoring Dashboard Issues
**Mitigation**:
- Have backup logging to CloudWatch
- Document manual metric queries
- Test dashboard before Week 2

---

## Resource Requirements

### Engineering Time
- Senior Engineer: 10 days (full-time)
- QA Engineer: 3 days (testing)
- DevOps Engineer: 2 days (monitoring setup)

### Infrastructure
- PostgreSQL: Additional table (minimal cost)
- Bedrock KB: Ingestion for ~20,000 chunks (~$50)
- Claude Haiku: LLM fallback (~$10/day estimated)
- Monitoring: Grafana/CloudWatch (existing infrastructure)

### Total Estimated Cost
- Engineering: ~$15,000 (2 weeks)
- Infrastructure: ~$200
- **Total: ~$15,200**

---

## Post-Week 2 Checklist

Before production deployment:

- [ ] All Week 1 deliverables complete
- [ ] All Week 2 deliverables complete
- [ ] Full test suite passing (unit + integration + E2E)
- [ ] Monitoring dashboard operational
- [ ] Alerts tested and working
- [ ] Rollback procedures documented
- [ ] Stakeholder demo completed
- [ ] Production deployment plan approved
- [ ] On-call rotation scheduled
- [ ] Incident response plan ready

---

## Next Steps After Week 2

1. **Week 3: Production Deployment**
   - Day 1: Pre-deployment validation
   - Day 2-3: 10% rollout
   - Day 4-5: 100% rollout

2. **Week 4+: Phase 3 Planning**
   - Evaluate Phase 2 performance
   - Prioritize Phase 3 features
   - Plan reranking implementation

3. **Ongoing: Monitoring and Optimization**
   - Collect user feedback
   - Analyze failed queries
   - Refine prompts based on data
   - A/B test improvements
