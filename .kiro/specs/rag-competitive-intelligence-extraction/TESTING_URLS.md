# Intent Analytics Testing URLs

**Status**: Ready to test after implementation  
**Prerequisites**: 
1. Apply migration: `node scripts/apply-intent-analytics-migration.js`
2. Implement backend changes
3. Start server: `npm run start:dev`

---

## 🔐 Authentication

All admin endpoints are protected by **PlatformAdminGuard** and require the admin key.

**Admin Key** (for local testing):
```
c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06
```

**IMPORTANT**: This key is for local development only. In production, use AWS Secrets Manager.

Add the admin key to all API requests using the `x-admin-key` header:
```bash
-H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"
```

---

## Backend API Endpoints

### 1. Get Real-time Metrics
```bash
# Get last 24h/7d metrics for a tenant
curl http://localhost:3000/admin/intent-analytics/realtime?tenantId=acme \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"

# Expected response:
{
  "last24Hours": {
    "totalQueries": 150,
    "regexSuccessRate": 82.5,
    "llmFallbackRate": 15.2,
    "avgConfidence": 0.87,
    "avgLatencyMs": 245,
    "llmCostUsd": 0.0023
  },
  "last7Days": {
    "totalQueries": 1250,
    "regexSuccessRate": 81.8,
    "llmFallbackRate": 16.1,
    "avgConfidence": 0.86,
    "avgLatencyMs": 258,
    "llmCostUsd": 0.0201
  }
}
```

### 2. Get Analytics Summary
```bash
# Get aggregated summary for a period
curl "http://localhost:3000/admin/intent-analytics/summary?tenantId=acme&start=2024-02-01&end=2024-02-08" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"

# Expected response:
{
  "tenantId": "acme",
  "periodStart": "2024-02-01T00:00:00.000Z",
  "periodEnd": "2024-02-08T00:00:00.000Z",
  "totalQueries": 1250,
  "regexSuccessCount": 1023,
  "llmFallbackCount": 201,
  "genericFallbackCount": 26,
  "failedQueriesCount": 26,
  "avgConfidence": 0.86,
  "avgLatencyMs": 258,
  "totalLlmCostUsd": 0.0201,
  "topFailedPatterns": [
    { "query": "What are [TICKER]'s main products?", "count": 12 },
    { "query": "Tell me about [TICKER] strategy", "count": 8 }
  ]
}
```

### 3. Compute Summary (Manual Trigger)
```bash
# Compute summary for a period
curl -X POST http://localhost:3000/admin/intent-analytics/compute-summary \
  -H "Content-Type: application/json" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06" \
  -d '{
    "tenantId": "acme",
    "start": "2024-02-01",
    "end": "2024-02-08"
  }'

# Expected response:
{
  "tenantId": "acme",
  "periodStart": "2024-02-01T00:00:00.000Z",
  "periodEnd": "2024-02-08T00:00:00.000Z",
  "totalQueries": 1250,
  ...
}
```

### 4. Get Failed Patterns
```bash
# Get pending patterns
curl "http://localhost:3000/admin/intent-analytics/failed-patterns?tenantId=acme&status=pending" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"

# Expected response:
[
  {
    "id": "uuid-123",
    "tenantId": "acme",
    "queryPattern": "what are [ticker]'s main products?",
    "exampleQueries": [
      "What are AAPL's main products?",
      "What are MSFT's main products?",
      "What are NVDA's main products?"
    ],
    "occurrenceCount": 12,
    "suggestedRegex": null,
    "status": "pending",
    "reviewedBy": null,
    "reviewedAt": null,
    "notes": null
  }
]
```

### 5. Update Pattern Status
```bash
# Mark pattern as reviewed
curl -X POST http://localhost:3000/admin/intent-analytics/update-pattern \
  -H "Content-Type: application/json" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06" \
  -d '{
    "patternId": "uuid-123",
    "status": "reviewed",
    "reviewedBy": "admin@acme.com",
    "notes": "Will add regex pattern for product queries"
  }'

# Expected response:
{
  "success": true
}
```

---

## Frontend Dashboard

### Main Dashboard
```
http://localhost:3000/internal/intent-analytics.html
```

