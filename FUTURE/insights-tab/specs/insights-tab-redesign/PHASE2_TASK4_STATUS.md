# Task 2.4: Change Tracker Service - Status Update

**Date:** February 2, 2026  
**Status:** 🚧 IN PROGRESS (Service Created, Schema Alignment Needed)  
**Time Spent:** ~2 hours  
**Priority:** MEDIUM

---

## Summary

Created the `ChangeTrackerService` with comprehensive change detection logic. The service is functionally complete with 17 passing unit tests, but requires schema alignment to work with the production database.

---

## What Was Accomplished

### 1. Service Implementation ✅
**File:** `src/deals/change-tracker.service.ts` (~650 lines)

**Features Implemented:**
- `detectChanges()` - Main orchestration method
- `detectNewDisclosures()` - Finds new keywords and risk factors
- `detectLanguageChanges()` - Detects tone shifts and keyword frequency changes
- `detectMetricChanges()` - Finds discontinued, new, and significantly changed metrics
- `detectAccountingChanges()` - Identifies accounting policy changes
- Caching layer (1-hour TTL)
- Comprehensive error handling

**Change Types Detected:**
1. **New Disclosures** - New keywords, risk factors, business segments
2. **Language Changes** - Tone shifts, keyword frequency changes
3. **Metric Changes** - Discontinued metrics, new metrics, significant value changes (>20%)
4. **Accounting Changes** - Policy changes, restatements, standard adoptions

**Materiality Calculation:**
- High: Litigation, breaches, impairments, discontinued metrics
- Medium: Regulatory changes, acquisitions, tone shifts
- Low: Minor keyword changes

### 2. Unit Tests ✅
**File:** `test/unit/change-tracker.service.spec.ts` (~400 lines)

**Test Coverage:** 17 tests, all passing
- `detectChanges()` - 4 tests
- `detectNewDisclosures()` - 2 tests
- `detectLanguageChanges()` - 2 tests
- `detectMetricChanges()` - 4 tests
- `detectAccountingChanges()` - 2 tests
- Edge cases - 2 tests
- Cache management - 1 test

### 3. Module Integration ✅
**File:** `src/deals/deals.module.ts`

- Added `ChangeTrackerService` to providers
- Service ready for dependency injection

---

## Schema Alignment Issue

### Problem
The service was designed to work with fields that don't exist in the current `MdaInsight` schema:

**Expected Fields:**
```typescript
{
  insight: string;
  context: string;
  section: string;
  sentiment: string;
  keywords: string[];
}
```

**Actual Schema:**
```typescript
model MdaInsight {
  trends: Json;
  risks: Json;
  guidance: string;
  guidanceSentiment: string;
  // No insight, context, section, keywords fields
}
```

### Solution Options

**Option 1: Use Narrative Chunks (Recommended)**
- Query `narrative_chunks` table instead of `mda_insights`
- Has `content`, `section`, `chunkType` fields
- More granular data for change detection
- Requires refactoring service methods

**Option 2: Add Schema Migration**
- Add missing fields to `mda_insights` table
- Backfill data from existing sources
- More invasive change

**Option 3: Use JSON Fields**
- Parse `trends` and `risks` JSON fields
- Extract relevant information
- Less type-safe

---

## Recommended Next Steps

### Immediate (1-2 hours)
1. **Refactor to use `narrative_chunks` table**
   - Update `detectNewDisclosures()` to query narrative chunks
   - Update `detectLanguageChanges()` to analyze chunk content
   - Keep `detectMetricChanges()` as-is (uses `financial_metrics`)
   - Update `detectAccountingChanges()` to search chunk content

2. **Update unit tests**
   - Mock `narrative_chunks` queries instead of `mda_insights`
   - Adjust test expectations

3. **Verify build**
   - Ensure TypeScript compilation succeeds
   - Run all tests

### Short-term (2-3 hours)
4. **Implement Task 2.5: API Endpoints**
   - Add `GET /api/deals/:dealId/insights/changes` endpoint
   - Add query parameter validation
   - Write integration tests

5. **Implement Task 2.6: Frontend UI**
   - Create change tracker section in workspace.html
   - Add period selection dropdowns
   - Build side-by-side comparison cards
   - Add filters and sorting

---

## Alternative: Simplified Implementation

If time is constrained, consider a **simplified version** that focuses on metric changes only:

```typescript
// Simplified ChangeTrackerService
async detectChanges(options) {
  // Only detect metric changes (most valuable)
  const metricChanges = await this.detectMetricChanges(options);
  
  return {
    changes: metricChanges,
    summary: this.calculateSummary(metricChanges),
  };
}
```

**Benefits:**
- Works with existing schema (no changes needed)
- Delivers 80% of value with 20% of effort
- Can enhance later with narrative analysis

**Drawbacks:**
- Misses language/tone changes
- No new disclosure detection
- Less comprehensive

---

## Files Created

```
src/deals/change-tracker.service.ts           (650 lines, needs refactoring)
test/unit/change-tracker.service.spec.ts      (400 lines, 17 tests passing)
src/deals/deals.module.ts                     (updated)
.kiro/specs/insights-tab-redesign/PHASE2_TASK4_STATUS.md (this file)
```

---

## Decision Required

**Question:** Should we:
1. **Refactor to use narrative_chunks** (2 hours, full functionality)
2. **Simplify to metrics-only** (30 minutes, 80% value)
3. **Add schema migration** (3 hours, most invasive)

**Recommendation:** Option 2 (Simplified) for MVP, then enhance in Phase 3.

---

## Current State

- ✅ Service logic implemented
- ✅ Unit tests passing (17/17)
- ❌ TypeScript compilation failing (schema mismatch)
- ❌ Not integrated with actual database
- 🔜 Needs refactoring or simplification

---

**Status:** 🚧 BLOCKED ON SCHEMA DECISION  
**Next Action:** Choose implementation approach  
**Estimated Time to Complete:** 30 min - 2 hours (depending on approach)

---

**Created by:** Kiro AI  
**Date:** February 2, 2026
