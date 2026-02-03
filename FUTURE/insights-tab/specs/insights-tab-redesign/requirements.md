# Insights Tab Redesign - Requirements

## Project Overview

**Goal:** Transform the Insights tab from a passive "data viewer" into an active "analyst productivity tool" that helps financial analysts work faster and make better decisions.

**Status:** Specification Phase  
**Target Completion:** 3 weeks  
**Priority:** High

---

## Problem Statement

### Current State Issues

1. **Too Shallow:** Pattern-matched insights like "revenue increased 15%" provide no value
2. **No Context:** Missing peer comparison, industry benchmarks, historical ranges
3. **Not Actionable:** Risks extracted from MD&A are just boilerplate
4. **No Flexibility:** Pre-computed views don't match analyst workflows
5. **Missing "So What?":** Data without interpretation or prioritization

### User Feedback (from Strategic Assessment)

> "As an equity analyst, I'd use the Research Assistant (RAG) way more than the Insights Tab. The Insights Tab tries to guess what I care about and usually guesses wrong."

**Rating:** Current Insights Tab = 3/10 Value

---

## Design Principles

1. **Flexibility > Pre-computation** - Let analysts choose what to see
2. **Speed > Depth** - Help them work faster, not think for them
3. **Context > Raw Data** - Show comparisons, trends, outliers
4. **Actionable > Informational** - Every insight suggests next step
5. **Exportable > Locked-in** - Analysts need data in Excel/PPT

---

## Core Features

### 1. Interactive Metric Explorer ⭐ HIGH PRIORITY

**Purpose:** Let analysts build custom views on-the-fly

**Features:**
- Drag-and-drop metric selection
- Custom time period comparison (not just YoY)
- Multiple visualization options (table, chart, sparkline)
- Export to Excel with formulas intact
- Save custom views for reuse

**User Story:**
```
As an analyst
I want to compare Revenue, Gross Margin, and EBITDA for FY2022-2024
So that I can see margin trends over time
```

**Acceptance Criteria:**
- [ ] Can select 1-10 metrics from dropdown
- [ ] Can choose any fiscal period range
- [ ] Can switch between table/chart views
- [ ] Can export to Excel in <2 seconds
- [ ] Custom views persist across sessions

---

### 2. Anomaly Detection Dashboard ⭐ HIGH PRIORITY

**Purpose:** Surface what's unusual, let analyst investigate

**Features:**
- Statistical outliers (>2 std dev from historical)
- Sequential changes (first time in X quarters)
- Peer divergence (company vs sector median)
- Management tone shifts (word frequency analysis)

**User Story:**
```
As an analyst
I want to see metrics that are statistically unusual
So that I can focus my research on what matters
```

**Acceptance Criteria:**
- [ ] Detects outliers using 2σ threshold
- [ ] Shows "first time in X quarters" for sequential changes
- [ ] Compares to peer median (when peer data available)
- [ ] Links to source documents for investigation
- [ ] Allows dismissing false positives

**Anomaly Types:**

1. **Statistical Outliers**
   - Metric value >2σ from 5-year mean
   - Example: "Gross margin 45% vs historical avg 38% ±3%"

2. **Sequential Changes**
   - First increase/decrease in N quarters
   - Example: "First margin expansion in 8 quarters"

3. **Peer Divergence**
   - Company metric vs peer group median
   - Example: "ROIC 15% vs sector median 12%"

4. **Trend Reversals**
   - Direction change after consistent trend
   - Example: "Revenue growth decelerated after 12 quarters of acceleration"

5. **Management Tone Shifts**
   - Keyword frequency changes in MD&A
   - Example: "'Headwinds' mentioned 5x vs 0x last quarter"

---

### 3. Comp Table Builder ⭐ HIGH PRIORITY

**Purpose:** Build custom comparable company tables

**Features:**
- Select metrics, periods, companies
- Automatic percentile ranking
- Highlight outliers
- Export to Excel/PowerPoint
- Save comp groups for reuse

**User Story:**
```
As an analyst
I want to compare META's metrics to GOOGL, SNAP, PINS
So that I can see relative performance
```

**Acceptance Criteria:**
- [ ] Can add/remove companies dynamically
- [ ] Shows percentile ranking for each metric
- [ ] Highlights top/bottom quartile
- [ ] Exports with formatting preserved
- [ ] Supports custom peer groups

**Comp Table Structure:**
```
┌──────────┬─────────┬──────────┬─────────┬───────┐
│ Ticker   │ Revenue │ Growth % │ Margin  │ ROIC  │
│          │ ($M)    │          │ (%)     │ (%)   │
├──────────┼─────────┼──────────┼─────────┼───────┤
│ META     │ 134,902 │ 16%      │ 41%     │ 28%   │
│ GOOGL    │ 307,394 │ 9%       │ 32%     │ 24%   │
│ SNAP     │ 4,602   │ -1%      │ -35%    │ -12%  │
│ ────────────────────────────────────────────────│
│ Median   │ 134,902 │ 9%       │ 32%     │ 24%   │
│ Your Co  │ 134,902 │ 16% ⬆    │ 41% ⬆   │ 28% ⬆ │
└──────────┴─────────┴──────────┴─────────┴───────┘
```

---

### 4. Change Tracker ⭐ MEDIUM PRIORITY

**Purpose:** Show what changed quarter-over-quarter

**Features:**
- Side-by-side period comparison
- Highlight new disclosures
- Track management language changes
- Flag accounting policy changes

**User Story:**
```
As an analyst
I want to see what changed from Q3 to Q4
So that I can focus on new information
```

