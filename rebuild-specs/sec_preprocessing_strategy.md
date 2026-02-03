# SEC Filing Preprocessing Strategy for FundLens.ai

## Problem Statement
Current semantic chunking destroys table structure, making precise financial metric extraction impossible. Need table-aware preprocessing that preserves numbers + labels + periods.

---

## Architecture: Dual-Path Processing

```
SEC Filing (HTML/EDGAR)
    |
    ├─> Path A: TABLE EXTRACTION → Structured JSON
    |    └─> Store as metadata-rich entries
    |
    └─> Path B: NARRATIVE EXTRACTION → Markdown chunks
         └─> For qualitative analysis (risk factors, MD&A)
```

---

## Step 1: Document Structure Detection

### Tag-Based Section Identification
```python
SECTION_PATTERNS = {
    'balance_sheet': [
        'Consolidated Balance Sheets',
        'Condensed Balance Sheets',
        'Statement of Financial Position'
    ],
    'income_statement': [
        'Consolidated Statements of Operations',
        'Statements of Income',
        'Profit and Loss'
    ],
    'cash_flow': [
        'Consolidated Statements of Cash Flows',
        'Cash Flow Statement'
    ],
    'shareholders_equity': [
        'Statements of Shareholders\' Equity',
        'Statement of Changes in Equity'
    ],
    'segment_data': [
        'Segment Information',
        'Revenue Disaggregation'  # Critical for ASC 606
    ],
    'risk_factors': [
        'Risk Factors',
        'Forward-Looking Statements'
    ],
    'mda': [
        'Management\'s Discussion and Analysis'
    ]
}
```

---

## Step 2: Table Extraction (Path A)

### A. Identify Financial Tables
Use heuristics:
- Tables with numeric columns (>50% cells are numbers)
- Header row contains fiscal periods (FY 2024, Q3 2024, etc.)
- Left column contains financial terms from your normalization file

### B. Extract as Structured JSON
```json
{
  "table_id": "AAPL_10K_2024_balance_sheet_001",
  "document_type": "10-K",
  "company_ticker": "AAPL",
  "fiscal_period": "FY 2024",
  "filing_date": "2024-11-01",
  "section": "balance_sheet",
  "statement_date": "2024-09-28",
  "table_type": "comparative_balance_sheet",
  
  "headers": ["Line Item", "Sep 28, 2024", "Sep 30, 2023"],
  
  "rows": [
    {
      "line_item": "Accounts Payable",
      "normalized_metric": "accounts_payable",  // From your mini_MVP_metrics.xlsx
      "values": [
        {"period": "FY2024", "value": 5234000000, "unit": "USD", "scale": "thousands"},
        {"period": "FY2023", "value": 4891000000, "unit": "USD", "scale": "thousands"}
      ],
      "synonyms": ["Trade Payables", "Payables to Suppliers"],  // From normalization file
      "source": {
        "page": 45,
        "table_number": 1,
        "xbrl_tag": "us-gaap:AccountsPayableCurrent"
      }
    }
  ],
  
  "metadata": {
    "currency": "USD",
    "scale": "thousands",
    "restated": false,
    "notes_reference": "Note 3"
  }
}
```

### C. Storage Strategy
**Option 1: Separate DynamoDB/RDS Table** (Recommended)
```sql
CREATE TABLE financial_metrics (
    metric_id VARCHAR PRIMARY KEY,
    ticker VARCHAR NOT NULL,
    normalized_metric VARCHAR NOT NULL,  -- From mini_MVP_metrics.xlsx
    fiscal_period VARCHAR NOT NULL,
    period_type VARCHAR,  -- 'quarterly', 'annual'
    statement_type VARCHAR,  -- 'balance_sheet', 'income_statement', etc.
    value DECIMAL(20,2),
    unit VARCHAR,
    scale VARCHAR,
    filing_type VARCHAR,  -- '10-K', '10-Q', '8-K'
    filing_date DATE,
    statement_date DATE,
    source_page INT,
    xbrl_tag VARCHAR,
    raw_label TEXT,  -- Original label from filing
    synonyms TEXT[],
    INDEX (ticker, normalized_metric, fiscal_period),
    INDEX (normalized_metric, fiscal_period),
    INDEX (filing_date DESC)
);
```

**Option 2: Enhanced S3 Metadata + Bedrock KB**
If you must stay in Bedrock KB, store tables as:
```markdown
# Financial Statement: Balance Sheet
**Company:** AAPL | **Filing:** 10-K | **Period:** FY 2024 | **Date:** 2024-09-28

## Current Liabilities

| Metric (Normalized) | Raw Label | FY 2024 Value | FY 2023 Value | Unit | XBRL |
|---------------------|-----------|---------------|---------------|------|------|
| accounts_payable | Accounts Payable | 5,234 | 4,891 | USD Millions | us-gaap:AccountsPayableCurrent |
| accrued_expenses | Accrued Expenses | 3,421 | 3,102 | USD Millions | us-gaap:AccruedLiabilitiesCurrent |

**Metadata:**
- Ticker: AAPL
- Statement_Type: balance_sheet
- Period_Type: annual
- Currency: USD
- Scale: millions
```

