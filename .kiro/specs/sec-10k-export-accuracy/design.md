# Design Document: SEC 10-K Export Accuracy

## Overview

This design document describes the architecture for achieving 100% accuracy in SEC 10-K, 10-Q, and 8-K income statement exports. The system uses GICS (Global Industry Classification Standard) sector-based templates to ensure exports match actual SEC filing structures exactly.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Export Request Flow                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────────┐    ┌─────────────────────────┐   │
│  │   Frontend   │───▶│ ExportController │───▶│    ExportService        │   │
│  │  (Request)   │    │                  │    │                         │   │
│  └──────────────┘    └──────────────────┘    └───────────┬─────────────┘   │
│                                                          │                  │
│                                                          ▼                  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      Industry Detection                               │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │  │
│  │  │ GICS Ticker Map │  │ Metric Pattern  │  │   Fallback to      │  │  │
│  │  │   (Primary)     │  │   Analysis      │  │   Generic Template │  │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                          │                  │
│                                                          ▼                  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      Template Registry                                │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │ GICS Sector Templates (11 sectors)                             │  │  │
│  │  │ • Communication Services (CMCSA, DIS, T, VZ, GOOGL, META)     │  │  │
│  │  │ • Financials (JPM, BAC, GS, BRK, MET, V, MA)                  │  │  │
│  │  │ • Information Technology (AAPL, MSFT, NVDA, CSCO)             │  │  │
│  │  │ • Consumer Discretionary (AMZN, TSLA, HD, MCD)                │  │  │
│  │  │ • Consumer Staples (PG, KO, WMT, COST)                        │  │  │
│  │  │ • Health Care (UNH, JNJ, PFE, ABBV)                           │  │  │
│  │  │ • Energy (XOM, CVX, COP, SLB)                                 │  │  │
│  │  │ • Utilities (NEE, DUK, SO, D)                                 │  │  │
│  │  │ • Real Estate (AMT, PLD, CCI, EQIX)                           │  │  │
│  │  │ • Industrials (UNP, HON, UPS, CAT)                            │  │  │
│  │  │ • Materials (LIN, APD, SHW, FCX)                              │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                          │                  │
│                                                          ▼                  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      Statement Mapper                                 │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │  │
│  │  │ Metric Alias    │  │ Data Filtering  │  │   Row Generation   │  │  │
│  │  │ Resolution      │  │ (skip missing)  │  │   (exact order)    │  │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                          │                  │
│                                                          ▼                  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      XLSX Generator                                   │  │
│  │  • Generates Excel workbook with exact SEC 10-K structure            │  │
│  │  • Preserves display names, headers, indentation                     │  │
│  │  • Supports 10-K, 10-Q, and 8-K filing types                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Industry Detector (ExportService.detectIndustry)

**Location:** `src/deals/export.service.ts`

**Responsibility:** Automatically detect a company's GICS sector based on ticker symbol.

**Implementation:**
```typescript
// GICS Sector Ticker Mappings (11 sectors)
const COMMUNICATION_SERVICES_TICKERS = ['CMCSA', 'DIS', 'NFLX', 'T', 'VZ', 'TMUS', 'GOOGL', 'META', ...];
const FINANCIALS_TICKERS = ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'BRK.A', 'BRK.B', 'V', 'MA', ...];
const INFORMATION_TECHNOLOGY_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'CSCO', 'ADBE', ...];
// ... 8 more sector arrays

private async detectIndustry(ticker: string): Promise<IndustryType | undefined> {
  const upperTicker = ticker.toUpperCase();
  if (COMMUNICATION_SERVICES_TICKERS.includes(upperTicker)) return 'communication_services';
  if (FINANCIALS_TICKERS.includes(upperTicker)) return 'financials';
  // ... check all 11 sectors
  return undefined; // Falls back to generic template
}
```

#### 2. Template Registry (StatementMapper static templates)

**Location:** `src/deals/statement-mapper.ts`

**Responsibility:** Store industry-specific income statement templates with exact SEC 10-K structure.

**Template Structure:**
```typescript
interface MetricDefinition {
  normalizedMetric: string;  // Database metric name
  displayName: string;       // Exact SEC 10-K label
  isHeader?: boolean;        // Section header (REVENUE, COSTS AND EXPENSES)
  indent?: number;           // Indentation level (0, 1, 2)
  format?: 'currency' | 'percentage' | 'number' | 'eps';
}

// Example: Communication Services (Media) Template
static readonly MEDIA_INCOME_STATEMENT: MetricDefinition[] = [
  { normalizedMetric: 'revenue_header', displayName: 'REVENUE', isHeader: true },
  { normalizedMetric: 'net_sales', displayName: 'Revenue', format: 'currency' },
  { normalizedMetric: 'costs_header', displayName: 'COSTS AND EXPENSES', isHeader: true },
  { normalizedMetric: 'programming_and_production', displayName: 'Programming and production', format: 'currency', indent: 1 },
  { normalizedMetric: 'marketing_and_promotion', displayName: 'Marketing and promotion', format: 'currency', indent: 1 },
  // ... exact SEC 10-K order
];
```

#### 3. Metric Alias Resolver

**Location:** `src/deals/statement-mapper.ts` (METRIC_ALIASES constant)

**Responsibility:** Map alternative metric names to primary names for consistent data retrieval.

**Implementation:**
```typescript
const METRIC_ALIASES: Record<string, string[]> = {
  'interest_expense': ['interest_expense_nonoperating', 'interest_expense_operating'],
  'revenue': ['net_sales', 'total_revenue', 'revenues'],
  'net_income': ['net_income_loss', 'profit_loss'],
  'cost_of_revenue': ['cost_of_goods_sold', 'cost_of_sales'],
  'operating_income': ['income_from_operations', 'operating_profit'],
  'income_tax_expense': ['provision_for_income_taxes', 'income_tax_provision'],
};
```

