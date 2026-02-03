# Task 3.1: Footnote Context Panels - Implementation Plan

**Date:** February 2, 2026  
**Status:** Ready to Implement  
**Estimated Time:** 1.5 days

---

## Overview

Enhance the existing context panel to provide comprehensive footnote and MD&A context for metrics in the Insights Tab. The panel already exists but needs to be fully integrated with the footnote linking service and enhanced with additional features.

---

## Current State Analysis

### What Already Exists ✅
1. **Context Panel UI** (`workspace.html` lines 2699-2850)
   - Slide-out panel structure
   - Footnotes section with styling
   - MD&A quotes section
   - Segment breakdowns section
   - "Save to Scratchpad" button
   - Close button

2. **FootnoteLinkingService** (`src/deals/footnote-linking.service.ts`)
   - `getFootnoteReferencesForMetric(metricId)` method
   - `getFootnoteReferencesForDeal(dealId)` method
   - Footnote classification (accounting_policy, segment_breakdown, reconciliation, other)
   - Structured data extraction

3. **View Context Buttons**
   - Root metrics: Line 2314
   - Child metrics: Line 2382
   - Grandchild metrics: Line 2420
   - All call `openContextPanel(metricId, metricName)`

### What Needs to be Built 🔨
1. **API Endpoint** for fetching context data
2. **Backend Service Method** to aggregate context
3. **Frontend Integration** to load and display data
4. **MD&A Context Extraction** from narrative_chunks
5. **Segment Breakdown Extraction** from hierarchy
6. **Save to Scratchpad** functionality
7. **Link to Source Document** functionality
8. **E2E Tests** for the complete flow

---

## Implementation Tasks

### Task 3.1.1: Backend API Endpoint (2 hours)

**File:** `src/deals/insights.controller.ts`

Add new endpoint:
```typescript
@Get(':dealId/insights/context/:metricId')
async getMetricContext(
  @Param('dealId') dealId: string,
  @Param('metricId') metricId: string,
  @Query('period') period?: string,
): Promise<MetricContextResponse> {
  return this.insightsService.getMetricContext(dealId, metricId, period);
}
```

**Response Type:**
```typescript
interface MetricContextResponse {
  metricId: string;
  metricName: string;
  period: string;
  footnotes: FootnoteContext[];
  mdaQuotes: MDAQuote[];
  breakdowns: {
    segments?: SegmentBreakdown[];
    geographic?: GeographicBreakdown[];
  };
  sourceDocument: {
    url: string;
    section: string;
  };
}

interface FootnoteContext {
  number: string;
  title: string;
  text: string;
  contextType: 'accounting_policy' | 'segment_breakdown' | 'reconciliation' | 'other';
  extractedData?: any;
}

interface MDAQuote {
  text: string;
  section: string;
  relevance: 'high' | 'medium' | 'low';
  keywords: string[];
}

interface SegmentBreakdown {
  segmentName: string;
  value: number;
  percentage: number;
  yoyChange?: number;
}
```

---

### Task 3.1.2: Backend Service Method (3 hours)

**File:** `src/deals/insights.service.ts`

