# Week 5: Interactive Hierarchy + Context Panel
**Date:** January 30, 2026  
**Status:** 🚀 Ready to Start  
**Goal:** Add interactive metric hierarchy and context panel to Analysis tab  
**Timeline:** 5 days

---

## Executive Summary

Week 5 enhances the Analysis tab with interactive metric hierarchy (expandable rows with drill-down) and a slide-in context panel that displays footnotes, MD&A quotes, and detailed breakdowns. This provides analysts with instant access to supporting context without leaving the metrics view.

---

## What We're Building

### 1. Interactive Metric Hierarchy
- **Expandable metric rows** in the Analysis tab
- **Drill-down navigation** (Revenue → Product Revenue → iPhone Revenue)
- **Visual indicators** for key drivers and relationships
- **Expand/collapse animations** for smooth UX
- **Keyboard navigation** (Arrow keys, Enter, Space)

### 2. Context Panel
- **Slide-in panel** from the right side
- **Footnote display** with structured data (tables, lists)
- **MD&A quotes** related to the metric
- **Segment/geographic breakdowns** from footnotes
- **Close button** and overlay click-to-close

---

## Prerequisites ✅

**Backend Services (Complete):**
- ✅ FootnoteLinkingService - Links metrics to footnotes
- ✅ MDAIntelligenceService - Extracts MD&A insights
- ✅ MetricHierarchyService - Builds relationship graph

**Database (Complete):**
- ✅ footnote_references table
- ✅ mda_insights table
- ✅ metric_hierarchy table

**Frontend (Complete):**
- ✅ Insights tab with hero metrics
- ✅ CSS component library (workspace-enhancements.css)

---

## Implementation Tasks

### Day 1: Interactive Hierarchy Backend API (4 hours)

**Goal:** Create API endpoints for hierarchy navigation

**Tasks:**
1. Create `HierarchyController` with endpoints:
   ```typescript
   GET /api/deals/:dealId/hierarchy/:fiscalPeriod
   GET /api/deals/:dealId/hierarchy/:fiscalPeriod/metric/:metricId/children
   GET /api/deals/:dealId/hierarchy/:fiscalPeriod/metric/:metricId/path
   ```

2. Add methods to `MetricHierarchyService`:
   - `getHierarchyForDeal(dealId, fiscalPeriod)` - Get full hierarchy
   - `getChildrenForMetric(dealId, fiscalPeriod, metricId)` - Get children
   - `getPathToMetric(dealId, fiscalPeriod, metricId)` - Get breadcrumb path

3. Write unit tests (15 tests):
   - Controller tests (5 tests)
   - Service method tests (10 tests)

**Deliverables:**
- ✅ HierarchyController created
- ✅ API endpoints working
- ✅ 15/15 tests passing

---

### Day 2: Context Panel Backend API (4 hours)

**Goal:** Create API endpoints for context data

**Tasks:**
1. Create `ContextController` with endpoints:
   ```typescript
   GET /api/deals/:dealId/context/:metricId
   GET /api/deals/:dealId/context/:metricId/footnotes
   GET /api/deals/:dealId/context/:metricId/mda-quotes
   ```

2. Add methods to services:
   - `FootnoteLinkingService.getFootnotesForMetric(dealId, metricId)`
   - `MDAIntelligenceService.getQuotesForMetric(dealId, metricId, fiscalPeriod)`

3. Write unit tests (12 tests):
   - Controller tests (4 tests)
   - Service method tests (8 tests)

**Deliverables:**
- ✅ ContextController created
- ✅ API endpoints working
- ✅ 12/12 tests passing

---

### Day 3: Interactive Hierarchy Frontend (6 hours)

**Goal:** Add expandable metric rows to Analysis tab

**Tasks:**
1. Modify `public/app/deals/workspace.html`:
   - Add hierarchy data structure to Alpine.js
   - Add `expandedMetrics` Set to track expanded rows
   - Add `toggleMetricExpansion(metricId)` method
   - Add `loadHierarchy(fiscalPeriod)` method

2. Update Analysis tab HTML:
   - Replace flat metric tables with hierarchical structure
   - Add expand/collapse buttons (▶/▼ icons)
   - Add indentation for child metrics
   - Add visual indicators (key driver badges, formulas)

3. Add CSS animations:
   - Smooth expand/collapse transitions
   - Hover effects on expandable rows
   - Loading states for children

4. Add keyboard navigation:
   - Arrow keys to navigate rows
   - Enter/Space to expand/collapse
   - Tab to move between sections

