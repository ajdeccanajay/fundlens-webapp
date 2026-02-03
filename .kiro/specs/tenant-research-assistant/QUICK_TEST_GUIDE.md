# Quick Test Guide - Research Assistant

**TL;DR**: Run automated tests instead of manual testing!

---

## Quick Start

```bash
# 1. Install dependencies (one-time)
npm install
npx playwright install chromium

# 2. Run backend tests (30 tests, <1 second)
npm test -- test/unit/research-assistant.service.spec.ts

# 3. Run frontend tests (21 tests, ~2 minutes)
npm run test:e2e:frontend

# 4. View test report
npx playwright show-report
```

---

## What Gets Tested?

### Backend (30 tests)
- ✅ Conversation CRUD operations
- ✅ Tenant isolation (security)
- ✅ User isolation
- ✅ Message streaming
- ✅ Attack prevention
- ✅ Ticker extraction

### Frontend (21 tests)
- ✅ Page load and initialization
- ✅ Conversation management (create, list, select, pin, delete)
- ✅ Message sending (button, Enter key, Shift+Enter)
- ✅ Welcome screen quick queries
- ✅ Markdown rendering
- ✅ Responsive design (mobile, tablet)
- ✅ Error handling

### Browsers Tested
- ✅ Chrome (Desktop)
- ✅ Firefox (Desktop)
- ✅ Safari (Desktop)
- ✅ Chrome (Mobile - Pixel 5)
- ✅ Safari (Mobile - iPhone 12)

---

## Interactive Testing

### UI Mode (Recommended for Development)

```bash
npm run test:e2e:frontend:ui
```

This opens an interactive UI where you can:
- See all tests
- Run individual tests
- Watch tests execute in real-time
- Inspect DOM at each step
- View network requests

### Debug Mode

```bash
npm run test:e2e:frontend:debug
```

Step through tests line by line with Playwright Inspector.

### Headed Mode

```bash
npm run test:e2e:frontend:headed
```

See the browser while tests run (useful for understanding failures).

---

## Common Commands

```bash
# Run specific test
npx playwright test -g "should create new conversation"

# Run specific browser
npx playwright test --project=chromium

# Run with retries
npx playwright test --retries=2

# Generate HTML report
npx playwright show-report

# Update snapshots
npx playwright test --update-snapshots
```

---

## Test Results

### Expected Output

```
Running 21 tests using 1 worker

  ✓ Page Load and Initialization (5/5)
  ✓ Conversation Management (6/6)
  ✓ Message Sending (4/4)
  ✓ Welcome Screen Quick Queries (1/1)
  ✓ Markdown Rendering (1/1)
  ✓ Responsive Design (2/2)
  ✓ Error Handling (2/2)

  21 passed (2m 15s)
```

### If Tests Fail

1. Check if backend is running: `npm run start:dev`
2. View the HTML report: `npx playwright show-report`
3. Check screenshots in `test-results/`
4. Run in debug mode: `npm run test:e2e:frontend:debug`

---

## Time Comparison

| Method | Time | Browsers | Consistency |
|--------|------|----------|-------------|
| Manual Testing | 50 min | 1 | Variable |
| Automated Testing | 3 min | 5 | 100% |
| **Time Saved** | **47 min** | **+4 browsers** | **Perfect** |

---

## CI/CD Integration

Tests run automatically on:
- Every commit
- Every pull request
- Before deployment

No manual testing required!

---

## Need Help?

- **Full Guide**: See `FRONTEND_TESTING_GUIDE.md`
- **Test Summary**: See `TESTING_SUMMARY.md`
- **Playwright Docs**: https://playwright.dev

---

**Created**: January 26, 2026
**Status**: Ready to Use ✅