**Authentication**: Protected by admin key

**Admin Key** (for local testing):
```
c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06
```

**First-time setup**:
1. Open the dashboard URL
2. Enter the admin key when prompted
3. Key will be stored in localStorage for future visits

**What you'll see**:
- 6 metric cards (total queries, regex success rate, LLM fallback rate, avg confidence, avg latency, LLM cost)
- Failed patterns list with action buttons
- Tenant selector dropdown
- Auto-refresh every 30 seconds

**Test actions**:
1. Select different tenant from dropdown
2. Click "Pending" filter to see pending patterns
3. Click "Mark Reviewed" on a pattern
4. Click "Mark Implemented" on a pattern
5. Click "Reject" on a pattern
6. Verify metrics update after actions

---

## Test Queries (Generate Analytics Data)

### High Confidence Queries (Should use Regex)
```bash
# Test 1: Simple ticker + metric query
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is AAPL revenue in 2024?",
    "tenantId": "acme"
  }'

# Test 2: Competitor query
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Who are NVDA competitors?",
    "tenantId": "acme"
  }'

# Test 3: Revenue recognition query
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is AAPL revenue recognition policy?",
    "tenantId": "acme"
  }'
```

### Low Confidence Queries (Should use LLM Fallback)
```bash
# Test 4: Novel phrasing
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Tell me about Apple main product offerings",
    "tenantId": "acme"
  }'

# Test 5: Complex multi-part query
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How does Microsoft strategy compare to Google in cloud computing?",
    "tenantId": "acme"
  }'

# Test 6: Ambiguous query
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the key risks for tech companies?",
    "tenantId": "acme"
  }'
```

### Failed Queries (Should use Generic Fallback)
```bash
# Test 7: Invalid query
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "asdfasdf random text",
    "tenantId": "acme"
  }'

# Test 8: Non-financial query
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is the weather today?",
    "tenantId": "acme"
  }'
```

---

## Verification Steps

### Step 1: Verify Analytics Logging
```bash
# Run 10 test queries
for i in {1..10}; do
  curl -X POST http://localhost:3000/rag/query \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"What is AAPL revenue?\", \"tenantId\": \"acme\"}"
  sleep 1
done

# Check logs were created
curl "http://localhost:3000/admin/intent-analytics/realtime?tenantId=acme"

# Verify totalQueries increased by 10
```

### Step 2: Verify LLM Fallback
```bash
# Run query that should trigger LLM
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Tell me about Apple main products",
    "tenantId": "acme"
  }'

# Check metrics
curl "http://localhost:3000/admin/intent-analytics/realtime?tenantId=acme"

# Verify llmFallbackRate > 0
# Verify llmCostUsd > 0
```

### Step 3: Verify Failed Pattern Tracking
```bash
# Run same failed query 5 times
for i in {1..5}; do
  curl -X POST http://localhost:3000/rag/query \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"What are AAPL main products?\", \"tenantId\": \"acme\"}"
  sleep 1
done

# Check failed patterns
curl "http://localhost:3000/admin/intent-analytics/failed-patterns?tenantId=acme&status=pending"

# Verify pattern exists with occurrenceCount >= 5
```

### Step 4: Verify Pattern Status Update
```bash
# Get pattern ID from previous step
PATTERN_ID="uuid-from-previous-response"

# Update status
curl -X POST http://localhost:3000/admin/intent-analytics/update-pattern \
  -H "Content-Type: application/json" \
  -d "{
    \"patternId\": \"$PATTERN_ID\",
    \"status\": \"reviewed\",
    \"reviewedBy\": \"admin\",
    \"notes\": \"Test update\"
  }"

# Verify status changed
curl "http://localhost:3000/admin/intent-analytics/failed-patterns?tenantId=acme&status=reviewed"

# Verify pattern appears in reviewed list
```

### Step 5: Verify Multi-Tenant Isolation
```bash
# Run queries for tenant A
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is AAPL revenue?", "tenantId": "acme"}'

# Run queries for tenant B
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is MSFT revenue?", "tenantId": "demo"}'

# Check tenant A metrics
curl "http://localhost:3000/admin/intent-analytics/realtime?tenantId=acme"

# Check tenant B metrics
curl "http://localhost:3000/admin/intent-analytics/realtime?tenantId=demo"

# Verify metrics are separate
```

