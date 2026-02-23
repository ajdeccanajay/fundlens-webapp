# FundLens Metric & Concept Registries

## Summary Statistics
| Category | Count |
|---|---|
| Atomic Metrics (universal) | 122 |
| Sector-Specific Metrics (GICS) | 71 |
| PE-Specific Metrics | 14 |
| Computed/Derived Metrics | 45 |
| Analytical Concepts | 10 |
| **Total Metrics** | **252** |
| **Total Synonyms** | **1,209** |

## Directory Structure & Storage (S3)

```
s3://fundlens-registries/
├── universal/                          # From your existing spreadsheet (122 metrics)
│   ├── income_statement.yaml           # 28 metrics (Revenue → EBIT, EBITDA, Adj Net Income)
│   ├── balance_sheet.yaml              # 30 metrics (Cash → Total Equity)
│   ├── cash_flow.yaml                  # 28 metrics (CFO → FCF)
│   └── equity_statement.yaml           # 22 metrics (Beginning → Ending balances)
│
├── sector/                             # GICS sector-specific metrics
│   ├── revenue_by_industry.yaml        # 20 sector revenue variants (SaaS, Banking, Insurance, etc.)
│   ├── energy.yaml                     # 7 metrics (Reserves, Production, LOE, EBITDAX, etc.)
│   ├── materials.yaml                  # 3 metrics (Ore Grade, AISC, Tonnage)
│   ├── industrials.yaml                # 3 metrics (Backlog, Book-to-Bill, Capacity Util)
│   ├── consumer_discretionary.yaml     # 3 metrics (SSS, AUV, Store Count)
│   ├── consumer_staples.yaml           # 2 metrics (Organic Growth, Price/Mix/Volume)
│   ├── healthcare.yaml                 # 3 metrics (Pipeline, Patent Cliff, MLR)
│   ├── financials.yaml                 # 12 metrics (NIM, CET1, Efficiency Ratio, Combined Ratio, etc.)
│   ├── info_tech.yaml                  # 8 metrics (ARR, NRR, CAC, LTV/CAC, Rule of 40, etc.)
│   ├── communication_services.yaml     # 3 metrics (Subscribers, Churn, ARPS)
│   ├── utilities.yaml                  # 3 metrics (Rate Base, Allowed ROE, Generation Capacity)
│   └── real_estate.yaml                # 5 metrics (FFO, NOI, Occupancy, Cap Rate, NAV)
│
├── pe_specific/                        # Private equity metrics
│   └── return_and_fund_metrics.yaml    # 14 metrics (MOIC, IRR, DPI, TVPI, Dry Powder, etc.)
│
├── computed/                           # Derived/calculated metrics (feeds your calc engine)
│   └── all_computed_metrics.yaml       # 45 formulas with dependencies
│       ├── Profitability (7): GM%, Op Margin, EBITDA Margin, Net Margin, ROE, ROA, ROIC
│       ├── Leverage (7): Net Debt, Total Debt, ND/EBITDA, D/E, D/Assets, Interest Coverage, Debt/EBITDA
│       ├── Liquidity (4): Current Ratio, Quick Ratio, Cash Ratio, Working Capital
│       ├── Efficiency (6): Asset Turnover, Inventory Turnover, DSO, DPO, DIO, CCC
│       ├── Valuation (12): EV, EV/EBITDA, EV/Revenue, EV/EBIT, P/E, P/B, P/S, P/FCF, FCF Yield, etc.
│       ├── Capital Allocation (5): FCF, CapEx/Rev, CapEx/D&A, Payout Ratio, Buyback Yield, TSY
│       ├── Growth (1): Revenue CAGR 3yr
│       └── Per Share (3): EPS, Revenue/Share, FCF/Share
│
├── concepts/                           # Analytical question → metric bundle mapping
│   └── analytical_concepts.yaml        # 10 concepts with triggers, metrics, and RAG prompts
│       ├── leverage                    # "How levered is this company?"
│       ├── profitability               # "What's the margin profile?"
│       ├── liquidity                   # "Can they pay their bills?"
│       ├── capital_allocation          # "How do they spend cash?"
│       ├── earnings_quality            # "Are these earnings real?"
│       ├── valuation                   # "Is it cheap or expensive?"
│       ├── growth                      # "How fast are they growing?"
│       ├── efficiency                  # "How efficient are operations?"
│       ├── downside_protection         # "What's the margin of safety?"
│       └── management_alignment        # "Is management aligned?"
│
└── clients/                            # Client-specific synonym overlays
    └── third_avenue.yaml               # Third Avenue Management terminology
```

## How Kiro Should Use These Files

### At Application Startup
1. Load all YAML files from `universal/`, `sector/`, `pe_specific/`, and `computed/`
2. Build the inverted synonym index (normalize all synonyms → canonical metric ID)
3. Load the `concepts/` registry for the Intent Router
4. Load the active client overlay from `clients/` and merge additional_synonyms

### Key Design Notes
- Every metric has a unique canonical ID (the YAML key, e.g., `cash_and_cash_equivalents`)
- The `display_name` is what the analyst sees — never show canonical IDs in the UI
- Computed metrics reference other metrics by canonical ID in their `dependencies` array
- The calc engine resolves dependencies recursively (some computed metrics depend on other computed metrics)
- Concepts map to metric bundles filtered by sector and asset class
- The `context_prompt` in concepts feeds the RAG pipeline for narrative context

### Synonym Normalization Rule
All synonyms should be indexed using aggressive normalization:
```
normalize_for_lookup(text) → strip all non-alphanumeric, lowercase
"Cash & Cash Equivalents" → "cashandcashequivalents"
"SG&A" → "sga"
"Net Debt / EBITDA" → "netdebtebitda"
```

### Adding New Metrics
1. Add to the appropriate YAML file
2. Include 8-15 synonyms covering: formal name, abbreviations, analyst shorthand, plain English
3. For computed metrics: specify formula and all dependencies
4. Rebuild the inverted index on next deploy

### Adding New Clients
1. Create a new file in `clients/` (e.g., `clients/apollo.yaml`)
2. Add `additional_synonyms` under relevant metric overrides
3. These merge on top of universal synonyms at login time
