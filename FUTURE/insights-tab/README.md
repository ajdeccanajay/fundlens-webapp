# Insights Tab - Moved to FUTURE

**Date Moved:** February 2, 2026  
**Reason:** Feature deemed too shallow for Research Analysts - not providing enough value-add

## What Was Moved

### Backend Services (`src/deals/`)
- `insights.controller.ts` - Main insights API controller
- `insights.service.ts` - Insights business logic
- `anomaly-detection.service.ts` - Statistical anomaly detection
- `comp-table.service.ts` - Comparison table builder
- `change-tracker.service.ts` - Period-over-period change detection
- `metric-hierarchy.service.ts` - Metric hierarchy/decomposition
- `footnote-linking.service.ts` - Footnote context linking
- `mda-intelligence.service.ts` - MD&A intelligence extraction

### Tests (`test/`)
- Unit tests for all services
- E2E tests for all features
- Performance tests

### Specs (`.kiro/specs/insights-tab-redesign/`)
- Complete requirements, design, and implementation docs
- All phase completion summaries
- Testing strategies

### Documentation (`docs/`)
- Quick reference guides
- All changelogs from Feb 2, 2026
- Implementation summaries

## Features That Were Implemented

1. **Anomaly Detection** - Statistical outliers, sequential changes, trend reversals, tone shifts
2. **Comparison Tables** - Multi-company metric comparisons with percentiles
3. **Change Tracker** - Period-over-period change detection (new disclosures, metric changes, accounting changes)
4. **Metric Hierarchy** - Hierarchical metric decomposition
5. **Footnote Linking** - Context panels with footnote references

## Why It Was Removed

The Insights tab features were too shallow and didn't provide enough value for Research Analysts:
- Anomaly detection required 4+ data points and was often empty
- Comparison tables were basic - analysts need deeper competitive analysis
- Change tracking was surface-level - didn't capture nuanced changes
- Overall: Not cutting it for professional research workflows

## If You Want to Revive This

1. All code is preserved here
2. Backend services are fully functional
3. Tests have 80%+ coverage
4. Just need to:
   - Re-add services to `src/deals/deals.module.ts`
   - Re-add navigation in `public/app/deals/workspace.html`
   - Re-add frontend sections in workspace.html

## Better Alternatives to Build

Instead of shallow insights, consider:
- **Deep Competitive Intelligence** - Industry positioning, market share analysis
- **Thesis Builder** - Help analysts build investment theses with evidence
- **Scenario Modeling** - What-if analysis with multiple scenarios
- **Peer Benchmarking** - Comprehensive peer analysis across multiple dimensions
- **Earnings Call Analysis** - Sentiment analysis, management tone, Q&A insights
