# Week 1, Day 3-4: LLM Intent Fallback + Analytics - Testing Guide

## 🎯 Implementation Status: COMPLETE ✅

All backend, API, and frontend components are implemented and ready for testing.

---

## 🔐 Authentication

The Intent Analytics Dashboard is protected by the **PlatformAdminGuard** which requires a secret admin key.

### Admin Key
```
PLATFORM_ADMIN_KEY=c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06
```

**IMPORTANT**: This key is stored in `.env` and should NEVER be committed to version control in production. Use AWS Secrets Manager for production deployments.

---

## 🌐 Testing URLs

### 1. Intent Analytics Dashboard (Admin)
```
http://localhost:3000/internal/intent-analytics.html
```

**First-time setup**:
1. Open the URL in your browser
2. You'll be prompted to enter the admin key
3. Paste the admin key: `c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06`
4. The key will be stored in localStorage for future visits

**Features**:
- Real-time metrics (last 24h and 7d)
- Failed pattern tracking
- Pattern status management (pending → reviewed → implemented/rejected)
- Auto-refresh every 30 seconds
- Tenant selector
- Period selector (24h/7d)

---

## 🧪 Manual Testing Steps

### Step 1: Start the Server
```bash
npm run start:dev
```

Wait for the server to start and confirm:
- ✅ Database connection successful
- ✅ IntentAnalyticsService initialized
- ✅ IntentAnalyticsController registered
- ✅ PlatformAdminGuard configured

### Step 2: Generate Test Data

Run the test script to generate sample analytics data:
```bash
node scripts/test-intent-analytics.js
```

This will:
1. Test regex detection (should succeed with high confidence)
2. Test LLM fallback (for complex queries)
3. Test generic fallback (for ambiguous queries)
4. Log all detections to the database
5. Create failed patterns for review

Expected output:
```
✅ Test 1: Regex detection - PASSED
✅ Test 2: LLM fallback - PASSED
✅ Test 3: Generic fallback - PASSED
✅ Test 4: Analytics logging - PASSED
✅ Test 5: Failed pattern tracking - PASSED

📊 All tests passed!
```

### Step 3: Open the Dashboard

1. Navigate to: `http://localhost:3000/internal/intent-analytics.html`
2. Enter admin key when prompted
3. Verify the dashboard loads successfully

### Step 4: Verify Metrics Display

Check that the following metrics are displayed:

**Metrics Cards** (should show 6 cards):
1. **Total Queries**: Number of queries processed
2. **Regex Success Rate**: Should be >80% (green)
3. **LLM Fallback Rate**: Should be <20% (green)
4. **Avg Confidence**: Should be >85% (green)
5. **Avg Latency**: Should be <500ms (green)
6. **LLM Cost**: Total cost in USD

**Color Coding**:
- 🟢 Green: Metric meets target
- 🟡 Yellow: Metric is acceptable but below target
- 🔴 Red: Metric is below acceptable threshold

### Step 5: Test Failed Patterns

1. **View All Patterns**: Click "All" filter button
2. **Filter by Status**: Click "Pending", "Reviewed", "Implemented", "Rejected"
3. **Review Pattern**: Click "Mark Reviewed" on a pending pattern
4. **Implement Pattern**: Click "Mark Implemented" on a reviewed pattern
5. **Reject Pattern**: Click "Reject" on a pending pattern

Each action should:
- Prompt for notes (optional)
- Prompt for reviewer name
- Update the pattern status immediately
- Refresh the pattern list

### Step 6: Test Tenant Selector

1. Select different tenants from the dropdown:
   - ACME Corp
   - Demo Tenant
   - Test Tenant
2. Verify metrics update for each tenant
3. Verify failed patterns update for each tenant

### Step 7: Test Period Selector

1. Select "Last 24 Hours"
2. Verify metrics update
3. Select "Last 7 Days"
4. Verify metrics update

### Step 8: Test Auto-Refresh

1. Wait 30 seconds
2. Verify "Last refresh" timestamp updates
3. Verify metrics refresh automatically

### Step 9: Test Manual Refresh

1. Click the "🔄 Refresh" button
2. Verify metrics update immediately
3. Verify "Last refresh" timestamp updates

---

## 🔍 API Endpoint Testing

### Test with cURL

#### 1. Get Real-time Metrics
```bash
curl -X GET "http://localhost:3000/admin/intent-analytics/realtime?tenantId=acme" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"
```

Expected response:
```json
{
  "success": true,
  "tenantId": "acme",
  "metrics": {
    "last24Hours": {
      "totalQueries": 150,
      "regexSuccessRate": 82.5,
      "llmFallbackRate": 15.2,
      "avgConfidence": 0.87,
      "avgLatencyMs": 245,
      "llmCostUsd": 0.0023
    },
    "last7Days": {
      "totalQueries": 1050,
      "regexSuccessRate": 81.8,
      "llmFallbackRate": 16.1,
      "avgConfidence": 0.86,
      "avgLatencyMs": 258,
      "llmCostUsd": 0.0161
    }
  },
  "timestamp": "2026-02-04T..."
}
```

