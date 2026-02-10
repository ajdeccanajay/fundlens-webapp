# Quick Start: Automatic Filing Detection

## Overview

The automatic filing detection system monitors SEC filings for companies in your deals and notifies you when new filings are available.

## How It Works

1. **Daily Detection**: Every day at 6 AM ET, the system checks for new filings
2. **Automatic Processing**: New filings are downloaded, parsed, and stored
3. **Tenant Notifications**: You receive notifications for filings related to your deals
4. **Shared Data**: Filing data is shared across all tenants (no duplication)

## API Endpoints

### Get Your Notifications
```bash
GET /api/filings/notifications?dismissed=false&limit=50
```

**Response**:
```json
{
  "success": true,
  "count": 3,
  "notifications": [
    {
      "id": "notification-1",
      "tenantId": "your-tenant-id",
      "ticker": "AAPL",
      "filingType": "10-K",
      "filingDate": "2024-11-01T00:00:00Z",
      "reportDate": "2024-09-30T00:00:00Z",
      "accessionNumber": "0000320193-24-000123",
      "dismissed": false,
      "createdAt": "2024-11-02T06:15:00Z"
    }
  ]
}
```

### Get Notification Count
```bash
GET /api/filings/notifications/count
```

**Response**:
```json
{
  "success": true,
  "count": 3
}
```

### Dismiss a Notification
```bash
DELETE /api/filings/notifications/:id
```

**Response**:
```json
{
  "success": true,
  "message": "Notification dismissed"
}
```

### Manual Trigger (Admin Only)
```bash
POST /api/filings/detect
Content-Type: application/json

{
  "ticker": "AAPL"
}
```

**Response**:
```json
{
  "success": true,
  "result": {
    "ticker": "AAPL",
    "newFilings": 1,
    "errors": []
  }
}
```

### Run Full Detection (Admin Only)
```bash
POST /api/filings/run-detection
```

**Response**:
```json
{
  "success": true,
  "summary": {
    "totalTickers": 50,
    "totalNewFilings": 5,
    "successCount": 48,
    "errorCount": 2,
    "duration": 12500,
    "results": [...]
  }
}
```

## Frontend Integration

### Display Notification Badge
```javascript
// Fetch notification count
const response = await fetch('/api/filings/notifications/count', {
  headers: {
    'Authorization': `Bearer ${tenantToken}`
  }
});

const { count } = await response.json();

// Display badge with count
if (count > 0) {
  document.getElementById('notification-badge').textContent = count;
  document.getElementById('notification-badge').style.display = 'block';
}
```

### Display Notifications
```javascript
// Fetch notifications
const response = await fetch('/api/filings/notifications?dismissed=false&limit=10', {
  headers: {
    'Authorization': `Bearer ${tenantToken}`
  }
});

const { notifications } = await response.json();

// Render notifications
notifications.forEach(notification => {
  const html = `
    <div class="notification">
      <div class="notification-header">
        <strong>${notification.ticker}</strong> - ${notification.filingType}
      </div>
      <div class="notification-body">
        Filed: ${new Date(notification.filingDate).toLocaleDateString()}
      </div>
      <div class="notification-actions">
        <a href="/deals?ticker=${notification.ticker}">View Deal</a>
        <button onclick="dismissNotification('${notification.id}')">Dismiss</button>
      </div>
    </div>
  `;
  document.getElementById('notifications-list').innerHTML += html;
});
```