**Deliverables:**
- ✅ Expandable metric rows working
- ✅ Smooth animations
- ✅ Keyboard navigation
- ✅ Visual indicators

---

### Day 4: Context Panel Frontend (6 hours)

**Goal:** Create slide-in context panel

**Tasks:**
1. Add context panel HTML to `workspace.html`:
   ```html
   <div x-show="showContextPanel" class="context-panel">
     <div class="panel-header">
       <h3>Context: <span x-text="contextMetric.name"></span></h3>
       <button @click="closeContextPanel()">×</button>
     </div>
     <div class="panel-content">
       <!-- Footnotes section -->
       <!-- MD&A quotes section -->
       <!-- Breakdowns section -->
     </div>
   </div>
   ```

2. Add Alpine.js methods:
   - `openContextPanel(metricId)` - Load and show panel
   - `closeContextPanel()` - Hide panel
   - `loadContextData(metricId)` - Fetch context from API

3. Add CSS styling:
   - Slide-in animation from right
   - Overlay with click-to-close
   - Responsive width (400px desktop, 100% mobile)
   - Scrollable content area

4. Add context sections:
   - Footnotes with tables/lists
   - MD&A quotes with highlighting
   - Segment/geographic breakdowns
   - Related metrics links

**Deliverables:**
- ✅ Context panel sliding smoothly
- ✅ All sections displaying correctly
- ✅ Responsive design
- ✅ Click-to-close working

---

### Day 5: Testing & Polish (4 hours)

**Goal:** Comprehensive testing and refinements

**Tasks:**
1. Write E2E tests (`test/e2e/hierarchy-context.e2e-spec.ts`):
   - Test hierarchy expansion/collapse
   - Test context panel open/close
   - Test data loading
   - Test keyboard navigation
   - Test responsive behavior
   - Test accessibility (ARIA labels)
   - **Target: 20 tests**

2. Performance optimization:
   - Lazy load children on expand
   - Cache hierarchy data
   - Debounce context panel loading
   - Virtual scrolling for large hierarchies

3. Polish & refinements:
   - Smooth animations
   - Loading states
   - Error handling
   - Empty states
   - Tooltips

4. Documentation:
   - Update CHANGELOG
   - Create WEEK5_COMPLETE.md
   - Update QUICK_REFERENCE

**Deliverables:**
- ✅ 20/20 E2E tests passing
- ✅ Performance optimized
- ✅ Documentation complete
- ✅ Ready for Week 6

---

## Technical Specifications

### API Contracts

#### GET /api/deals/:dealId/hierarchy/:fiscalPeriod
**Response:**
```json
{
  "hierarchy": [
    {
      "id": "metric-123",
      "name": "Revenue",
      "value": 394328000000,
      "level": 0,
      "hasChildren": true,
      "isKeyDriver": true,
      "formula": null,
      "children": []
    }
  ]
}
```

#### GET /api/deals/:dealId/context/:metricId
**Response:**
```json
{
  "metric": {
    "id": "metric-123",
    "name": "Revenue",
    "value": 394328000000
  },
  "footnotes": [
    {
      "number": "1",
      "title": "Revenue Recognition",
      "text": "The Company recognizes revenue...",
      "tables": [...],
      "lists": [...]
    }
  ],
  "mdaQuotes": [
    {
      "text": "Revenue increased by 15% due to...",
      "sentiment": "positive",
      "context": "trend"
    }
  ],
  "breakdowns": {
    "segments": [...],
    "geographic": [...]
  }
}
```

---

## UI/UX Design

### Interactive Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│ Financial Performance Metrics                           │
├─────────────────────────────────────────────────────────┤
│ ▼ Revenue                    $394.3B  [Key Driver] [i] │
│   ├─ Product Revenue          $297.4B                   │
│   │  ├─ iPhone                $200.6B                   │
│   │  ├─ Mac                    $29.4B                   │
│   │  └─ iPad                   $28.3B                   │
│   └─ Services Revenue          $96.9B                   │
│                                                          │
│ ▶ Cost of Revenue            $223.5B              [i]   │
│                                                          │
│ ▶ Gross Profit               $170.8B  [Key Driver] [i] │
└─────────────────────────────────────────────────────────┘
```

### Context Panel

```
┌─────────────────────────────────────────────────────────┐
│ Context: Revenue                                    [×] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 📝 Footnotes                                            │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Note 1 - Revenue Recognition                        │ │
│ │ The Company recognizes revenue when control of      │ │
│ │ goods or services is transferred to customers...    │ │
│ │                                                     │ │
│ │ [Table: Revenue by Product Category]               │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ 💬 MD&A Insights                                        │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ "Revenue increased by 15% driven by strong iPhone  │ │
│ │  sales and continued growth in Services."          │ │
│ │  — Management Discussion & Analysis                │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ 📊 Breakdowns                                           │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Geographic:                                         │ │
│ │ • Americas: $169.7B (43%)                          │ │
│ │ • Europe: $101.3B (26%)                            │ │
│ │ • Greater China: $72.6B (18%)                      │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## CSS Styling