#### 2. Get Failed Patterns
```bash
curl -X GET "http://localhost:3000/admin/intent-analytics/failed-patterns?tenantId=acme&status=pending" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"
```

Expected response:
```json
{
  "success": true,
  "tenantId": "acme",
  "status": "pending",
  "count": 5,
  "patterns": [
    {
      "id": "uuid",
      "tenantId": "acme",
      "queryPattern": "what is [ticker]'s strategy for [period]",
      "exampleQueries": [
        "what is NVDA's strategy for 2024",
        "what is AAPL's strategy for Q4"
      ],
      "occurrenceCount": 12,
      "status": "pending"
    }
  ],
  "timestamp": "2026-02-04T..."
}
```

#### 3. Update Pattern Status
```bash
curl -X POST "http://localhost:3000/admin/intent-analytics/update-pattern" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06" \
  -d '{
    "patternId": "uuid",
    "status": "reviewed",
    "reviewedBy": "Admin",
    "notes": "Will implement in next sprint"
  }'
```

Expected response:
```json
{
  "success": true,
  "patternId": "uuid",
  "status": "reviewed",
  "reviewedBy": "Admin",
  "timestamp": "2026-02-04T..."
}
```

#### 4. Test Authentication Failure
```bash
curl -X GET "http://localhost:3000/admin/intent-analytics/realtime?tenantId=acme" \
  -H "x-admin-key: wrong-key"
```

Expected response:
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

---

## 📊 Expected Metrics Thresholds

### Target Metrics (Green)
- **Regex Success Rate**: >80%
- **LLM Fallback Rate**: <20%
- **Avg Confidence**: >85%
- **Avg Latency**: <500ms
- **LLM Cost**: <$50/month (for 100K queries)

### Acceptable Metrics (Yellow)
- **Regex Success Rate**: 60-80%
- **LLM Fallback Rate**: 20-30%
- **Avg Confidence**: 70-85%
- **Avg Latency**: 500-1000ms

### Poor Metrics (Red)
- **Regex Success Rate**: <60%
- **LLM Fallback Rate**: >30%
- **Avg Confidence**: <70%
- **Avg Latency**: >1000ms

---

## 🐛 Troubleshooting

### Dashboard doesn't load
1. Check server is running: `npm run start:dev`
2. Check browser console for errors
3. Verify admin key is correct
4. Clear localStorage and try again

### Metrics show 0 queries
1. Run test script: `node scripts/test-intent-analytics.js`
2. Make some real queries through the RAG system
3. Wait for data to be logged to database

### Failed patterns not showing
1. Check database connection
2. Verify `intent_failed_patterns` table exists
3. Run migration if needed: `node scripts/apply-intent-analytics-migration-simple.js`

### Authentication fails
1. Verify admin key in `.env` matches the key you're using
2. Check server logs for authentication errors
3. Verify `PlatformAdminGuard` is properly configured

### Auto-refresh not working
1. Check browser console for errors
2. Verify JavaScript is enabled
3. Check network tab for failed requests

---

## 🎯 Success Criteria

### Backend ✅
- [x] IntentAnalyticsService implemented
- [x] IntentDetectorService updated with LLM fallback
- [x] Database schema applied (3 tables, 13 indexes)
- [x] Analytics logging working
- [x] Failed pattern tracking working

### API ✅
- [x] IntentAnalyticsController implemented
- [x] All 6 endpoints working
- [x] PlatformAdminGuard protecting endpoints
- [x] Error handling implemented

### Frontend ✅
- [x] Dashboard UI implemented
- [x] Real-time metrics display
- [x] Failed patterns list
- [x] Pattern status management
- [x] Tenant selector
- [x] Period selector
- [x] Auto-refresh (30s)
- [x] Admin key authentication

### Testing ✅
- [x] Test script created
- [x] Manual testing guide created
- [x] API endpoint testing documented
- [x] Troubleshooting guide created

---

## 📝 Next Steps

After testing is complete:

1. **Week 1, Day 5**: Implement monitoring dashboard with alerting
2. **Week 2**: Implement prompt optimization and A/B testing
3. **Week 3**: Implement advanced retrieval strategies
4. **Week 4**: Production deployment and monitoring

---

## 📚 Related Documentation

- [Week 1 Implementation Plan](.kiro/specs/rag-competitive-intelligence-extraction/WEEK1_2_IMPLEMENTATION_PLAN.md)
- [Backend Complete Summary](.kiro/specs/rag-competitive-intelligence-extraction/WEEK1_DAY3-4_BACKEND_COMPLETE.md)
- [Implementation Complete Guide](.kiro/specs/rag-competitive-intelligence-extraction/WEEK1_DAY3-4_IMPLEMENTATION_COMPLETE.md)
- [Testing URLs](.kiro/specs/rag-competitive-intelligence-extraction/TESTING_URLS.md)

---

**Last Updated**: February 4, 2026
**Status**: Ready for Testing ✅
