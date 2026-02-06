# Platform Projects Tracker

## Overview

This document tracks all major platform improvement projects in priority order. Each project has its own spec directory with detailed requirements, design, and tasks.

**Last Updated:** February 6, 2026

---

## Project Queue

### 🔴 P0: Critical Fixes (Start Immediately)

#### TODO: Qualitative Cache Refresh - Expired "Instant" Answers
- **Status:** 🟡 Ready to Start
- **Priority:** P0 - Critical (Demo Regression)
- **Effort:** 30 minutes
- **Description:** Qualitative precomputed answers have expired for most tickers (7-day TTL). COST expired Feb 6, AMGN/INTU expired Feb 4, AAPL/GOOG/INTC expired late Jan. Only NVDA, AMZN, CMCSA still have valid cache. Need to re-run `POST /api/financial-calculator/qualitative/precompute/:ticker` for all expired tickers to restore "⚡ Instant" answers on the workspace qualitative tab.
- **Tickers to refresh:** COST, AMGN, INTU, AAPL, GOOG, INTC
- **Still valid:** NVDA (Feb 10), AMZN (Feb 9), CMCSA (Feb 7)
- **Root cause:** No automated cache refresh job - precompute only runs during pipeline ingestion or manual trigger

#### Project 1: Confidence Threshold Bug Fix & Ambiguity Detection
- **Status:** 🔵 In Progress (Phase 8 Complete)
- **Priority:** P0 - Critical
- **Effort:** 2-3 days
- **Spec:** `.kiro/specs/confidence-threshold-fix/`
- **Description:** Fix boundary condition bug in intent detection (affects 20% of queries) and add ambiguity detection for better UX
- **Impact:** +20% success rate, -80% cost for edge cases, better user experience
- **Dependencies:** None
- **Blocking:** None
- **Note:** Phase 6 (Analytics and Monitoring) and Phase 7 (Backward Compatibility Testing) are marked as optional and will be implemented later as part of this project. Core functionality (Phases 1-5 + Phase 8) is complete.

---

### 🟠 P1: High Priority (Next in Queue)

#### Project 2: Cross-Company/Cross-Deal RAG per Tenant
- **Status:** ⚪ Not Started
- **Priority:** P1 - High
- **Effort:** 1-2 weeks
- **Spec:** `.kiro/specs/cross-tenant-rag/` (to be created)
- **Description:** Enable querying across multiple companies and deals within a tenant's workspace
- **Impact:** Core functionality for multi-company analysis
- **Dependencies:** Project 1 (confidence fix)
- **Blocking:** Project 3

---

### 🟡 P2: Medium Priority (Future)

#### Project 3: Phase 4 RAG Expansion - Intelligent Computation
- **Status:** ⚪ Not Started
- **Priority:** P2 - Medium
- **Effort:** 2-3 weeks
- **Spec:** `.kiro/specs/rag-intelligent-computation/` (to be created)
- **Description:** 
  - Add graph/chart generation from RAG queries
  - Intelligently compute metrics by calling Python calculator
  - Cache computed results for reuse across tenants
- **Impact:** Advanced analytics capabilities, reduced computation time
- **Dependencies:** Project 2 (cross-tenant RAG)
- **Blocking:** None

#### Project 4: Value Investing Metrics Implementation
- **Status:** ⚪ Not Started
- **Priority:** P2 - Medium
- **Effort:** 6-8 weeks (phased)
- **Spec:** `VALUE_INVESTING_METRICS_ROADMAP.md`
- **Description:** Implement 50 essential metrics for value investing across 8 categories
- **Impact:** Comprehensive financial analysis capabilities for equity analysts
- **Dependencies:** None (can run in parallel with other projects)
- **Blocking:** None

