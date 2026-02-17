# Workspace Page Decomposition — February 17, 2026

## Summary

Decomposed the 5,784-line `workspace.html` monolith into 7 independent HTML pages plus shared infrastructure. This eliminates Alpine.js 3.x proxy crashes caused by a single massive reactive object and enables independent page loading, better caching, and future module extensibility.

## Architecture

- **Module-agnostic shell** (`public/app/_shell.js`) — Provides nav bar, sidebar, breadcrumbs, auth, filing notifications, event bus, and entity context. Reads configuration from `window.FundLensModuleConfig`.
- **Shared utilities** (`public/app/_utils.js`) — Formatting functions (`formatCurrency`, `formatPercent`, `formatRatio`, `formatDays`, `deepCopy`) used across all pages.
- **Equity module config** (`public/app/deals/_module-config.js`) — Defines sidebar groups, entity type (`ticker`), breadcrumb paths, and entity info loader for the Equity Research module.

## New Pages

| Page | File | Purpose |
|------|------|---------|
| Quantitative | `quantitative.html` | Financial metrics, ratios, growth analysis |
| Qualitative | `qualitative.html` | MD&A analysis, qualitative data sections |
| Export | `export.html` | Excel export wizard with period/statement selection |
| Provocations | `provocations.html` | AI-generated provocations and sentiment analysis |
| Research | `research.html` | Research assistant chat, Instant RAG, citations |
| Scratchpad | `scratchpad.html` | Saved research items with delete/report actions |
| IC Memo | `ic-memo.html` | Investment committee memo generation via SSE |

## Key Design Decisions

- No build step — all JS via `<script>` tags using `window` globals
- Each page defines a `window.FundLensXxxView` function in a `<script>` tag, referenced from `x-data="FundLensShell('pageName', FundLensXxxView())"` — avoids inline JS breaking HTML attribute boundaries
- `JSON.parse(JSON.stringify(...))` deep copy on all API responses to prevent Alpine proxy issues
- URL-based navigation: `navigateTo('research')` → `window.location.href = '/app/deals/research.html?ticker=AAPL'`
- Cross-page params: `navigateToWithParams('research', { query: encodedQuestion })` for provocations → research flow
- Event bus: `shellOn`/`shellEmit` for scratchpad count updates across pages
- Grouped sidebar (Analysis, Tools, Research) with keyboard shortcuts (⌘1-7)

## Backward Compatibility

- `workspace.html` replaced with a redirect hub that maps hash fragments to new pages
- `workspace-monolith-backup.html` preserves the original file

## Bug Fix: Inline JS Rendering as Visible Text

All 7 pages initially had JavaScript inlined in `x-data="..."` attributes. Double quotes in regex patterns, querySelector calls, and string literals broke the HTML attribute boundary, causing raw JS to render as visible text. Fixed by extracting page JS into `<script>` tags with `window.FundLensXxxView = function() { ... }` pattern.

## Spec

Full requirements, design, and task list at `.kiro/specs/workspace-page-decomposition/`.