### Hierarchy Styles
```css
.metric-row {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  transition: background-color 0.2s;
  cursor: pointer;
}

.metric-row:hover {
  background-color: var(--bg-hover);
}

.metric-row.expandable {
  cursor: pointer;
}

.expand-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s;
}

.expand-btn.expanded {
  transform: rotate(90deg);
}

.metric-row.level-1 {
  padding-left: 48px;
}

.metric-row.level-2 {
  padding-left: 80px;
}

.key-driver-badge {
  background: var(--color-indigo-100);
  color: var(--color-indigo-700);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}
```

### Context Panel Styles
```css
.context-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 400px;
  height: 100vh;
  background: white;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  transform: translateX(100%);
  transition: transform 0.3s ease-out;
}

.context-panel.open {
  transform: translateX(0);
}

.panel-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  z-index: 999;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}

.panel-overlay.open {
  opacity: 1;
  pointer-events: auto;
}

.panel-header {
  padding: 20px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-content {
  padding: 20px;
  height: calc(100vh - 80px);
  overflow-y: auto;
}
```

---

## Performance Targets

- Hierarchy load: <500ms
- Children expand: <100ms
- Context panel open: <300ms
- Context data load: <500ms
- Smooth 60fps animations
- No layout shifts

---

## Accessibility

- ARIA labels on all interactive elements
- Keyboard navigation (Arrow keys, Enter, Space, Escape)
- Focus indicators
- Screen reader announcements
- Color contrast ratios > 4.5:1
- Semantic HTML

---

## Testing Strategy

### Unit Tests (27 tests)
- HierarchyController: 5 tests
- ContextController: 4 tests
- MetricHierarchyService methods: 10 tests
- FootnoteLinkingService methods: 4 tests
- MDAIntelligenceService methods: 4 tests

### E2E Tests (20 tests)
- Hierarchy expansion/collapse
- Context panel open/close
- Data loading and display
- Keyboard navigation
- Responsive behavior
- Accessibility
- Error handling
- Loading states

**Total: 47 new tests**

---

## Success Criteria

### Technical Metrics
- [ ] Zero breaking changes
- [ ] 100% test coverage (47/47 tests)
- [ ] <500ms hierarchy load
- [ ] <300ms context panel open
- [ ] WCAG 2.1 AA compliant

### User Experience Metrics
- [ ] Drill-down works smoothly
- [ ] Context panel provides value
- [ ] Keyboard navigation intuitive
- [ ] Responsive on all devices

### Business Metrics
- [ ] Analyst productivity: +15% (faster context access)
- [ ] Questions answered: +3 per session
- [ ] Data trust: 97%+

---

## Files to Create

### Backend (2 files)
1. `src/deals/hierarchy.controller.ts` - Hierarchy API endpoints
2. `src/deals/context.controller.ts` - Context API endpoints

### Frontend (0 files - modify existing)
- Modify `public/app/deals/workspace.html`

### Tests (3 files)
1. `test/unit/hierarchy.controller.spec.ts` - Controller tests
2. `test/unit/context.controller.spec.ts` - Controller tests
3. `test/e2e/hierarchy-context.e2e-spec.ts` - E2E tests

### Documentation (2 files)
1. `WEEK5_COMPLETE.md` - Implementation summary
2. Update `CHANGELOG-2026-01-30.md`

---

## Timeline

**Day 1 (4 hours):** Hierarchy Backend API + Tests  
**Day 2 (4 hours):** Context Backend API + Tests  
**Day 3 (6 hours):** Interactive Hierarchy Frontend  
**Day 4 (6 hours):** Context Panel Frontend  
**Day 5 (4 hours):** E2E Tests + Polish + Documentation  

**Total: 24 hours (3 days)**

---

## Next Steps After Week 5

### Week 6: Enhanced Tabs
- Enhance Qualitative tab with MD&A insights
- Improve Export tab with data quality report
- Add context suggestions to Research assistant

### Week 7: Testing & Launch
- Integration testing
- User acceptance testing
- Performance optimization
- Production deployment

---

**Last Updated:** 2026-01-30 23:45 UTC  
**Status:** 🚀 Ready to Start  
**Estimated Completion:** 2026-02-04