**Metrics Categories:**
1. **Cash Flow Metrics** (10 metrics) - Levered/Unlevered FCF, FCFE, FCFF, Cash Flow Margin, CFROI, Cash Flow to Debt
2. **Valuation Metrics** (15 metrics) - PEG, EV/FCF, P/CF, P/TB, EV/EBIT, Earnings Yield, Dividend Payout, Shiller P/E
3. **Profitability Metrics** (10 metrics) - ROIC, ROCE, EBITDA Margin, Pre-Tax Margin, Asset Turnover, ROTA, RONA
4. **Leverage & Solvency** (8 metrics) - Debt/Equity, Debt/Assets, Interest Coverage, DSCR, Net Debt, Net Debt/EBITDA, Equity Multiplier
5. **Liquidity Metrics** (5 metrics) - Current Ratio, Quick Ratio, Cash Ratio, OCF Ratio, Defensive Interval
6. **Efficiency Metrics** (7 metrics) - Fixed Asset Turnover, Total Asset Turnover, Working Capital Turnover, Payables Turnover, Capital Intensity
7. **Growth Metrics** (5 metrics) - Revenue Growth YoY, Earnings Growth YoY, FCF Growth YoY, Book Value Growth, Sustainable Growth Rate
8. **Quality Metrics** (5 metrics) - Altman Z-Score, Piotroski F-Score, Accrual Ratio, Quality of Earnings, Reinvestment Rate

**Implementation Phases:**
- **Phase 1** (Weeks 1-2): Cash flow + Valuation metrics (25 metrics)
- **Phase 2** (Weeks 3-4): Profitability + Leverage metrics (18 metrics)
- **Phase 3** (Weeks 5-6): Liquidity + Efficiency metrics (12 metrics)
- **Phase 4** (Weeks 7-8): Growth + Quality metrics (10 metrics)

**Technical Checklist per Metric:**
- Add to Python calculator (`comprehensive_financial_calculator.py`)
- Add to metric normalization mapping (`metric_mapping.yaml`)
- Add to intent detector patterns (`intent-detector.service.ts`)
- Add to metric mapping service (`metric-mapping.service.ts`)
- Create unit tests
- Create property tests
- Update API documentation
- Add to clarification prompt suggestions

**Learning Agent Integration:**
- Track which metrics users request most frequently
- Prioritize implementation based on demand
- Log failed queries for analysis
- Provide graceful failure messages
- Auto-update when new metrics are added

---

## Execution Rules

1. **Sequential Execution:** Complete one project before starting the next
2. **Spec-Driven:** Each project must have a complete spec before implementation
3. **Testing Required:** All projects must have comprehensive tests
4. **Documentation:** Update this tracker after each project milestone
5. **Review Gates:** Get user approval before moving to next project

---

## Current Focus

### 🎯 Active Project: Project 1 - Confidence Threshold Fix

**Next Steps:**
1. Create spec directory structure
2. Write requirements document
3. Write design document
4. Create task list
5. Begin implementation

**Quick Links:**
- [Confidence Fix Analysis](./CONFIDENCE_THRESHOLD_AMBIGUITY_ANALYSIS.md)
- [Pressure Test Results](./CONFIDENCE_PRESSURE_TEST.md)
- [Equity Analyst Patterns](./EQUITY_ANALYST_QUERY_PATTERNS.md)

---

## Project Status Legend

- ⚪ Not Started
- 🟡 Ready to Start (spec complete)
- 🔵 In Progress
- 🟢 Complete
- 🔴 Blocked
- ⏸️ Paused

---

## Completion Tracking

| Project | Status | Start Date | End Date | Duration | Notes |
|---------|--------|------------|----------|----------|-------|
| Project 1 | 🔵 In Progress | Feb 5, 2026 | - | - | Phase 8 complete. Phase 6 & 7 deferred. |
| Project 2 | ⚪ Not Started | - | - | - | - |
| Project 3 | ⚪ Not Started | - | - | - | - |
| Project 4 | ⚪ Not Started | - | - | - | - |

---

## Notes

- All projects follow the spec-driven development workflow
- Each project has requirements → design → tasks → implementation
- Testing is mandatory for all projects
- User approval required before moving to next project
