# 🎯 Admin Dashboard Ready for Testing

## Status: ✅ COMPLETE

The Intent Analytics Admin Dashboard is fully implemented and ready for testing.

---

## 🔐 Quick Access

### Dashboard URL
```
http://localhost:3000/internal/intent-analytics.html
```

### Admin Key (Local Development)
```
c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06
```

**First-time setup**:
1. Open the dashboard URL in your browser
2. You'll be prompted to enter the admin key
3. Paste the key above
4. Click OK - the key will be stored in localStorage
5. Dashboard will load automatically

---

## 🚀 Quick Start

### 1. Start the Server
```bash
npm run start:dev
```

### 2. Generate Test Data
```bash
node scripts/test-intent-analytics.js
```

### 3. Open Dashboard
Navigate to: `http://localhost:3000/internal/intent-analytics.html`

Enter admin key when prompted.

---

## 📊 What You'll See

### Metrics Cards (6 total)
1. **Total Queries** - Number of queries processed
2. **Regex Success Rate** - % of queries detected by regex (target: >80%)
3. **LLM Fallback Rate** - % of queries requiring LLM (target: <20%)
4. **Avg Confidence** - Average detection confidence (target: >85%)
5. **Avg Latency** - Average detection time (target: <500ms)
6. **LLM Cost** - Total LLM cost in USD

### Failed Patterns Section
- List of query patterns that failed detection
- Filter by status: All, Pending, Reviewed, Implemented, Rejected
- Action buttons to manage patterns
- Example queries for each pattern
- Occurrence counts

### Controls
- **Tenant Selector** - Switch between tenants (ACME, Demo, Test)
- **Period Selector** - View 24h or 7d metrics
- **Refresh Button** - Manual refresh
- **Auto-refresh** - Updates every 30 seconds

---

## 🧪 Test the Dashboard

### Test Pattern Management
1. Click "Pending" filter to see pending patterns
2. Click "Mark Reviewed" on a pattern
3. Enter notes (optional) and your name
4. Verify pattern moves to "Reviewed" status
5. Click "Mark Implemented" to complete the workflow

### Test Tenant Switching
1. Select "ACME Corp" from tenant dropdown
2. Note the metrics
3. Select "Demo Tenant"
4. Verify metrics update for the new tenant

### Test Period Switching
1. Select "Last 24 Hours"
2. Note the metrics
3. Select "Last 7 Days"
4. Verify metrics show 7-day aggregates

### Test Auto-Refresh
1. Wait 30 seconds
2. Check "Last refresh" timestamp updates
3. Verify metrics refresh automatically

---

## 🔍 API Testing

### Test with cURL

```bash
# Get real-time metrics
curl -X GET "http://localhost:3000/admin/intent-analytics/realtime?tenantId=acme" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"

# Get failed patterns
curl -X GET "http://localhost:3000/admin/intent-analytics/failed-patterns?tenantId=acme&status=pending" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"

# Update pattern status
curl -X POST "http://localhost:3000/admin/intent-analytics/update-pattern" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06" \
  -d '{
    "patternId": "uuid",
    "status": "reviewed",
    "reviewedBy": "Admin",
    "notes": "Test update"
  }'
```

---

## 🎨 Dashboard Features

### Color-Coded Metrics
- 🟢 **Green**: Metric meets target (good performance)
- 🟡 **Yellow**: Metric is acceptable but below target
- 🔴 **Red**: Metric is below acceptable threshold

### Pattern Status Badges
- **Pending** (yellow): New pattern, needs review
- **Reviewed** (blue): Pattern reviewed, awaiting implementation
- **Implemented** (green): Regex pattern added to code
- **Rejected** (red): Pattern rejected, won't implement

### Responsive Design
- Works on desktop and tablet
- Uses design system CSS for consistent styling
- Clean, professional interface

---

## 🔒 Security

### Authentication
- Protected by `PlatformAdminGuard`
- Requires `x-admin-key` header for API calls
- Admin key stored in `.env` file
- Key is hashed in memory (SHA-256)
- All access attempts are logged

### Production Security
- **NEVER** commit admin keys to version control
- Use AWS Secrets Manager for production keys
- Rotate keys regularly
- Monitor access logs for suspicious activity
- Use secondary key for key rotation

---

## 📈 Expected Metrics

### After Initial Testing (10-20 queries)
- Total Queries: 10-20
- Regex Success Rate: 70-80%
- LLM Fallback Rate: 15-25%
- Avg Confidence: 0.80-0.85
- Avg Latency: 200-500ms
- LLM Cost: $0.0001-$0.0005

### After Production Use (1000+ queries)
- Total Queries: 1000+
- Regex Success Rate: >80% (green)
- LLM Fallback Rate: <20% (green)
- Avg Confidence: >0.85 (green)
- Avg Latency: <300ms (green)
- LLM Cost: ~$0.02 per 1000 queries

---

## 🐛 Troubleshooting

### Dashboard doesn't load
1. Check server is running: `npm run start:dev`
2. Check browser console for errors
3. Verify URL is correct
4. Clear browser cache and try again

### Admin key not accepted
1. Verify key matches `.env` file
2. Check for extra spaces or line breaks
3. Clear localStorage and try again
4. Check server logs for authentication errors

### No metrics showing
1. Run test script: `node scripts/test-intent-analytics.js`
2. Verify database migration applied
3. Check database connection
4. Verify queries are being logged

### Patterns not updating
1. Check browser console for errors
2. Verify API endpoint is accessible
3. Check network tab for failed requests
4. Verify admin key is correct

---

## 📚 Related Documentation

- [Testing Guide](.kiro/specs/rag-competitive-intelligence-extraction/WEEK1_DAY3-4_TESTING_GUIDE.md)
- [Testing URLs](.kiro/specs/rag-competitive-intelligence-extraction/TESTING_URLS.md)
- [Backend Complete](.kiro/specs/rag-competitive-intelligence-extraction/WEEK1_DAY3-4_BACKEND_COMPLETE.md)
- [Implementation Complete](.kiro/specs/rag-competitive-intelligence-extraction/WEEK1_DAY3-4_IMPLEMENTATION_COMPLETE.md)

---

## ✅ Success Checklist

- [ ] Server started successfully
- [ ] Test script ran without errors
- [ ] Dashboard loads in browser
- [ ] Admin key accepted
- [ ] Metrics display correctly
- [ ] Failed patterns list shows data
- [ ] Pattern status updates work
- [ ] Tenant selector works
- [ ] Period selector works
- [ ] Auto-refresh works
- [ ] Manual refresh works
- [ ] API endpoints respond correctly

---

## 🎉 You're Ready!

The admin dashboard is fully functional and ready for use. You can now:

1. **Monitor** intent detection performance in real-time
2. **Review** failed query patterns
3. **Manage** pattern status (pending → reviewed → implemented)
4. **Track** LLM usage and costs
5. **Analyze** per-tenant performance

**Next Steps**:
- Monitor metrics for 24-48 hours
- Review failed patterns and add regex improvements
- Implement high-frequency patterns
- Deploy to production

---

**Last Updated**: February 4, 2026  
**Status**: Ready for Testing ✅  
**Admin Key**: Configured ✅  
**Dashboard**: Accessible ✅