#### 4. Statement Mapper (mapMetricsToStatementWithDiscovery)

**Location:** `src/deals/statement-mapper.ts`

**Responsibility:** Map raw database metrics to ordered statement rows using industry-specific templates.

**Key Logic:**
1. Select template based on detected industry
2. For each metric in template, check if data exists
3. Resolve aliases if primary metric not found
4. Skip metrics with no data (no N/A rows)
5. Preserve exact order from template

```typescript
mapMetricsToStatementWithDiscovery(
  rawMetrics: RawMetric[],
  statementType: StatementType,
  periods: string[],
  industry?: IndustryType,
): MetricRow[] {
  // Select industry-specific template
  let allMetricDefs: MetricDefinition[];
  if (industry === 'communication_services' && statementType === StatementType.INCOME_STATEMENT) {
    allMetricDefs = StatementMapper.MEDIA_INCOME_STATEMENT;
  } else {
    // Use generic template with industry additions
    const config = this.getStatementConfig(statementType);
    const industryAdditions = this.getIndustryAdditions(statementType, industry);
    allMetricDefs = [...config.metricOrder, ...industryAdditions];
  }
  
  // Map metrics with alias resolution and data filtering
  // Only include rows where data exists
}
```

## Data Models

### IndustryType (GICS Sectors)

```typescript
type IndustryType = 
  | 'energy'                  // GICS 10
  | 'materials'               // GICS 15
  | 'industrials'             // GICS 20
  | 'consumer_discretionary'  // GICS 25
  | 'consumer_staples'        // GICS 30
  | 'health_care'             // GICS 35
  | 'financials'              // GICS 40
  | 'information_technology'  // GICS 45
  | 'communication_services'  // GICS 50
  | 'utilities'               // GICS 55
  | 'real_estate';            // GICS 60
```

### MetricRow (Output)

```typescript
interface MetricRow {
  displayName: string;           // Exact SEC label
  normalizedMetric: string;      // Database metric name
  values: Map<string, number | null>;  // Period → value
  reportingUnits: Map<string, string>; // Period → unit (millions, etc.)
  isHeader?: boolean;
  indent?: number;
  format?: 'currency' | 'percentage' | 'number' | 'eps';
}
```

## Industry-Specific Templates

### Communication Services (GICS 50) - Media Companies

**Companies:** CMCSA, DIS, NFLX, WBD, PARA, FOX, T, VZ, TMUS, GOOGL, META

**Template Structure (matches CMCSA SEC 10-K page 61):**
1. REVENUE (header)
2. Revenue
3. COSTS AND EXPENSES (header)
4. Programming and production (indent 1)
5. Marketing and promotion (indent 1)
6. Other operating and administrative (indent 1)
7. Depreciation (indent 1)
8. Amortization (indent 1)
9. Goodwill and long-lived asset impairments (indent 1)
10. Total costs and expenses
11. Operating income
12. Interest expense (indent 1)
13. Investment and other income (loss), net (indent 1)
14. Income before income taxes
15. Income tax expense
16. Net income
17. Less: Net income attributable to noncontrolling interests (indent 1)
18. Net income attributable to [Company] (optional)
19. PER SHARE DATA (header)
20. Basic earnings per common share
21. Diluted earnings per common share

### Financials (GICS 40) - Banks & Insurance

**Companies:** JPM, BAC, WFC, C, GS, MS, BRK.A, BRK.B, MET, PRU, V, MA

**Template Structure:**
1. Net Interest Income
2. Interest Income components (indent 1)
3. Interest Expense components (indent 1)
4. Provision for Credit Losses
5. Noninterest Income
6. Investment Banking Fees (indent 1)
7. Trading Revenue (indent 1)
8. Asset Management Fees (indent 1)
9. Noninterest Expense
10. Compensation & Benefits (indent 1)
11. Income before income taxes
12. Income tax expense
13. Net income

### Information Technology (GICS 45)

**Companies:** AAPL, MSFT, NVDA, AVGO, CSCO, ADBE, CRM, ORCL, INTC, AMD

**Template Structure:**
1. Net sales / Revenue
2. Cost of sales
3. Gross margin
4. Research and development
5. Selling, general and administrative
6. Operating income
7. Other income (expense), net
8. Income before provision for income taxes
9. Provision for income taxes
10. Net income
11. Earnings per share - basic
12. Earnings per share - diluted

### Utilities (GICS 55)

**Companies:** NEE, DUK, SO, D, AEP, EXC, SRE, XEL

**Template Structure:**
1. Electric Revenue
2. Gas Revenue
3. Fuel Costs
4. Purchased Power
5. Operating and Maintenance
6. Depreciation and Amortization
7. Operating Income
8. Interest Expense
9. Income Before Taxes
10. Income Tax Expense
11. Net Income

### Real Estate (GICS 60) - REITs

**Companies:** AMT, PLD, CCI, EQIX, PSA, SPG, O, WELL, DLR

**Template Structure:**
1. Rental Revenue
2. Tenant Reimbursements
3. Property Operating Expenses
4. Net Operating Income (NOI)
5. Depreciation and Amortization
6. General and Administrative
7. Operating Income
8. Interest Expense
9. Income Before Taxes
10. Net Income
11. Funds from Operations (FFO)
12. Adjusted FFO (AFFO)

## Industry-Specific Balance Sheet Templates

### Communication Services (GICS 50) - Media Companies

**Companies:** CMCSA, DIS, NFLX, WBD, PARA, FOX, T, VZ, TMUS, GOOGL, META