---

## Step 3: Narrative Text Processing (Path B)

### Extract These Sections as Markdown Chunks
- Risk Factors
- MD&A sections
- Business Description
- Management Commentary

### Use Fixed-Size Chunking (NOT Semantic) for Narrative
```python
CHUNK_SIZE = 1500  # tokens
CHUNK_OVERLAP = 200  # tokens

# Why? Narrative sections have natural paragraph breaks
# Semantic chunking over-groups related concepts
# Fixed chunks with overlap preserve context boundaries
```

### Metadata for Each Chunk
```json
{
  "chunk_id": "AAPL_10K_2024_mda_chunk_003",
  "ticker": "AAPL",
  "filing_type": "10-K",
  "fiscal_period": "FY 2024",
  "section_type": "mda",
  "subsection": "liquidity_and_capital_resources",
  "page_numbers": [32, 33]
}
```

---

## Step 4: Metadata Normalization Integration

### Use Your mini_MVP_metrics.xlsx to Create Mapping Tables

#### 1. Synonym Expansion Dictionary
```python
METRIC_SYNONYMS = {
    "revenue": [
        "Revenue", "Revenues", "Net Revenue", "Net Revenues", 
        "Sales", "Net Sales", "Total Sales", "Operating Revenues",
        "Turnover", "Total net revenue"  # For banks
    ],
    "accounts_payable": [
        "Accounts Payable", "Trade Payables", "Payables to Suppliers",
        "Trade and Other Payables"
    ],
    "gross_profit": [
        "Gross Profit", "Gross Income", "Gross Margin Dollars"
    ]
    # ... Load all 100+ mappings from your sheets
}
```

#### 2. Calculation Logic Storage
For computed metrics like EBITDA:
```python
COMPUTED_METRICS = {
    "ebitda": {
        "formula": "ebit + depreciation_amortization",
        "components": ["ebit", "depreciation_amortization"],
        "fallback_sources": [
            "cash_flow_statement.depreciation_amortization",
            "income_statement.depreciation_expense"
        ]
    },
    "fcf": {
        "formula": "operating_cash_flow - capex",
        "components": ["operating_cash_flow", "capex"],
        "notes": "Use GAAP CFO minus CapEx from Investing"
    }
}
```

#### 3. Period Handling Rules
```python
PERIOD_RULES = {
    "latest": {
        "quarterly": "most_recent_10Q",
        "annual": "most_recent_10K",
        "provide_both": True  # Your prompt requirement!
    },
    "ttm": {
        "method": "sum_last_4_quarters",
        "fallback": "latest_fy + ytd_current - ytd_prior"
    }
}
```

---

## Step 5: Query Processing Layer

### Two-Stage Retrieval

#### Stage 1: Document Routing
```python
def route_query(user_query: str) -> dict:
    """
    Determine which filing types and sections to search
    """
    query_lower = user_query.lower()
    
    # Document type routing
    if any(kw in query_lower for kw in ['latest fiscal year', 'annual', 'fy ']):
        doc_types = ['10-K']
    elif 'quarter' in query_lower or 'q1' in query_lower or 'q2' in query_lower:
        doc_types = ['10-Q']
    elif 'latest' in query_lower:
        doc_types = ['10-Q', '10-K']  # Need both!
    else:
        doc_types = ['10-K', '10-Q', '8-K']
    
    # Section routing
    metric_type = extract_metric(query_lower)  # "accounts payable"
    
    if metric_type in BALANCE_SHEET_METRICS:
        sections = ['balance_sheet']
    elif metric_type in INCOME_STATEMENT_METRICS:
        sections = ['income_statement', 'segment_data']  # Don't forget segments!
    elif metric_type in CASH_FLOW_METRICS:
        sections = ['cash_flow']
    else:
        sections = ['all']
    
    return {
        'doc_types': doc_types,
        'sections': sections,
        'metric': metric_type,
        'normalized_metric': normalize_metric(metric_type)  # Use your synonym map
    }
```

#### Stage 2: Structured Query for Tables
```python
def query_structured_tables(ticker: str, metric: str, period: str) -> dict:
    """
    Query the structured financial metrics table/index
    """
    # This is SQL if using RDS, or metadata filter if using Bedrock KB
    
    query = f"""
    SELECT ticker, normalized_metric, fiscal_period, value, unit, 
           filing_type, statement_date, raw_label, source_page
    FROM financial_metrics
    WHERE ticker = '{ticker}'
      AND normalized_metric = '{metric}'
      AND (
          (period_type = 'quarterly' AND filing_type = '10-Q')
          OR (period_type = 'annual' AND filing_type = '10-K')
      )
    ORDER BY statement_date DESC
    LIMIT 10
    """
    
    # Returns EXACT values with full provenance
    # No LLM hallucination possible on numbers!
```