Add new method:
```typescript
async getMetricContext(
  dealId: string,
  metricId: string,
  period?: string,
): Promise<MetricContextResponse> {
  // 1. Get metric details
  const metric = await this.getMetricDetails(dealId, metricId, period);
  
  // 2. Get footnote references
  const footnotes = await this.footnoteLinkingService
    .getFootnoteReferencesForMetric(metricId);
  
  // 3. Get MD&A context
  const mdaQuotes = await this.extractMDAContext(dealId, metric.name, period);
  
  // 4. Get segment breakdowns (if applicable)
  const breakdowns = await this.extractSegmentBreakdowns(dealId, metricId, period);
  
  // 5. Get source document info
  const sourceDocument = await this.getSourceDocument(dealId, period);
  
  return {
    metricId,
    metricName: metric.name,
    period: period || metric.period,
    footnotes: footnotes.map(f => ({
      number: f.footnoteNumber,
      title: f.footnoteSection,
      text: f.footnoteText,
      contextType: f.contextType,
      extractedData: f.extractedData,
    })),
    mdaQuotes,
    breakdowns,
    sourceDocument,
  };
}

private async extractMDAContext(
  dealId: string,
  metricName: string,
  period?: string,
): Promise<MDAQuote[]> {
  // Search narrative_chunks for mentions of the metric
  const chunks = await this.prisma.narrative_chunk.findMany({
    where: {
      deal_id: dealId,
      filing_period: period,
      section_type: {
        in: ['MD&A', 'Management Discussion', 'Results of Operations'],
      },
      content: {
        contains: metricName,
        mode: 'insensitive',
      },
    },
    take: 5,
  });
  
  return chunks.map(chunk => {
    // Extract relevant sentences containing the metric
    const sentences = chunk.content.split(/[.!?]+/);
    const relevantSentences = sentences.filter(s => 
      s.toLowerCase().includes(metricName.toLowerCase())
    );
    
    return {
      text: relevantSentences.join('. ').trim(),
      section: chunk.section_type,
      relevance: this.calculateRelevance(relevantSentences, metricName),
      keywords: this.extractKeywords(relevantSentences.join(' ')),
    };
  });
}

private async extractSegmentBreakdowns(
  dealId: string,
  metricId: string,
  period?: string,
): Promise<{ segments?: SegmentBreakdown[] }> {
  // Get child metrics from hierarchy
  const children = await this.metricHierarchyService.getChildren(
    dealId,
    metricId,
    period,
  );
  
  if (children.length === 0) return {};
  
  const total = children.reduce((sum, c) => sum + c.value, 0);
  
  return {
    segments: children.map(child => ({
      segmentName: child.name,
      value: child.value,
      percentage: (child.value / total) * 100,
      yoyChange: child.yoyChange,
    })),
  };
}

private async getSourceDocument(
  dealId: string,
  period?: string,
): Promise<{ url: string; section: string }> {
  // Get the 10-K/10-Q document URL
  const deal = await this.prisma.deal.findUnique({
    where: { id: dealId },
    select: { ticker: true },
  });
  
  // Construct SEC EDGAR URL
  const year = period ? period.substring(2, 6) : new Date().getFullYear();
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${deal.ticker}&type=10-K&dateb=${year}&owner=exclude&count=1`;
  
  return {
    url,
    section: 'Financial Statements',
  };
}

private calculateRelevance(
  sentences: string[],
  metricName: string,
): 'high' | 'medium' | 'low' {
  const text = sentences.join(' ').toLowerCase();
  const metric = metricName.toLowerCase();
  
  // High relevance: metric + financial keywords
  const financialKeywords = ['increase', 'decrease', 'growth', 'decline', 'improved', 'declined'];
  const hasFinancialContext = financialKeywords.some(k => text.includes(k));
  
  if (hasFinancialContext && text.split(metric).length > 2) {
    return 'high';
  }
  
  // Medium relevance: metric mentioned multiple times
  if (text.split(metric).length > 1) {
    return 'medium';
  }
  
  return 'low';
}

private extractKeywords(text: string): string[] {
  const keywords = [
    'increase', 'decrease', 'growth', 'decline', 'improved', 'declined',
    'higher', 'lower', 'driven by', 'primarily due to', 'resulted from',
    'headwinds', 'tailwinds', 'pressure', 'favorable', 'unfavorable',
  ];
  
  return keywords.filter(k => text.toLowerCase().includes(k));
}
```

---

### Task 3.1.3: Frontend Integration (3 hours)

**File:** `public/app/deals/workspace.html`

Update the Alpine.js state and methods:

```javascript
// Add to Alpine.js data
contextData: null,
loadingContext: false,
contextError: null,