**Balance Sheet Template Structure:**
1. ASSETS (header)
2. Current Assets (header)
3. Cash and cash equivalents
4. Receivables, net
5. Programming rights
6. Other current assets
7. Total current assets
8. Film and television costs
9. Investments
10. Property and equipment, net
11. Goodwill
12. Franchise rights
13. Other intangible assets, net
14. Other noncurrent assets
15. Total assets
16. LIABILITIES AND EQUITY (header)
17. Current Liabilities (header)
18. Accounts payable and accrued expenses
19. Accrued participations and residuals
20. Deferred revenue
21. Current portion of long-term debt
22. Total current liabilities
23. Long-term debt
24. Deferred income taxes
25. Other noncurrent liabilities
26. Total liabilities
27. Redeemable noncontrolling interests
28. EQUITY (header)
29. Common stock
30. Additional paid-in capital
31. Retained earnings
32. Treasury stock
33. Accumulated other comprehensive income (loss)
34. Total stockholders' equity
35. Noncontrolling interests
36. Total equity
37. Total liabilities and equity

### Financials (GICS 40) - Banks

**Companies:** JPM, BAC, WFC, C, GS, MS

**Balance Sheet Template Structure:**
1. ASSETS (header)
2. Cash and due from banks
3. Deposits with banks
4. Federal funds sold and securities purchased under resale agreements
5. Securities borrowed
6. Trading assets
7. Available-for-sale securities
8. Held-to-maturity securities
9. Investment securities
10. Loans (net of allowance for loan losses)
11. Accrued interest and accounts receivable
12. Premises and equipment
13. Goodwill
14. Mortgage servicing rights
15. Other intangible assets
16. Other assets
17. Total assets
18. LIABILITIES (header)
19. Deposits
20. Federal funds purchased and securities loaned or sold under repurchase agreements
21. Short-term borrowings
22. Trading liabilities
23. Accounts payable and other liabilities
24. Beneficial interests issued by consolidated VIEs
25. Long-term debt
26. Total liabilities
27. STOCKHOLDERS' EQUITY (header)
28. Preferred stock
29. Common stock
30. Additional paid-in capital
31. Retained earnings
32. Accumulated other comprehensive income (loss)
33. Treasury stock
34. Total stockholders' equity
35. Noncontrolling interests
36. Total equity
37. Total liabilities and stockholders' equity

### Information Technology (GICS 45)

**Companies:** AAPL, MSFT, NVDA, AVGO, CSCO, ADBE

**Balance Sheet Template Structure:**
1. ASSETS (header)
2. Current Assets (header)
3. Cash and cash equivalents
4. Marketable securities
5. Accounts receivable, net
6. Inventories
7. Vendor non-trade receivables
8. Other current assets
9. Total current assets
10. Non-Current Assets (header)
11. Marketable securities
12. Property, plant and equipment, net
13. Other non-current assets
14. Total non-current assets
15. Total assets
16. LIABILITIES AND SHAREHOLDERS' EQUITY (header)
17. Current Liabilities (header)
18. Accounts payable
19. Other current liabilities
20. Deferred revenue
21. Commercial paper
22. Term debt
23. Total current liabilities
24. Non-Current Liabilities (header)
25. Term debt
26. Other non-current liabilities
27. Total non-current liabilities
28. Total liabilities
29. SHAREHOLDERS' EQUITY (header)
30. Common stock and additional paid-in capital
31. Retained earnings
32. Accumulated other comprehensive income (loss)
33. Total shareholders' equity
34. Total liabilities and shareholders' equity

### Energy (GICS 10)

**Companies:** XOM, CVX, COP, EOG, SLB

**Balance Sheet Template Structure:**
1. ASSETS (header)
2. Current Assets (header)
3. Cash and cash equivalents
4. Accounts and notes receivable
5. Inventories
6. Other current assets
7. Total current assets
8. Investments and advances
9. Property, plant and equipment, net
10. Other assets, including intangibles
11. Total assets
12. LIABILITIES (header)
13. Current Liabilities (header)
14. Notes and loans payable
15. Accounts payable and accrued liabilities
16. Income taxes payable
17. Total current liabilities
18. Long-term debt
19. Postretirement benefits reserves
20. Deferred income tax liabilities
21. Other long-term obligations
22. Total liabilities
23. EQUITY (header)
24. Common stock
25. Earnings reinvested
26. Accumulated other comprehensive income (loss)
27. Common stock held in treasury
28. Total shareholders' equity
29. Noncontrolling interests
30. Total equity
31. Total liabilities and equity

### Utilities (GICS 55)

**Companies:** NEE, DUK, SO, D, AEP

**Balance Sheet Template Structure:**
1. ASSETS (header)
2. Current Assets (header)
3. Cash and cash equivalents
4. Customer receivables
5. Other receivables
6. Inventory
7. Regulatory assets - current
8. Other current assets
9. Total current assets
10. Property, Plant and Equipment (header)
11. Electric utility plant in service
12. Gas utility plant in service
13. Accumulated depreciation
14. Net property, plant and equipment
15. Regulatory assets
16. Goodwill
17. Other assets
18. Total assets
19. LIABILITIES AND EQUITY (header)
20. Current Liabilities (header)
21. Short-term debt
22. Current maturities of long-term debt
23. Accounts payable
24. Customer deposits
25. Regulatory liabilities - current
26. Other current liabilities
27. Total current liabilities
28. Long-term debt
29. Deferred income taxes
30. Regulatory liabilities
31. Asset retirement obligations
32. Other liabilities
33. Total liabilities
34. EQUITY (header)
35. Common stock equity
36. Accumulated other comprehensive income (loss)
37. Noncontrolling interests
38. Total equity
39. Total liabilities and equity