#### Stage 3: Narrative Context Retrieval (Optional)
```python
# Only retrieve narrative chunks if query asks for "why" or "context"
if query_needs_narrative_context(user_query):
    vector_results = bedrock_kb.search(
        query=expanded_query,
        filter={
            'ticker': ticker,
            'section_type': 'mda',
            'filing_type': doc_types
        },
        top_k=5
    )
```

---

## Step 6: Response Construction

### Combine Structured + Narrative
```python
def construct_response(user_query: str, structured_data: dict, narrative_chunks: list):
    """
    Build LLM prompt with facts pre-filled
    """
    
    # Extract the EXACT numbers from structured data
    latest_quarterly = structured_data['10-Q'][0]  # Most recent
    latest_annual = structured_data['10-K'][0]
    
    # Pre-fill the response template
    response_template = f"""
📊 **Summary Answer**
{ticker}'s {metric_name}:
- Latest quarterly ({latest_quarterly['fiscal_period']}): ${latest_quarterly['value']:,.0f}M
- Latest annual ({latest_annual['fiscal_period']}): ${latest_annual['value']:,.0f}M

📅 **Temporal Analysis**
Latest Quarterly Results:
{format_quarterly_trends(structured_data['10-Q'])}

Latest Annual Results:
{format_annual_trends(structured_data['10-K'])}

📄 **Source Documentation**
- Document: {latest_quarterly['filing_type']} | Period: {latest_quarterly['fiscal_period']} | Page: {latest_quarterly['source_page']}
- Document: {latest_annual['filing_type']} | Period: {latest_annual['fiscal_period']} | Page: {latest_annual['source_page']}
"""
    
    # Only ask LLM to add narrative context if needed
    if narrative_chunks:
        llm_prompt = f"""
Given the following EXACT financial data (DO NOT CHANGE THESE NUMBERS):
{response_template}

And this management commentary:
{format_narrative(narrative_chunks)}

Add a brief "💡 Key Insights" section explaining trends and context.
DO NOT modify the numbers above.
"""
```

---

## Implementation Priority

### Week 1: Table Extraction POC
1. Parse one 10-K for AAPL
2. Extract Balance Sheet as JSON
3. Test query: "What is AAPL's accounts payable for latest fiscal year?"
4. Compare current system vs. structured retrieval

### Week 2: Normalization Pipeline
1. Load mini_MVP_metrics.xlsx into mapping tables
2. Apply synonym matching during extraction
3. Tag each row with normalized_metric ID

### Week 3: Document Routing
1. Implement Stage 1 routing logic
2. Filter Bedrock KB queries by metadata
3. Test 10-K vs 10-Q routing

### Week 4: Full Integration
1. Parallel processing: tables + narrative
2. Response construction with pre-filled facts
3. LLM only for narrative synthesis

---

## Why This Fixes Your Problem

### Before (Current):
```
User: "Give me accounts payable for AAPL latest fiscal year"
    ↓
Semantic chunking retrieves 100 random chunks
    ↓
LLM tries to parse: "payable... 5234... fiscal... 2024... maybe?"
    ↓
❌ Wrong number or hallucination
```

### After (Proposed):
```
User: "Give me accounts payable for AAPL latest fiscal year"
    ↓
Route to: ticker=AAPL, metric=accounts_payable, doc_type=10-K
    ↓
SQL query returns: {value: 5234, period: "FY2024", page: 45}
    ↓
✅ EXACT answer with source
```

---

## Tools & Libraries

### Table Extraction
- **BeautifulSoup4** + pandas for HTML tables
- **Tabula-py** for PDF tables (if needed)
- **SEC-EDGAR-Downloader** for raw HTML
- **XBRL-US API** (optional, for tagged data)

### Preprocessing
```bash
pip install beautifulsoup4 pandas lxml sec-edgar-downloader openpyxl
```

### Sample Code for Table Detection
```python
from bs4 import BeautifulSoup
import pandas as pd

def extract_financial_tables(html_content: str) -> list:
    soup = BeautifulSoup(html_content, 'lxml')
    tables = []
    
    for table in soup.find_all('table'):
        df = pd.read_html(str(table))[0]
        
        # Check if financial table (heuristic)
        if is_financial_table(df):
            tables.append({
                'dataframe': df,
                'context': extract_context(table),  # Headers before table
                'table_html': str(table)
            })
    
    return tables

def is_financial_table(df: pd.DataFrame) -> bool:
    """Heuristic: >50% of cells are numeric, has period headers"""
    numeric_ratio = df.apply(pd.to_numeric, errors='coerce').notna().sum().sum() / df.size
    
    # Check if header row contains fiscal periods
    header_text = ' '.join(str(x) for x in df.columns)
    has_periods = any(pattern in header_text.lower() 
                     for pattern in ['2024', '2023', 'fy ', 'fiscal'])
    
    return numeric_ratio > 0.5 and has_periods
```

---

## Next Steps

1. **Validate table extraction** on 5 different companies
2. **Build synonym mapper** from your mini_MVP_metrics.xlsx
3. **Test routing logic** with 20 sample queries
4. **Benchmark accuracy** vs. current system

Want me to build out any specific component?