### Dismiss Notification
```javascript
async function dismissNotification(notificationId) {
  await fetch(`/api/filings/notifications/${notificationId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${tenantToken}`
    }
  });
  
  // Refresh notifications
  loadNotifications();
}
```

### Poll for New Notifications
```javascript
// Poll every 5 minutes
setInterval(async () => {
  const response = await fetch('/api/filings/notifications/count', {
    headers: {
      'Authorization': `Bearer ${tenantToken}`
    }
  });
  
  const { count } = await response.json();
  
  // Update badge
  document.getElementById('notification-badge').textContent = count;
  
  // Show toast if new notifications
  if (count > previousCount) {
    showToast(`${count - previousCount} new filing(s) available`);
  }
  
  previousCount = count;
}, 5 * 60 * 1000); // 5 minutes
```

## Database Schema

### filing_detection_state
Tracks last check per ticker (shared, no tenant_id)

```sql
CREATE TABLE filing_detection_state (
  ticker VARCHAR(20) PRIMARY KEY,
  last_check_date TIMESTAMP NOT NULL DEFAULT NOW(),
  last_filing_date TIMESTAMP,
  check_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### filing_notifications
Tenant-scoped notifications

```sql
CREATE TABLE filing_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticker VARCHAR(20) NOT NULL,
  filing_type VARCHAR(10) NOT NULL,
  filing_date DATE NOT NULL,
  report_date DATE,
  accession_number VARCHAR(50) NOT NULL,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_filing_notifs_tenant ON filing_notifications(tenant_id, dismissed);
CREATE INDEX idx_filing_notifs_ticker ON filing_notifications(ticker);
CREATE INDEX idx_filing_notifs_created ON filing_notifications(created_at);
```

## Configuration

### Environment Variables

```bash
# SEC API User Agent (required by SEC)
SEC_USER_AGENT="FundLensAI/1.0 (contact: you@example.com)"

# Python Parser URL (for metrics extraction)
PYTHON_PARSER_URL="http://localhost:8000"

# Database connection
DATABASE_URL="postgresql://user:password@localhost:5432/fundlens"
```

### Cron Schedule

The detection job runs daily at 6 AM ET. To change the schedule, modify the `@Cron` decorator in `filing-detection-scheduler.service.ts`:

```typescript
@Cron('0 6 * * *', { timeZone: 'America/New_York' })
async runDailyDetection(): Promise<DetectionSummary> {
  // ...
}
```

## Monitoring

### Logs

The system logs all detection runs:

```
[FilingDetectionScheduler] Starting daily filing detection...
[FilingDetectionScheduler] Checking 50 tickers for new filings
[FilingDetectionScheduler] Detecting new filings for AAPL...
[SECSyncService] Syncing AAPL 10-K...
[SECSyncService] Last sync: 2024-10-01T00:00:00Z
[SECSyncService] Sync complete: 1 new, 5 skipped, 0 errors
[SECProcessingService] Processing AAPL 10-K 0000320193-24-000123...
[SECProcessingService] Processing complete: 10 metrics, 5 narratives (1000ms)
[FilingNotificationService] Creating notifications for AAPL 10-K for 3 tenants
[FilingDetectionScheduler] Detection complete: 5 new filings found in 12500ms
```

### Metrics

Track these metrics in CloudWatch:
- `detection_duration`: Time to complete detection run
- `new_filings_count`: Number of new filings detected
- `processing_success_rate`: % of filings processed successfully
- `notification_count`: Number of notifications created
- `error_count`: Number of errors during detection

### Alerts

Set up alerts for:
- Detection job failures (>3 consecutive failures)
- Processing backlog (>10 unprocessed filings)
- Rate limit errors (>5 per hour)
- High error rate (>10% of tickers failing)

## Troubleshooting

### No notifications appearing

1. Check if deals exist for the ticker:
   ```sql
   SELECT * FROM deals WHERE ticker = 'AAPL';
   ```

2. Check if filings were detected:
   ```sql
   SELECT * FROM filing_detection_state WHERE ticker = 'AAPL';
   ```

3. Check if filings were processed:
   ```sql
   SELECT * FROM data_sources 
   WHERE type = 'sec_filing' 
   AND metadata->>'ticker' = 'AAPL'
   AND metadata->>'processed' = 'true';
   ```

4. Check if notifications were created:
   ```sql
   SELECT * FROM filing_notifications 
   WHERE ticker = 'AAPL' 
   AND tenant_id = 'your-tenant-id';
   ```

### Detection not running

1. Check if scheduler is enabled:
   ```bash
   # Look for log message at startup
   grep "FilingDetectionScheduler" logs/app.log
   ```

2. Manually trigger detection:
   ```bash
   curl -X POST http://localhost:3000/api/filings/run-detection \
     -H "Authorization: Bearer <admin-token>"
   ```

### Processing failures

1. Check Python parser is running:
   ```bash
   curl http://localhost:8000/health
   ```

2. Check S3 access:
   ```bash
   aws s3 ls s3://fundlens-data-lake/public/sec-filings/
   ```

3. Check database connectivity:
   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   ```

## Best Practices

1. **Monitor detection runs**: Check logs daily to ensure detection is running
2. **Set up alerts**: Get notified of failures immediately
3. **Test with small set**: Start with 5-10 tickers before scaling
4. **Rate limit compliance**: Never exceed 10 req/sec to SEC
5. **Tenant isolation**: Always verify tenant ownership before operations
6. **Error handling**: Log all errors with context for debugging
7. **Performance**: Monitor processing time and optimize if needed

## Support

For issues or questions:
1. Check logs: `logs/app.log`
2. Check database: `psql $DATABASE_URL`
3. Check S3: `aws s3 ls s3://fundlens-data-lake/`
4. Contact: support@fundlens.ai
