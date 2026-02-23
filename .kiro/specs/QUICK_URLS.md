# Quick Testing URLs

## IC Memo Generation (Fixed - Feb 8, 2026)

Test the streaming IC Memo generation:

```
http://localhost:3000/app/deals/workspace.html?ticker=NVDA
```

**Steps:**
1. Navigate to workspace
2. Add items to scratchpad (or use existing)
3. Click "IC Memo" tab
4. Click "Generate Memo"
5. Watch real-time status updates (2-5 minutes)
6. Verify memo is generated successfully

**Expected Status Updates:**
- "Gathering financial data..."
- "Gathering financial metrics..."
- "Building prompt..."
- "Generating memo (2-5 minutes)..."
- "Saving document..."
- "Complete!"

## Other Testing URLs

### Research Assistant (inside Workspace)
```
http://localhost:3000/app/deals/workspace.html?ticker=AAPL
```
The research assistant is the chat panel within the workspace — there is no separate research page.

### Deal Dashboard
```
http://localhost:3000/app/deals/index.html
```

### Workspace (Various Tickers)
```
http://localhost:3000/app/deals/workspace.html?ticker=AAPL
http://localhost:3000/app/deals/workspace.html?ticker=MSFT
http://localhost:3000/app/deals/workspace.html?ticker=NVDA
http://localhost:3000/app/deals/workspace.html?ticker=META
http://localhost:3000/app/deals/workspace.html?ticker=AMZN
```

### Admin Tools
```
http://localhost:3000/internal/index.html
http://localhost:3000/internal/intent-analytics.html
```

## Recent Fixes

- **Feb 8, 2026**: IC Memo streaming fix (no more 500 timeouts)
- **Feb 7, 2026**: Qualitative Analysis UI improvements
- **Feb 6, 2026**: Research Assistant sources fix
- **Feb 3, 2026**: Scratchpad data persistence
- **Feb 2, 2026**: Insights tab redesign