### Real Estate (GICS 60) - REITs

**Companies:** AMT, PLD, CCI, EQIX, PSA

**Balance Sheet Template Structure:**
1. ASSETS (header)
2. Real estate (header)
3. Land
4. Buildings and improvements
5. Construction in progress
6. Total real estate
7. Less: accumulated depreciation
8. Real estate, net
9. Cash and cash equivalents
10. Tenant and other receivables
11. Deferred rent receivable
12. Intangible assets, net
13. Other assets
14. Total assets
15. LIABILITIES AND EQUITY (header)
16. Liabilities (header)
17. Unsecured debt
18. Secured debt
19. Accounts payable and accrued expenses
20. Distributions payable
21. Deferred revenue
22. Other liabilities
23. Total liabilities
24. EQUITY (header)
25. Preferred stock
26. Common stock
27. Additional paid-in capital
28. Accumulated other comprehensive income (loss)
29. Distributions in excess of earnings
30. Total stockholders' equity
31. Noncontrolling interests
32. Total equity
33. Total liabilities and equity

## Industry-Specific Cash Flow Statement Templates

### Communication Services (GICS 50) - Media Companies

**Cash Flow Template Structure:**
1. OPERATING ACTIVITIES (header)
2. Net income
3. Adjustments to reconcile net income (header)
4. Depreciation and amortization
5. Share-based compensation
6. Deferred income taxes
7. Amortization of film and television costs
8. Impairment charges
9. Net (gain) loss on investments
10. Changes in operating assets and liabilities (header)
11. Change in receivables
12. Change in film and television costs
13. Change in accounts payable and accrued expenses
14. Change in other operating assets and liabilities
15. Net cash provided by operating activities
16. INVESTING ACTIVITIES (header)
17. Capital expenditures
18. Cash paid for intangible assets
19. Acquisitions, net of cash acquired
20. Proceeds from sales of businesses and investments
21. Purchases of investments
22. Other investing activities
23. Net cash used in investing activities
24. FINANCING ACTIVITIES (header)
25. Proceeds from borrowings
26. Repayments of debt
27. Repurchases of common stock
28. Dividends paid
29. Distributions to noncontrolling interests
30. Other financing activities
31. Net cash used in financing activities
32. Effect of exchange rate changes on cash
33. Increase (decrease) in cash and cash equivalents
34. Cash and cash equivalents, beginning of year
35. Cash and cash equivalents, end of year

### Financials (GICS 40) - Banks

**Cash Flow Template Structure:**
1. OPERATING ACTIVITIES (header)
2. Net income
3. Adjustments to reconcile net income (header)
4. Provision for credit losses
5. Depreciation and amortization
6. Deferred tax expense (benefit)
7. Stock-based compensation
8. Securities gains (losses)
9. Originations and purchases of loans held-for-sale
10. Proceeds from sales and paydowns of loans held-for-sale
11. Net change in trading assets
12. Net change in other assets
13. Net change in other liabilities
14. Other operating adjustments
15. Net cash provided by operating activities
16. INVESTING ACTIVITIES (header)
17. Net change in deposits with banks
18. Proceeds from maturities of securities
19. Proceeds from sales of securities
20. Purchases of securities
21. Net change in loans
22. Net change in federal funds sold
23. Purchases of premises and equipment
24. Proceeds from sales of premises and equipment
25. Other investing activities
26. Net cash provided by (used in) investing activities
27. FINANCING ACTIVITIES (header)
28. Net change in deposits
29. Net change in federal funds purchased
30. Net change in short-term borrowings
31. Proceeds from long-term borrowings
32. Repayments of long-term borrowings
33. Proceeds from issuance of stock
34. Treasury stock purchased
35. Cash dividends paid
36. Other financing activities
37. Net cash provided by (used in) financing activities
38. Effect of exchange rate changes on cash
39. Net increase (decrease) in cash and due from banks
40. Cash and due from banks at beginning of year
41. Cash and due from banks at end of year

### Information Technology (GICS 45)

**Cash Flow Template Structure:**
1. OPERATING ACTIVITIES (header)
2. Net income
3. Adjustments to reconcile net income (header)
4. Depreciation and amortization
5. Share-based compensation expense
6. Deferred income tax expense (benefit)
7. Other
8. Changes in operating assets and liabilities (header)
9. Accounts receivable
10. Inventories
11. Vendor non-trade receivables
12. Other current and non-current assets
13. Accounts payable
14. Deferred revenue
15. Other current and non-current liabilities
16. Cash generated by operating activities
17. INVESTING ACTIVITIES (header)
18. Purchases of marketable securities
19. Proceeds from maturities of marketable securities
20. Proceeds from sales of marketable securities
21. Payments for acquisition of property, plant and equipment
22. Payments made in connection with business acquisitions
23. Other
24. Cash used in investing activities
25. FINANCING ACTIVITIES (header)
26. Payments for taxes related to net share settlement
27. Payments for dividends and dividend equivalents
28. Repurchases of common stock
29. Proceeds from issuance of term debt
30. Repayments of term debt
31. Proceeds from (repayments of) commercial paper
32. Other
33. Cash used in financing activities
34. Increase (decrease) in cash, cash equivalents and restricted cash
35. Cash, cash equivalents and restricted cash, beginning of period
36. Cash, cash equivalents and restricted cash, end of period

### Energy (GICS 10)

