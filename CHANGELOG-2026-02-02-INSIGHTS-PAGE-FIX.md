# Insights Page Fix - February 2, 2026

## Problem
The Insights page was showing errors:
- `Failed to load resource: the server responded with a status of 500 (Internal Server Error)`
- `Error loading hierarchy: Error: Failed to load hierarchy`
- `Error loading anomalies: Error: Failed to load anomalies`
- API calls were being made to `/api/deals/undefined/insights/...`

## Root Cause
The workspace page was calling multiple Insights API endpoints (`loadAnomalies()`, `loadHierarchy()`, `loadInsightsData()`) in parallel when switching to the Insights view. However:

1. Only `loadInsightsData()` had logic to create the deal and store the `dealId` in localStorage
2. The other functions tried to read `dealId` from localStorage immediately, but it didn't exist yet
3. This resulted in `undefined` being used in API URLs: `/api/deals/undefined/insights/anomalies`

## Solution
Created a centralized `ensureDealExists()` helper function that:
- Checks if deal ID exists in localStorage
- If not, creates/gets the deal from the API
- Stores the deal ID in localStorage
- Returns the deal ID

Updated `switchView('insights')` to:
- Call `await this.ensureDealExists()` BEFORE loading any insights data
- This ensures the deal ID is available for all subsequent API calls

Updated `loadInsightsData()` to:
- Use the new `ensureDealExists()` helper instead of duplicating logic
- Removed duplicate deal creation code

## Files Changed
- `public/app/deals/workspace.html`
  - Made `switchView()` async and added `await this.ensureDealExists()`
  - Added new `ensureDealExists()` helper function
  - Simplified `loadInsightsData()` to use the helper

## Testing
1. Navigate to http://localhost:3000/app/deals/workspace.html?ticker=AAPL
2. Click on "Insights" tab
3. Verify that:
   - No console errors about "undefined" in URLs
   - Deal ID is properly stored in localStorage
   - All API calls use the correct deal ID
   - Insights data loads successfully (or shows appropriate "no data" message)

## Impact
- Fixes critical bug preventing Insights tab from loading
- Eliminates race condition between parallel API calls
- Provides reusable helper for ensuring deal exists
- Improves code maintainability by centralizing deal creation logic