**Acceptance Criteria:**
- [ ] Shows side-by-side comparison for any two periods
- [ ] Highlights new sections/disclosures
- [ ] Tracks keyword frequency changes
- [ ] Flags material changes (>10% metric change)
- [ ] Links to source documents

**Change Categories:**

1. **New Disclosures**
   - Sections added to filing
   - Example: "New segment reporting: Cloud vs On-Prem"

2. **Language Changes**
   - Keyword frequency shifts
   - Example: "'AI' mentioned 23x vs 12x last quarter"

3. **Metric Changes**
   - Material changes (>10%)
   - Example: "DSO increased 45 days vs 38 days"

4. **Accounting Changes**
   - Policy modifications
   - Example: "Changed revenue recognition method"

---

### 5. Enhanced Metric Hierarchy ⭐ MEDIUM PRIORITY

**Purpose:** Visualize metric decomposition with context

**Features:**
- Interactive tree view (expand/collapse)
- Contribution analysis (% of parent)
- Trend indicators for each node
- Link to footnotes and context
- Export hierarchy to Excel

**User Story:**
```
As an analyst
I want to see how Revenue breaks down into segments
So that I can understand growth drivers
```

**Acceptance Criteria:**
- [ ] Shows 3 levels of hierarchy
- [ ] Displays contribution % for each child
- [ ] Shows trend arrows (↑↓→)
- [ ] Links to footnote context
- [ ] Exports to Excel with structure preserved

**Hierarchy Example:**
```
Revenue ($50.2B, +12% YoY)
├─ Product Revenue ($35.1B, +15% YoY) [70% of total]
│  ├─ Product A ($20.0B, +20% YoY)
│  └─ Product B ($15.1B, +8% YoY)
└─ Service Revenue ($15.1B, +5% YoY) [30% of total]
   ├─ Subscription ($10.0B, +8% YoY)
   └─ Advertising ($5.1B, -2% YoY)
```

---

### 6. Footnote Context Panels ⭐ LOW PRIORITY

**Purpose:** Show explanatory context for metrics

**Features:**
- Click any metric to see footnotes
- Show related MD&A commentary
- Link to source document location
- Save important footnotes to scratchpad

**User Story:**
```
As an analyst
I want to see why Gross Margin changed
So that I can understand the drivers
```

**Acceptance Criteria:**
- [ ] Shows footnotes for any metric
- [ ] Displays related MD&A text
- [ ] Links to exact page in filing
- [ ] Allows saving to scratchpad
- [ ] Shows historical footnotes for comparison

---

## Out of Scope (Future Phases)

1. **Smart Alerts** - Proactive notifications (requires infrastructure)
2. **Scenario Modeler** - What-if analysis (requires modeling engine)
3. **Natural Language Query** - Already covered by Research Assistant
4. **Peer Data Integration** - Requires external data source (FactSet/Bloomberg)

---

## Technical Requirements

### Performance
- Page load: <2 seconds
- Metric selection: <500ms
- Export generation: <3 seconds
- Anomaly detection: <1 second

### Data Sources
- PostgreSQL: `financial_metrics`, `metric_hierarchy`, `footnote_references`
- Existing services: `InsightsService`, `MetricHierarchyService`, `FootnoteLinkingService`
- No new database tables required

### Browser Support
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Accessibility
- WCAG 2.1 AA compliance
- Keyboard navigation
- Screen reader support
- High contrast mode

---

## Success Metrics

### Adoption Metrics
- % of analysts who use Insights tab (target: 80%)
- Average time spent in Insights tab (target: 5+ min/session)
- Number of custom views created (target: 3+ per analyst)
- Export usage (target: 50% of sessions)

### Value Metrics
- Time saved vs manual analysis (target: 1-2 hours per company)
- Anomalies detected per company (target: 5+)
- User satisfaction score (target: 8/10)

### Technical Metrics
- Page load time (target: <2s)
- Error rate (target: <1%)
- API response time (target: <500ms)

---

## Dependencies

### Existing Services (No Changes Required)
- ✅ `InsightsService` - Already provides metrics and trends
- ✅ `MetricHierarchyService` - Already builds hierarchy (Step G)
- ✅ `FootnoteLinkingService` - Already links footnotes (Step H)
- ✅ `QualitativePrecomputeService` - Already extracts MD&A insights (Step E)

### New Services Required
- `AnomalyDetectionService` - Statistical analysis
- `CompTableService` - Peer comparison logic
- `ChangeTrackerService` - Period-over-period comparison
- `MetricExplorerService` - Custom view management

---

## Risk Assessment

### High Risk
- **Peer data unavailable** - Comp tables limited without external data
  - Mitigation: Start with single-company analysis, add peers later

### Medium Risk
- **Performance with large datasets** - Anomaly detection on 5+ years of data
  - Mitigation: Pre-compute anomalies during pipeline, cache results

### Low Risk
- **User adoption** - Analysts may prefer Research Assistant
  - Mitigation: Make Insights tab complementary, not competitive

---

## Phased Rollout

### Phase 1 (Week 1): Foundation
- Interactive Metric Explorer
- Basic anomaly detection
- Enhanced metric hierarchy

### Phase 2 (Week 2): Comparison
- Comp Table Builder (single company)
- Change Tracker
- Export functionality

### Phase 3 (Week 3): Polish
- Footnote context panels
- Performance optimization
- User testing and refinement

---

## Approval

- [ ] Product Owner: _______________
- [ ] Tech Lead: _______________
- [ ] Design Lead: _______________
- [ ] QA Lead: _______________

**Date:** _____________
