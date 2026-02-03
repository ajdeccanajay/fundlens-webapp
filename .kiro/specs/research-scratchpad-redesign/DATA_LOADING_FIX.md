# Data Loading Fix - Research Scratchpad

## Issue
The scratchpad tab was not displaying any saved items because of a data format mismatch between the old notebook API and the new scratchpad UI structure.

## Root Cause
The `loadScratchpad()` function in `workspace.html` was loading data from the old notebook API format:
```javascript
{
  id: "...",
  content: "simple text string",
  notes: "...",
  timestamp: "...",
  tags: []
}
```

But the new scratchpad UI expected structured data:
```javascript
{
  id: "...",
  workspaceId: "...",
  type: "direct_answer" | "revenue_framework" | "trend_analysis" | "provocation",
  content: {
    text: "...",           // for direct_answer
    sourceCount: 3,
    // OR
    pointInTime: [...],    // for revenue_framework
    overTime: [...],
    // OR
    metric: "...",         // for trend_analysis
    data: [...]
    // OR
    question: "..."        // for provocation
  },
  sources: [...],
  savedAt: "...",
  metadata: {...}
}
```

## Solution Implemented

### 1. Updated `loadScratchpad()` Function
Modified the function in `public/app/deals/workspace.html` to:
- **First try** the new scratchpad API endpoint: `/api/research/scratchpad/:workspaceId`
- **Fallback** to old notebook API if new endpoint not available
- **Map** old notebook data to new scratchpad format with default type `direct_answer`

```javascript
async loadScratchpad() {
  // Try new API first
  const scratchpadResponse = await fetch(`/api/research/scratchpad/${workspaceId}`);
  if (scratchpadResponse.ok) {
    const data = await scratchpadResponse.json();
    this.scratchpadItems = data.items || [];
    return;
  }
  
  // Fallback to old API with data mapping
  // ... maps old format to new format
}
```

### 2. Applied Database Migration
Created and applied the `scratchpad_items` table migration:
- Table: `scratchpad_items`
- Columns: id, workspace_id, type, content (JSONB), sources (JSONB), saved_at, saved_from (JSONB), metadata (JSONB)
- Indexes: workspace_id, saved_at, type
- Script: `scripts/apply-scratchpad-migration.js`

### 3. Added Sample Data
Created sample scratchpad items for testing:
- Direct Answer: Revenue recognition explanation
- Revenue Framework: Apple product categories (point-in-time vs over-time)
- Trend Analysis: Apple revenue 2021-2023 with YoY changes
- Provocation: Strategic question about services margins
- Script: `scripts/add-sample-scratchpad-items.js`

## Testing

### Manual Testing Steps
1. Start the backend server: `npm run start:dev`
2. Open workspace: `http://localhost:3000/app/deals/workspace.html?dealId=00000000-0000-0000-0000-000000000001`
3. Click on "Scratchpad" tab in left navigation
4. Verify 4+ sample items are displayed with proper formatting:
   - Direct Answer shows text with confidence badge
   - Revenue Framework shows two-column layout with product tags
   - Trend Analysis shows bar chart with YoY changes
   - Provocation shows lightbulb icon with question

### API Testing
Test the new endpoint directly:
```bash
curl http://localhost:3000/api/research/scratchpad/00000000-0000-0000-0000-000000000001 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected response:
```json
{
  "items": [
    {
      "id": "...",
      "workspaceId": "...",
      "type": "direct_answer",
      "content": { "text": "...", "sourceCount": 3 },
      "sources": [...],
      "savedAt": "2026-02-03T..."
    },
    ...
  ],
  "totalCount": 4
}
```

## Files Modified
- `public/app/deals/workspace.html` - Updated `loadScratchpad()` function
- `scripts/apply-scratchpad-migration.js` - New migration script
- `scripts/add-sample-scratchpad-items.js` - New sample data script

## Next Steps
1. ✅ Database migration applied
2. ✅ Sample data added
3. ✅ Frontend data loading fixed
4. 🔄 Manual testing in browser
5. ⏳ Implement remaining type-specific renderers (Task 6)
6. ⏳ Add unit tests for frontend components (Task 4.5)
7. ⏳ Integration and E2E tests (Tasks 16-18)

## Status
**READY FOR TESTING** - The scratchpad should now display saved items correctly. The data loading issue has been resolved with proper API integration and backward compatibility with the old notebook format.