**Cash Flow Template Structure:**
1. OPERATING ACTIVITIES (header)
2. Net income
3. Adjustments for noncash items (header)
4. Depreciation and depletion
5. Deferred income tax expense
6. Postretirement benefits expense
7. Impairments
8. (Gains) losses on asset sales
9. Other
10. Changes in operational working capital (header)
11. Accounts and notes receivable
12. Inventories
13. Accounts payable and accrued liabilities
14. Income taxes payable
15. Other
16. Net cash provided by operating activities
17. INVESTING ACTIVITIES (header)
18. Additions to property, plant and equipment
19. Proceeds from asset sales
20. Acquisitions
21. Additional investments and advances
22. Other investing activities
23. Net cash used in investing activities
24. FINANCING ACTIVITIES (header)
25. Additions to long-term debt
26. Reductions in long-term debt
27. Additions to short-term debt
28. Reductions in short-term debt
29. Cash dividends to shareholders
30. Common stock acquired
31. Other financing activities
32. Net cash used in financing activities
33. Effect of exchange rate changes
34. Increase (decrease) in cash and cash equivalents
35. Cash and cash equivalents at beginning of year
36. Cash and cash equivalents at end of year

### Utilities (GICS 55)

**Cash Flow Template Structure:**
1. OPERATING ACTIVITIES (header)
2. Net income
3. Adjustments to reconcile net income (header)
4. Depreciation and amortization
5. Deferred income taxes
6. Allowance for equity funds used during construction
7. Pension and other postretirement benefit costs
8. Stock compensation expense
9. Other
10. Changes in assets and liabilities (header)
11. Receivables
12. Inventory
13. Regulatory assets and liabilities
14. Accounts payable
15. Accrued taxes
16. Other assets and liabilities
17. Net cash provided by operating activities
18. INVESTING ACTIVITIES (header)
19. Capital expenditures
20. Nuclear fuel purchases
21. Proceeds from sales of assets
22. Acquisitions
23. Other investing activities
24. Net cash used in investing activities
25. FINANCING ACTIVITIES (header)
26. Issuance of long-term debt
27. Retirement of long-term debt
28. Issuance of common stock
29. Repurchase of common stock
30. Dividends paid on common stock
31. Short-term debt, net
32. Other financing activities
33. Net cash provided by (used in) financing activities
34. Net increase (decrease) in cash and cash equivalents
35. Cash and cash equivalents at beginning of period
36. Cash and cash equivalents at end of period

### Real Estate (GICS 60) - REITs

**Cash Flow Template Structure:**
1. OPERATING ACTIVITIES (header)
2. Net income
3. Adjustments to reconcile net income (header)
4. Depreciation and amortization
5. Amortization of deferred financing costs
6. Straight-line rent adjustments
7. Stock-based compensation
8. Gain on sale of real estate
9. Impairment charges
10. Changes in assets and liabilities (header)
11. Tenant and other receivables
12. Deferred rent receivable
13. Other assets
14. Accounts payable and accrued expenses
15. Other liabilities
16. Net cash provided by operating activities
17. INVESTING ACTIVITIES (header)
18. Acquisitions of real estate
19. Capital expenditures
20. Proceeds from sales of real estate
21. Investments in unconsolidated entities
22. Other investing activities
23. Net cash used in investing activities
24. FINANCING ACTIVITIES (header)
25. Proceeds from unsecured debt
26. Repayments of unsecured debt
27. Proceeds from secured debt
28. Repayments of secured debt
29. Proceeds from issuance of common stock
30. Repurchases of common stock
31. Dividends paid to common stockholders
32. Dividends paid to preferred stockholders
33. Distributions to noncontrolling interests
34. Other financing activities
35. Net cash provided by (used in) financing activities
36. Net increase (decrease) in cash and cash equivalents
37. Cash and cash equivalents at beginning of period
38. Cash and cash equivalents at end of period

## Validation Strategy

### Test Fixtures

Each industry template will have corresponding test fixtures derived from actual SEC 10-K filings:

```
test/fixtures/sec-10k-structures/
├── communication_services/
│   ├── CMCSA_2024_income_statement.json
│   ├── CMCSA_2024_balance_sheet.json
│   ├── CMCSA_2024_cash_flow.json
│   ├── DIS_2024_income_statement.json
│   └── T_2024_income_statement.json
├── financials/
│   ├── JPM_2024_income_statement.json
│   ├── JPM_2024_balance_sheet.json
│   ├── JPM_2024_cash_flow.json
│   └── BAC_2024_income_statement.json
├── information_technology/
│   ├── AAPL_2024_income_statement.json
│   ├── AAPL_2024_balance_sheet.json
│   ├── AAPL_2024_cash_flow.json
│   └── MSFT_2024_income_statement.json
├── energy/
│   ├── XOM_2024_income_statement.json
│   ├── XOM_2024_balance_sheet.json
│   └── XOM_2024_cash_flow.json
├── utilities/
│   ├── NEE_2024_income_statement.json
│   ├── NEE_2024_balance_sheet.json
│   └── NEE_2024_cash_flow.json
├── real_estate/
│   ├── AMT_2024_income_statement.json
│   ├── AMT_2024_balance_sheet.json
│   └── AMT_2024_cash_flow.json
└── ... (other sectors)
```

### Validation Tests

```typescript
describe('SEC 10-K Export Accuracy', () => {
  describe('Communication Services - CMCSA', () => {
    it('should match SEC 10-K page 61 structure exactly', async () => {
      const export = await exportService.generateExcelExportByTicker('CMCSA', {
        filingType: FilingType.TEN_K,
        exportMode: ExportMode.ANNUAL,
        years: ['2024'],
        statements: [StatementType.INCOME_STATEMENT],
      });
      
      const expectedStructure = loadFixture('communication_services/CMCSA_2024_income_statement.json');
      
      // Validate line item names match exactly
      expect(export.lineItems.map(l => l.displayName)).toEqual(expectedStructure.lineItems);
      
      // Validate order is preserved
      expect(export.lineItems).toHaveLength(expectedStructure.lineItems.length);
    });
  });
});
```

