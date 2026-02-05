# 🎯 Intent Analytics - Quick Access Card

## 🔐 Admin Key
```
c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06
```

## 🌐 Dashboard URL
```
http://localhost:3000/internal/intent-analytics.html
```

## 🚀 Quick Start
```bash
# 1. Start server
npm run start:dev

# 2. Generate test data
node scripts/test-intent-analytics.js

# 3. Open dashboard
open http://localhost:3000/internal/intent-analytics.html
```

## 📊 API Endpoints

### Get Real-time Metrics
```bash
curl "http://localhost:3000/admin/intent-analytics/realtime?tenantId=acme" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"
```

### Get Failed Patterns
```bash
curl "http://localhost:3000/admin/intent-analytics/failed-patterns?tenantId=acme&status=pending" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"
```

### Update Pattern Status
```bash
curl -X POST "http://localhost:3000/admin/intent-analytics/update-pattern" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06" \
  -d '{
    "patternId": "uuid",
    "status": "reviewed",
    "reviewedBy": "Admin",
    "notes": "Will implement next sprint"
  }'
```

## 🎯 Target Metrics
- **Regex Success Rate**: >80% 🟢
- **LLM Fallback Rate**: <20% 🟢
- **Avg Confidence**: >85% 🟢
- **Avg Latency**: <500ms 🟢
- **LLM Cost**: <$50/month 💰

## 📁 Key Files
- **Backend**: `src/rag/intent-analytics.service.ts`
- **Controller**: `src/admin/intent-analytics.controller.ts`
- **Frontend**: `public/internal/intent-analytics.html`
- **Test Script**: `scripts/test-intent-analytics.js`
- **Migration**: `scripts/apply-intent-analytics-migration-simple.js`

## 🐛 Troubleshooting

### Dashboard won't load
```bash
# Check server is running
curl http://localhost:3000/health

# Check admin key
echo $PLATFORM_ADMIN_KEY

# Clear localStorage
# Open browser console: localStorage.clear()
```

### No metrics showing
```bash
# Run test script
node scripts/test-intent-analytics.js

# Check database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM intent_detection_logs;"
```

### Authentication fails
```bash
# Verify admin key in .env
grep PLATFORM_ADMIN_KEY .env

# Check server logs
tail -f logs/app.log | grep "Admin access"
```

## 📚 Documentation
- [Final Summary](WEEK1_DAY3-4_FINAL_SUMMARY.md)
- [Testing Guide](WEEK1_DAY3-4_TESTING_GUIDE.md)
- [Dashboard Ready](ADMIN_DASHBOARD_READY.md)
- [Visual Guide](DASHBOARD_VISUAL_GUIDE.md)
- [Testing URLs](TESTING_URLS.md)

## 💡 Quick Tips
1. **First time?** Enter admin key when prompted
2. **No data?** Run test script first
3. **Slow refresh?** Wait 30s for auto-refresh
4. **Need help?** Check troubleshooting section

---

**Status**: Ready for Testing ✅  
**Last Updated**: February 4, 2026
