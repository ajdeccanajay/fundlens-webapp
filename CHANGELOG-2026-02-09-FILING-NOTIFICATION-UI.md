# Changelog: Filing Notification UI — Feb 9, 2026

## Summary

Added filing notification bell and dropdown to the deal workspace header. Analysts now see real-time alerts when new SEC filings (10-K, 10-Q, 8-K) are detected for tickers in their deals.

## Changes

### New Files
- `public/css/filing-notifications.css` — Isolated CSS for bell, dropdown, badges, toast (namespaced `filing-notif-*` classes)

### Modified Files
- `public/app/deals/workspace.html`
  - Added CSS link for `filing-notifications.css` in `<head>`
  - Added notification bell button with unread count badge in header (before user profile menu)
  - Added dropdown panel with notification list, dismiss per-item, dismiss-all
  - Added toast notification element (fixed bottom-right) for new filing alerts
  - Added Alpine.js data properties: `filingNotifications`, `filingNotifCount`, `filingNotifOpen`, `filingNotifToast`
  - Added methods: `loadFilingNotifications()`, `startFilingNotifPolling()`, `dismissFilingNotif()`, `dismissAllFilingNotifs()`, `getFilingTypeBadgeClass()`, `formatFilingDate()`
  - Added `loadFilingNotifications()` and `startFilingNotifPolling()` calls in `init()`

## API Endpoints Used
- `GET /api/filings/notifications?dismissed=false&limit=20` — fetch notifications
- `DELETE /api/filings/notifications/:id` — dismiss individual notification

## Design Decisions
- 60-second polling interval (non-disruptive background check)
- All API calls fail silently — notifications are non-critical and won't break the workspace if the backend table doesn't exist yet
- Filing type badges are color-coded: blue (10-K), green (10-Q), amber (8-K)
- CSS is fully namespaced to avoid collisions with existing styles
- Toast auto-dismisses after 4 seconds

## Test Results
- 196 filing-related tests passing across 11 test suites (zero regressions)
- 39 unit tests (notification service + controller)
- 17 e2e tests (API endpoints + tenant isolation)