## Correctness Properties

### Property 1: Template Selection Determinism
**Validates: Requirement 2.1, 2.2**

For any given ticker, the industry detection must always return the same GICS sector, ensuring consistent template selection across exports.

```typescript
// Property: detectIndustry(ticker) is deterministic
forAll(ticker: string, () => {
  const result1 = detectIndustry(ticker);
  const result2 = detectIndustry(ticker);
  return result1 === result2;
});
```

### Property 2: No Duplicate Line Items
**Validates: Requirement 3.7**

The metric alias resolver must never produce duplicate line items for the same concept.

```typescript
// Property: No duplicate normalized metrics in output
forAll(rawMetrics: RawMetric[], industry: IndustryType, () => {
  const rows = mapMetricsToStatementWithDiscovery(rawMetrics, StatementType.INCOME_STATEMENT, ['2024'], industry);
  const normalizedMetrics = rows.filter(r => !r.isHeader).map(r => r.normalizedMetric);
  return new Set(normalizedMetrics).size === normalizedMetrics.length;
});
```

### Property 3: Order Preservation
**Validates: Requirement 4.4**

The output row order must match the template order for all metrics that have data.

```typescript
// Property: Output order matches template order
forAll(rawMetrics: RawMetric[], industry: IndustryType, () => {
  const rows = mapMetricsToStatementWithDiscovery(rawMetrics, StatementType.INCOME_STATEMENT, ['2024'], industry);
  const template = getTemplateForIndustry(industry);
  const templateOrder = template.map(t => t.normalizedMetric);
  const outputOrder = rows.map(r => r.normalizedMetric);
  
  // Output order should be a subsequence of template order
  return isSubsequence(outputOrder, templateOrder);
});
```

### Property 4: Data Availability Filtering
**Validates: Requirement 5.1, 5.2**

Only metrics with actual data should appear in the output; no N/A or empty rows.

```typescript
// Property: All non-header rows have at least one non-null value
forAll(rawMetrics: RawMetric[], industry: IndustryType, () => {
  const rows = mapMetricsToStatementWithDiscovery(rawMetrics, StatementType.INCOME_STATEMENT, ['2024'], industry);
  return rows.filter(r => !r.isHeader).every(r => {
    const values = Array.from(r.values.values());
    return values.some(v => v !== null && v !== undefined);
  });
});
```

### Property 5: Display Name Accuracy
**Validates: Requirement 9.1, 9.2**

Display names must exactly match the template definitions (no modifications).

```typescript
// Property: Display names match template exactly
forAll(rawMetrics: RawMetric[], industry: IndustryType, () => {
  const rows = mapMetricsToStatementWithDiscovery(rawMetrics, StatementType.INCOME_STATEMENT, ['2024'], industry);
  const template = getTemplateForIndustry(industry);
  
  return rows.every(row => {
    const templateDef = template.find(t => t.normalizedMetric === row.normalizedMetric);
    return templateDef ? row.displayName === templateDef.displayName : true;
  });
});
```

## File Changes

### Modified Files

1. **src/deals/export.types.ts**
   - Update `IndustryType` to use GICS sector codes (11 sectors)

2. **src/deals/export.service.ts**
   - Add GICS sector ticker mappings (50+ tickers per sector)
   - Update `detectIndustry()` to use GICS sectors
   - Ensure industry detection works for 10-K, 10-Q, and 8-K

3. **src/deals/statement-mapper.ts**
   - Add industry-specific income statement templates for each GICS sector
   - Update `mapMetricsToStatementWithDiscovery()` to use sector-specific templates
   - Update `getIndustryAdditions()` to map GICS sectors to templates

### New Files