---

## Expected Metrics After Testing

After running all test queries above, you should see:

**Regex Success Rate**: ~70-80%
- High confidence queries use regex
- Novel phrasings trigger LLM

**LLM Fallback Rate**: ~15-20%
- Novel phrasings
- Complex queries
- Ambiguous queries

**Generic Fallback Rate**: ~5-10%
- Invalid queries
- Non-financial queries

**Average Confidence**: ~0.80-0.85
- Mix of high and low confidence

**Average Latency**:
- Regex: <100ms
- LLM: 1-3s
- Overall: 200-500ms

**LLM Cost**: ~$0.0001 per LLM query
- 20 queries × 20% fallback = 4 LLM calls
- 4 × $0.0001 = $0.0004

---

## Troubleshooting

### Issue: No metrics showing
**Check**:
1. Migration applied? `node scripts/apply-intent-analytics-migration.js`
2. Server running? `npm run start:dev`
3. Queries sent with `tenantId`?

### Issue: LLM fallback not working
**Check**:
1. AWS credentials configured?
2. Bedrock access enabled?
3. Claude 3.5 Haiku available in region?

### Issue: Dashboard not loading
**Check**:
1. File exists? `public/internal/intent-analytics.html`
2. Server serving static files?
3. Browser console for errors?

### Issue: Pattern status not updating
**Check**:
1. Pattern ID correct?
2. Admin authentication working?
3. Database connection OK?

---

## Performance Benchmarks

### Target Metrics (After 1000 Queries)

| Metric | Target | Acceptable | Poor |
|--------|--------|------------|------|
| Regex Success Rate | >80% | 70-80% | <70% |
| LLM Fallback Rate | <20% | 20-30% | >30% |
| Generic Fallback Rate | <5% | 5-10% | >10% |
| Avg Confidence | >0.85 | 0.75-0.85 | <0.75 |
| Avg Latency | <300ms | 300-500ms | >500ms |
| LLM Cost/1K queries | <$0.02 | $0.02-$0.05 | >$0.05 |

---

## Next Steps

1. **Run all test queries** to generate analytics data
2. **Open dashboard** to verify metrics display
3. **Test pattern workflow** (pending → reviewed → implemented)
4. **Monitor for 24 hours** to see real usage patterns
5. **Review failed patterns** and add regex improvements
6. **Deploy to production** once metrics look good

---

## Quick Test Script

Save this as `scripts/test-intent-analytics.sh`:

```bash
#!/bin/bash

echo "🧪 Testing Intent Analytics System"
echo ""

# Test 1: High confidence queries
echo "Test 1: High confidence queries (should use regex)..."
for i in {1..5}; do
  curl -s -X POST http://localhost:3000/rag/query \
    -H "Content-Type: application/json" \
    -d '{"query": "What is AAPL revenue?", "tenantId": "acme"}' > /dev/null
  echo "  Query $i sent"
done

# Test 2: Low confidence queries
echo ""
echo "Test 2: Low confidence queries (should use LLM)..."
for i in {1..3}; do
  curl -s -X POST http://localhost:3000/rag/query \
    -H "Content-Type: application/json" \
    -d '{"query": "Tell me about Apple products", "tenantId": "acme"}' > /dev/null
  echo "  Query $i sent"
done

# Test 3: Failed queries
echo ""
echo "Test 3: Failed queries (should use generic)..."
for i in {1..2}; do
  curl -s -X POST http://localhost:3000/rag/query \
    -H "Content-Type: application/json" \
    -d '{"query": "random invalid query", "tenantId": "acme"}' > /dev/null
  echo "  Query $i sent"
done

# Check metrics
echo ""
echo "📊 Checking metrics..."
curl -s "http://localhost:3000/admin/intent-analytics/realtime?tenantId=acme" | jq .

echo ""
echo "✅ Test complete! Open dashboard: http://localhost:3000/internal/intent-analytics.html"
```

Run with:
```bash
chmod +x scripts/test-intent-analytics.sh
./scripts/test-intent-analytics.sh
```