// Update openContextPanel method
async openContextPanel(metricId, metricName) {
  this.showContextPanel = true;
  this.selectedMetricId = metricId;
  this.selectedMetricName = metricName;
  this.loadingContext = true;
  this.contextError = null;
  
  try {
    const response = await fetch(
      `/api/deals/${this.dealId}/insights/context/${metricId}?period=${this.selectedPeriod}`,
      {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to load context');
    }
    
    this.contextData = await response.json();
  } catch (error) {
    console.error('Error loading context:', error);
    this.contextError = 'Failed to load context. Please try again.';
  } finally {
    this.loadingContext = false;
  }
},

// Add saveToScratchpad method
async saveToScratchpad(content, type) {
  try {
    const response = await fetch(`/api/deals/${this.dealId}/scratchpad`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({
        content,
        type,
        metricId: this.selectedMetricId,
        metricName: this.selectedMetricName,
      }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to save to scratchpad');
    }
    
    // Show success message
    this.showToast('Saved to scratchpad', 'success');
  } catch (error) {
    console.error('Error saving to scratchpad:', error);
    this.showToast('Failed to save to scratchpad', 'error');
  }
},

// Add toast notification method
showToast(message, type = 'info') {
  // Simple toast implementation
  const toast = document.createElement('div');
  toast.className = `fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 ${
    type === 'success' ? 'bg-green-500' : 
    type === 'error' ? 'bg-red-500' : 'bg-blue-500'
  } text-white`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
},
```

**Update Context Panel HTML:**

```html
<!-- Loading State -->
<div x-show="loadingContext" class="text-center py-8">
  <i class="fas fa-spinner fa-spin text-4xl text-indigo-500 mb-3"></i>
  <p class="text-sm text-gray-600">Loading context...</p>
</div>

<!-- Error State -->
<div x-show="contextError" class="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
  <div class="flex items-start gap-3">
    <i class="fas fa-exclamation-circle text-red-500 mt-0.5"></i>
    <div>
      <p class="text-sm font-medium text-red-800">Error Loading Context</p>
      <p class="text-xs text-red-600 mt-1" x-text="contextError"></p>
      <button @click="openContextPanel(selectedMetricId, selectedMetricName)" 
              class="text-xs text-red-700 underline mt-2">
        Try Again
      </button>
    </div>
  </div>
</div>

<!-- Content (only show when not loading and no error) -->
<div x-show="!loadingContext && !contextError">
  <!-- Existing footnotes section -->
  
  <!-- Add "Save to Scratchpad" button to each footnote -->
  <button @click="saveToScratchpad(footnote.text, 'footnote')"
          class="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
    <i class="fas fa-save"></i>
    Save to Scratchpad
  </button>
  
  <!-- Add "View Source" link -->
  <a :href="contextData?.sourceDocument?.url" 
     target="_blank"
     class="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 mt-4">
    <i class="fas fa-external-link-alt"></i>
    View Source Document
  </a>
</div>
```

---

### Task 3.1.4: E2E Tests (2 hours)

**File:** `test/e2e/footnote-context-panel.e2e-spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Footnote Context Panel', () => {
  test.beforeEach(async ({ page }) => {
    // Login and navigate to workspace
    await page.goto('/login.html');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/deals');
    
    // Navigate to workspace
    await page.click('text=AMGN');
    await page.waitForURL('**/workspace.html*');
    
    // Navigate to Insights tab
    await page.click('text=Insights');
    await page.waitForTimeout(1000);
  });

  test('should open context panel when clicking View Context button', async ({ page }) => {
    // Click View Context button on a metric
    await page.click('[title="View footnotes & MD&A context"]');
    
    // Panel should be visible
    await expect(page.locator('.context-panel')).toBeVisible();
    
    // Should show metric name
    await expect(page.locator('.context-panel h3')).toContainText('Revenue');
  });

  test('should display footnotes', async ({ page }) => {
    await page.click('[title="View footnotes & MD&A context"]');
    await page.waitForTimeout(500);
    
    // Should show footnotes section
    await expect(page.locator('text=Related Footnotes')).toBeVisible();
    
    // Should show at least one footnote
    const footnotes = page.locator('.footnote-card');
    await expect(footnotes).toHaveCount(await footnotes.count());
  });

  test('should display MD&A quotes', async ({ page }) => {
    await page.click('[title="View footnotes & MD&A context"]');
    await page.waitForTimeout(500);
    
    // Should show MD&A section
    await expect(page.locator('text=MD&A Commentary')).toBeVisible();
    
    // Should show at least one quote
    const quotes = page.locator('.mda-quote');
    await expect(quotes).toHaveCount(await quotes.count());
  });

  test('should display segment breakdowns', async ({ page }) => {
    await page.click('[title="View footnotes & MD&A context"]');
    await page.waitForTimeout(500);
    
    // Should show breakdowns section
    await expect(page.locator('text=Segment Breakdown')).toBeVisible();
    
    // Should show segments
    const segments = page.locator('.segment-item');
    await expect(segments).toHaveCount(await segments.count());
  });

  test('should save footnote to scratchpad', async ({ page }) => {
    await page.click('[title="View footnotes & MD&A context"]');
    await page.waitForTimeout(500);
    
    // Click save button
    await page.click('text=Save to Scratchpad');
    
    // Should show success toast
    await expect(page.locator('text=Saved to scratchpad')).toBeVisible();
  });

  test('should link to source document', async ({ page }) => {
    await page.click('[title="View footnotes & MD&A context"]');
    await page.waitForTimeout(500);
    
    // Should show source link
    const sourceLink = page.locator('text=View Source Document');
    await expect(sourceLink).toBeVisible();
    await expect(sourceLink).toHaveAttribute('href', /sec\.gov/);
    await expect(sourceLink).toHaveAttribute('target', '_blank');
  });

  test('should close panel when clicking close button', async ({ page }) => {
    await page.click('[title="View footnotes & MD&A context"]');
    await page.waitForTimeout(500);
    
    // Click close button
    await page.click('.context-panel button[title="Close"]');
    
    // Panel should be hidden
    await expect(page.locator('.context-panel')).not.toBeVisible();
  });

  test('should show loading state', async ({ page }) => {
    // Slow down network to see loading state
    await page.route('**/api/deals/*/insights/context/*', async route => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await route.continue();
    });
    
    await page.click('[title="View footnotes & MD&A context"]');
    
    // Should show loading spinner
    await expect(page.locator('.fa-spinner')).toBeVisible();
    await expect(page.locator('text=Loading context...')).toBeVisible();
  });

  test('should show error state on failure', async ({ page }) => {
    // Mock API failure
    await page.route('**/api/deals/*/insights/context/*', route => {
      route.fulfill({ status: 500, body: 'Server error' });
    });
    
    await page.click('[title="View footnotes & MD&A context"]');
    await page.waitForTimeout(500);
    
    // Should show error message
    await expect(page.locator('text=Error Loading Context')).toBeVisible();
    await expect(page.locator('text=Try Again')).toBeVisible();
  });

  test('should retry on error', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/deals/*/insights/context/*', route => {
      callCount++;
      if (callCount === 1) {
        route.fulfill({ status: 500, body: 'Server error' });
      } else {
        route.continue();
      }
    });
    
    await page.click('[title="View footnotes & MD&A context"]');
    await page.waitForTimeout(500);
    
    // Click retry
    await page.click('text=Try Again');
    await page.waitForTimeout(500);
    
    // Should show content
    await expect(page.locator('text=Related Footnotes')).toBeVisible();
  });
});
```

---

## Acceptance Criteria

- ✅ Modal opens on "View Context" button click
- ✅ Shows relevant footnotes with classification
- ✅ Shows related MD&A text with relevance scoring
- ✅ Shows segment breakdowns (if applicable)
- ✅ "Save to Scratchpad" button works
- ✅ Link to source document works
- ✅ Loading state displays correctly
- ✅ Error state displays correctly
- ✅ All tests passing (10 E2E tests)

---

## Files to Create/Modify

### Backend (2 files)
1. `src/deals/insights.controller.ts` - Add context endpoint
2. `src/deals/insights.service.ts` - Add context methods

### Frontend (1 file)
3. `public/app/deals/workspace.html` - Update context panel

### Tests (1 file)
4. `test/e2e/footnote-context-panel.e2e-spec.ts` - E2E tests

### Documentation (2 files)
5. `CHANGELOG-2026-02-02-FOOTNOTE-CONTEXT.md` - Changelog
6. `.kiro/specs/insights-tab-redesign/PHASE3_TASK1_COMPLETE.md` - Completion doc

---

## Implementation Order

1. **Backend API** (2 hours)
   - Add endpoint to controller
   - Add service methods
   - Test with Postman/curl

2. **Frontend Integration** (3 hours)
   - Update Alpine.js methods
   - Update context panel HTML
   - Test manually in browser

3. **E2E Tests** (2 hours)
   - Write 10 comprehensive tests
   - Run and fix any issues
   - Verify 100% pass rate

4. **Documentation** (30 minutes)
   - Write changelog
   - Write completion document
   - Update task status

**Total Time:** ~7.5 hours (1 day)

---

## Risk Mitigation

### Risk 1: Footnote data may not exist for all metrics
**Mitigation:** Show "No footnotes available" message gracefully

### Risk 2: MD&A extraction may be slow
**Mitigation:** Limit to 5 chunks, use database indexes

### Risk 3: Source document URL may be incorrect
**Mitigation:** Validate URL format, provide fallback to SEC search

---

## Success Metrics

- Context panel loads in <1 second
- Footnotes displayed for 80%+ of metrics
- MD&A quotes displayed for 60%+ of metrics
- Save to scratchpad success rate >95%
- All E2E tests passing
- Zero crashes or errors

---

## Next Steps After Completion

1. Move to Task 3.4: Accessibility & Keyboard Navigation
2. Or Task 3.5: User Testing & Refinement
3. Collect user feedback on context panel
4. Iterate based on feedback

---

**Status:** Ready to Implement  
**Estimated Completion:** 1 day  
**Dependencies:** None (uses existing services)