1. **test/fixtures/sec-10k-structures/** - Test fixtures for validation
2. **test/unit/sec-10k-accuracy.spec.ts** - Validation test suite

## Dependencies

- **ExcelJS** - For XLSX generation (existing)
- **Prisma** - For database queries (existing)
- **Jest** - For testing (existing)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SEC format changes | Templates become outdated | Template versioning, annual review process |
| Missing ticker mappings | Wrong template used | Metric pattern analysis fallback, logging |
| Alias conflicts | Duplicate rows | Alias priority rules, deduplication logic |
| Performance with large datasets | Slow exports | Pagination, caching of template lookups |

## Implementation Notes

### Current State (Already Implemented)

1. ✅ GICS-based `IndustryType` in `export.types.ts`
2. ✅ GICS sector ticker mappings in `export.service.ts`
3. ✅ `detectIndustry()` method using GICS sectors
4. ✅ `MEDIA_INCOME_STATEMENT` template for Communication Services
5. ✅ `mapMetricsToStatementWithDiscovery()` using industry templates
6. ✅ Metric alias resolution via `METRIC_ALIASES`
7. ✅ Data filtering (skip metrics with no data)

### Remaining Work

1. ⬜ Add complete income statement templates for remaining GICS sectors
2. ⬜ Add complete balance sheet templates for all GICS sectors
3. ⬜ Add complete cash flow statement templates for all GICS sectors
4. ⬜ Create test fixtures from actual SEC 10-K filings (all 3 statement types)
5. ⬜ Implement validation test suite for all statement types
6. ⬜ Add template versioning support


## AI-Enhanced Validation Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      AI Validation & Learning Pipeline                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    AI Completeness Validator                          │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │  │
│  │  │ SEC Filing      │  │ LLM Structure   │  │   Completeness     │  │  │
│  │  │ Fetcher (EDGAR) │─▶│ Extractor       │─▶│   Scorer           │  │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │  │
│  │           │                    │                     │               │  │
│  │           ▼                    ▼                     ▼               │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐│  │
│  │  │                    Structure Cache (Redis/DB)                   ││  │
│  │  │  • Filing CIK + Accession → Extracted Structure                 ││  │
│  │  │  • TTL: 1 year (filings don't change)                          ││  │
│  │  └─────────────────────────────────────────────────────────────────┘│  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                      │                                      │
│                                      ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Automated Template Generator                       │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │  │
│  │  │ Multi-Filing    │  │ Structure       │  │   Template          │  │  │
│  │  │ Analyzer        │─▶│ Merger          │─▶│   Synthesizer       │  │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │  │
│  │           │                                          │               │  │
│  │           ▼                                          ▼               │  │
│  │  ┌─────────────────┐                    ┌─────────────────────────┐ │  │
│  │  │ Industry        │                    │ MetricDefinition[]      │ │  │
│  │  │ Commonality     │                    │ Output Format           │ │  │
│  │  │ Analysis        │                    │                         │ │  │
│  │  └─────────────────┘                    └─────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                      │                                      │
│                                      ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Continuous Learning Pipeline                       │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │  │
│  │  │ Discrepancy     │  │ Pattern         │  │   Template          │  │  │
│  │  │ Logger          │─▶│ Aggregator      │─▶│   Proposer          │  │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │  │
│  │           │                    │                     │               │  │
│  │           ▼                    ▼                     ▼               │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │  │
│  │  │ Discrepancy DB  │  │ Weekly Reports  │  │   Approval Queue    │  │  │
│  │  │ (PostgreSQL)    │  │ (Email/Slack)   │  │   (Admin UI)        │  │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. AI Completeness Validator

**Location:** `src/deals/ai-validator.service.ts`

**Responsibility:** Use LLM to extract expected structure from SEC filings and compare against exports.

**Implementation:**
```typescript
interface AIValidatorService {
  // Fetch SEC filing from EDGAR and extract structure using LLM
  extractFilingStructure(ticker: string, filingType: FilingType, year: string): Promise<ExtractedStructure>;
  
  // Compare export against expected structure
  validateExport(export: ExportResult, expectedStructure: ExtractedStructure): ValidationResult;
  
  // Batch validation for multiple exports
  batchValidate(exports: ExportResult[]): Promise<ValidationResult[]>;
}

interface ExtractedStructure {
  ticker: string;
  filingType: FilingType;
  year: string;
  lineItems: ExtractedLineItem[];
  extractedAt: Date;
  llmModel: string;
  confidence: number;
}

interface ExtractedLineItem {
  displayName: string;
  normalizedMetric: string;  // LLM-suggested normalized name
  position: number;
  indent: number;
  isHeader: boolean;
}

interface ValidationResult {
  ticker: string;
  completenessScore: number;  // 0-100
  missingMetrics: string[];
  extraMetrics: string[];
  orderDiscrepancies: OrderDiscrepancy[];
  passed: boolean;  // true if score >= 95%
}
```

**LLM Prompt Template:**
```
Analyze this SEC 10-K income statement and extract the exact structure:

[SEC Filing Content]

Return a JSON array of line items with:
- displayName: exact text as shown in filing
- isHeader: true if this is a section header (e.g., "REVENUE", "COSTS AND EXPENSES")
- indent: indentation level (0, 1, or 2)
- normalizedMetric: suggested snake_case metric name

Preserve exact order and capitalization.
```

#### 2. Automated Template Generator

**Location:** `src/deals/template-generator.service.ts`

**Responsibility:** Analyze multiple SEC filings to generate comprehensive industry templates.

**Implementation:**
```typescript
interface TemplateGeneratorService {
  // Analyze multiple filings for an industry
  analyzeIndustryFilings(industry: IndustryType, tickers: string[], years: string[]): Promise<IndustryAnalysis>;
  
  // Generate template from analysis
  generateTemplate(analysis: IndustryAnalysis): MetricDefinition[];
  
  // Identify metrics needing manual review
  flagInconsistentMetrics(analysis: IndustryAnalysis): InconsistentMetric[];
}

interface IndustryAnalysis {
  industry: IndustryType;
  filingsAnalyzed: number;
  commonMetrics: MetricFrequency[];  // Metrics appearing in >50% of filings
  rareMetrics: MetricFrequency[];    // Metrics appearing in <50% of filings
  orderConsensus: string[];          // Most common ordering
}

interface MetricFrequency {
  normalizedMetric: string;
  displayNames: string[];  // All variations seen
  frequency: number;       // Percentage of filings containing this metric
  averagePosition: number; // Average position in income statement
}
```

**Template Generation Algorithm:**
1. Fetch 3-5 SEC 10-K filings for representative companies in the industry
2. Extract structure from each using LLM
3. Normalize metric names across filings
4. Calculate frequency of each metric
5. Include metrics with >50% frequency in template
6. Order by average position across filings
7. Use most common display name for each metric

#### 3. Continuous Learning Pipeline

**Location:** `src/deals/learning-pipeline.service.ts`

**Responsibility:** Log discrepancies, identify patterns, and propose template improvements.

**Database Schema:**
```sql
-- Discrepancy log table
CREATE TABLE export_discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(10) NOT NULL,
  industry VARCHAR(50) NOT NULL,
  filing_type VARCHAR(10) NOT NULL,
  year VARCHAR(4) NOT NULL,
  discrepancy_type VARCHAR(20) NOT NULL,  -- 'missing', 'extra', 'order', 'name'
  metric_name VARCHAR(100) NOT NULL,
  expected_value TEXT,
  actual_value TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Template proposals table
CREATE TABLE template_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry VARCHAR(50) NOT NULL,
  proposal_type VARCHAR(20) NOT NULL,  -- 'add_metric', 'remove_metric', 'reorder'
  metric_name VARCHAR(100) NOT NULL,
  display_name VARCHAR(200),
  position INTEGER,
  supporting_evidence JSONB,  -- Array of discrepancy IDs
  status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  reviewed_by VARCHAR(100)
);

-- Accuracy metrics tracking
CREATE TABLE accuracy_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry VARCHAR(50) NOT NULL,
  week_start DATE NOT NULL,
  total_exports INTEGER NOT NULL,
  avg_completeness_score DECIMAL(5,2),
  exports_below_95 INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Implementation:**
```typescript
interface LearningPipelineService {
  // Log a discrepancy
  logDiscrepancy(discrepancy: Discrepancy): Promise<void>;
  
  // Aggregate discrepancies and identify patterns
  analyzePatterns(industry: IndustryType, timeRange: DateRange): Promise<PatternAnalysis>;
  
  // Generate template proposals
  generateProposals(patterns: PatternAnalysis): Promise<TemplateProposal[]>;
  
  // Generate weekly report
  generateWeeklyReport(): Promise<WeeklyReport>;
  
  // Apply approved proposal to template
  applyProposal(proposalId: string): Promise<void>;
}

interface PatternAnalysis {
  industry: IndustryType;
  timeRange: DateRange;
  frequentMissingMetrics: MetricPattern[];  // Metrics missing in >3 exports
  frequentExtraMetrics: MetricPattern[];
  orderIssues: OrderPattern[];
}

interface TemplateProposal {
  industry: IndustryType;
  type: 'add_metric' | 'remove_metric' | 'reorder' | 'rename';
  metric: string;
  displayName?: string;
  position?: number;
  evidence: string[];  // Discrepancy IDs supporting this proposal
  confidence: number;  // Based on frequency and consistency
}
```

### AI Validation Correctness Properties

#### Property 6: LLM Extraction Consistency
**Validates: Requirement 11.1**

For the same SEC filing, the LLM should extract a consistent structure (within tolerance for minor variations).

```typescript
// Property: LLM extraction is consistent for same filing
forAll(ticker: string, filingType: FilingType, year: string, () => {
  const result1 = await extractFilingStructure(ticker, filingType, year);
  const result2 = await extractFilingStructure(ticker, filingType, year);
  
  // Allow for minor LLM variations but core structure should match
  const coreMetrics1 = result1.lineItems.filter(l => !l.isHeader).map(l => l.normalizedMetric);
  const coreMetrics2 = result2.lineItems.filter(l => !l.isHeader).map(l => l.normalizedMetric);
  
  return jaccardSimilarity(coreMetrics1, coreMetrics2) >= 0.9;
});
```

#### Property 7: Completeness Score Bounds
**Validates: Requirement 11.3**

Completeness score must always be between 0 and 100, and should be 100 when export matches expected structure exactly.

```typescript
// Property: Completeness score is bounded and accurate
forAll(export: ExportResult, expectedStructure: ExtractedStructure, () => {
  const result = validateExport(export, expectedStructure);
  
  // Score is bounded
  if (result.completenessScore < 0 || result.completenessScore > 100) return false;
  
  // Perfect match = 100%
  if (result.missingMetrics.length === 0 && result.extraMetrics.length === 0) {
    return result.completenessScore === 100;
  }
  
  return true;
});
```

#### Property 8: Template Generation Determinism
**Validates: Requirement 12.5**

Given the same set of analyzed filings, template generation should produce consistent output.

```typescript
// Property: Template generation is deterministic
forAll(analysis: IndustryAnalysis, () => {
  const template1 = generateTemplate(analysis);
  const template2 = generateTemplate(analysis);
  
  return JSON.stringify(template1) === JSON.stringify(template2);
});
```

#### Property 9: Discrepancy Logging Completeness
**Validates: Requirement 13.1**

All validation failures should result in logged discrepancies.

```typescript
// Property: All validation failures are logged
forAll(export: ExportResult, expectedStructure: ExtractedStructure, () => {
  const result = validateExport(export, expectedStructure);
  const loggedDiscrepancies = getDiscrepanciesForExport(export.id);
  
  // Every missing metric should be logged
  const loggedMissing = loggedDiscrepancies.filter(d => d.type === 'missing').map(d => d.metric);
  return result.missingMetrics.every(m => loggedMissing.includes(m));
});
```

### Integration with Existing System

The AI validation components integrate with the existing export flow:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Export Request │────▶│  ExportService  │────▶│  XLSX Generator │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                 │                       │
                                 ▼                       ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │  AI Validator   │◀────│  Export Result  │
                        │  (async)        │     │                 │
                        └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Learning       │
                        │  Pipeline       │
                        └─────────────────┘
```

**Validation is async and non-blocking** - exports complete immediately, validation runs in background.

### Configuration

```typescript
// AI Validation Configuration
interface AIValidationConfig {
  enabled: boolean;
  llmProvider: 'anthropic' | 'openai';
  llmModel: string;  // 'claude-3-sonnet' or 'gpt-4'
  completenessThreshold: number;  // Default: 95
  cacheEnabled: boolean;
  cacheTTLDays: number;  // Default: 365
  batchSize: number;  // For batch validation
  proposalThreshold: number;  // Min discrepancies to generate proposal (default: 3)
}
```

### Dependencies

- **@anthropic-ai/sdk** or **openai** - For LLM API calls
- **Redis** (optional) - For caching extracted structures
- **node-cron** - For scheduled weekly reports
- **nodemailer** or **@slack/web-api** - For report delivery
