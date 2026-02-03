# FundLens.ai Implementation Roadmap
## Fixing SEC Filings Retrieval Accuracy

---

## Executive Summary

**Current Problem:**  
Semantic chunking + 100-chunk retrieval is destroying table structure, making precise financial metrics unretrievable.

**Root Cause:**  
Treating structured financial tables (numbers + labels + periods) like unstructured narrative text.

**Solution:**  
Dual-path processing: **structured extraction** for tables + **semantic chunking** for narratives.

**Expected Impact:**  
- ✅ 95%+ accuracy on "give me X metric for Y period" queries
- ✅ Eliminate hallucination on numbers
- ✅ Support complex queries like "latest" = both Q + FY
- ✅ Enable TTM calculations and period comparisons

---

## Phase 1: Table Extraction POC (Week 1)

### Goal
Prove that structured extraction works for one company.

### Tasks

#### 1.1 Setup Dependencies
```bash
pip install beautifulsoup4 lxml pandas sec-edgar-downloader openpyxl boto3
```

#### 1.2 Download Sample Filing
```python
from sec_edgar_downloader import Downloader

dl = Downloader("YourCompanyName", "your.email@fundlens.ai")

# Download AAPL's latest 10-K
dl.get("10-K", "AAPL", limit=1)
# This creates: sec-edgar-filings/AAPL/10-K/0000320193-24-000123/full-submission.txt
```

#### 1.3 Extract Tables Using sec_table_extractor.py
```python
from sec_table_extractor import MetricNormalizer, SECTableExtractor, BedrockMetadataFormatter

# Load your normalization mappings
normalizer = MetricNormalizer('/path/to/mini_MVP_metrics.xlsx')

# Initialize extractor
extractor = SECTableExtractor(normalizer)

# Load HTML
with open('sec-edgar-filings/AAPL/10-K/.../full-submission.txt', 'r') as f:
    html_content = f.read()

# Extract metrics
metrics = extractor.extract_tables(
    html_content=html_content,
    ticker='AAPL',
    filing_type='10-K',
    filing_date='2024-11-01'
)

# Format for Bedrock
formatter = BedrockMetadataFormatter()
markdown = formatter.format_as_markdown(metrics, 'AAPL')

print(f"Extracted {len(metrics)} metrics")
print(markdown)
```

#### 1.4 Validation Test
Manually verify 10 random metrics against the actual 10-K:
- [ ] Accounts Payable value matches?
- [ ] Fiscal period correct?
- [ ] Source page accurate?
- [ ] Synonym mapping worked?

**Success Criteria:**  
9/10 metrics extracted correctly with proper metadata.

---

## Phase 2: Structured Storage Setup (Week 2)

### Option A: AWS RDS PostgreSQL (Recommended)

#### 2.1 Create Database Schema
```sql
CREATE TABLE financial_metrics (
    metric_id VARCHAR(255) PRIMARY KEY,
    ticker VARCHAR(10) NOT NULL,
    normalized_metric VARCHAR(100) NOT NULL,
    raw_label VARCHAR(255) NOT NULL,
    fiscal_period VARCHAR(50) NOT NULL,
    period_type VARCHAR(20),  -- 'quarterly', 'annual'
    statement_type VARCHAR(50),  -- 'balance_sheet', 'income_statement', etc.
    value DECIMAL(20,2),
    unit VARCHAR(10),
    scale VARCHAR(20),  -- 'thousands', 'millions', 'billions'
    filing_type VARCHAR(10),  -- '10-K', '10-Q', '8-K'
    filing_date DATE,
    statement_date DATE,
    source_page INT,
    xbrl_tag VARCHAR(100),
    table_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_ticker_metric (ticker, normalized_metric),
    INDEX idx_metric_period (normalized_metric, fiscal_period),
    INDEX idx_filing_date (filing_date DESC),
    INDEX idx_statement_date (statement_date DESC)
);

CREATE TABLE metric_synonyms (
    synonym VARCHAR(255) PRIMARY KEY,
    normalized_metric VARCHAR(100) NOT NULL,
    source VARCHAR(50),  -- 'mini_MVP_metrics.xlsx', 'XBRL', etc.
    INDEX idx_normalized (normalized_metric)
);
```

#### 2.2 Populate Synonym Table
```python
import pandas as pd
import psycopg2

# Load mini_MVP_metrics.xlsx
df = pd.read_excel('mini_MVP_metrics.xlsx', sheet_name='IS+BS+CF+SE-Condensed')

# Connect to RDS
conn = psycopg2.connect(
    host='your-rds-endpoint.rds.amazonaws.com',
    database='fundlens',
    user='admin',
    password='your-password'
)

cursor = conn.cursor()

# Insert synonyms
for _, row in df.iterrows():
    metric_id = row['Direct Metric']
    synonyms_str = row['Synonyms']
    
    if pd.notna(synonyms_str):
        synonyms = [s.strip() for s in str(synonyms_str).split(';')]
        
        for synonym in synonyms:
            cursor.execute(
                "INSERT INTO metric_synonyms (synonym, normalized_metric, source) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (synonym, metric_id, 'mini_MVP_metrics.xlsx')
            )

conn.commit()
print(f"Loaded {cursor.rowcount} synonyms")
```

### Option B: Enhanced Bedrock KB Metadata

If you must stay in Bedrock KB only:

#### 2.3 Create Metadata-Rich Markdown Files
```python
# For each extracted table, create a separate markdown file
# with EXTENSIVE metadata in frontmatter

markdown_template = f"""---
ticker: AAPL
filing_type: 10-K
fiscal_period: FY2024
period_type: annual
statement_type: balance_sheet
filing_date: 2024-11-01
statement_date: 2024-09-28
---

# {ticker} - {statement_type} - {fiscal_period}

## Metadata
- **Company:** {ticker}
- **Filing:** {filing_type}
- **Period:** {fiscal_period}
- **Statement Type:** {statement_type}

## Metrics

| Normalized Metric | Raw Label | Value | Unit | Scale | XBRL Tag |
|-------------------|-----------|-------|------|-------|----------|
{generate_rows()}

---
**Query Keywords:** {ticker}, {fiscal_period}, {statement_type}, accounts payable, revenue, net income
"""
```

#### 2.4 Configure Bedrock KB Metadata Filters
```python
# When querying Bedrock KB, use metadata filters
bedrock_response = bedrock_kb.search(
    query="accounts payable",
    filter={
        'and': [
            {'equals': {'key': 'ticker', 'value': 'AAPL'}},
            {'equals': {'key': 'filing_type', 'value': '10-K'}},
            {'equals': {'key': 'statement_type', 'value': 'balance_sheet'}}
        ]
    },
    top_k=5  # Much lower than 100!
)
```

---

## Phase 3: Query Processing Integration (Week 3)

### 3.1 Integrate query_processor.py

```python
from query_processor import QueryRouter, StructuredRetriever, ResponseBuilder

# Initialize
router = QueryRouter(normalizer)

# User query
user_query = "What is AAPL's accounts payable for latest fiscal year?"

# Parse intent
intent = router.parse_query(user_query)

# Retrieve structured data
retriever = StructuredRetriever(metrics_db)
structured_data = retriever.retrieve_metrics(intent)

# Build response
response = ResponseBuilder.build_response(
    intent=intent,
    structured_data=structured_data,
    narrative_chunks=None  # Add MD&A context if needed
)

print(response)
```

### 3.2 Handle "Latest" Queries Correctly

**Test Cases:**
```python
test_cases = [
    {
        'query': "What is TSLA's latest revenue?",
        'expected_doc_types': ['10-Q', '10-K'],  # MUST retrieve both
        'expected_response_includes': ['Q3 2024', 'FY 2023']  # Both periods
    },
    {
        'query': "What is TSLA's latest quarterly revenue?",
        'expected_doc_types': ['10-Q'],
        'expected_response_includes': ['Q3 2024']
    },
    {
        'query': "What is TSLA's Q3 2024 revenue?",
        'expected_doc_types': ['10-Q'],
        'expected_response_includes': ['Q3 2024']
    }
]

for test in test_cases:
    intent = router.parse_query(test['query'])
    assert intent.doc_types == test['expected_doc_types'], f"Failed: {test['query']}"
```

---

## Phase 4: Bedrock Prompt Optimization (Week 4)

### 4.1 Revise Your System Prompt

**Current Issue:**  
Your prompt is 100% post-retrieval formatting. It doesn't improve *what* gets retrieved.

**New Approach:**  
Use a two-stage prompt:

#### Stage 1: Pre-Retrieval Filter (in Lambda/Application Code)
```python
# This happens BEFORE calling Bedrock KB
intent = router.parse_query(user_query)

# Build metadata filter
metadata_filter = {
    'ticker': intent.ticker,
    'filing_type': intent.doc_types,
    'normalized_metric': intent.normalized_metric,
    'statement_type': intent.statement_types
}

# Query Bedrock KB with filters
kb_results = bedrock_kb.retrieve(
    retrievalQuery={'text': user_query},
    retrievalConfiguration={
        'vectorSearchConfiguration': {
            'numberOfResults': 5,  # NOT 100!
            'filter': metadata_filter
        }
    }
)
```

#### Stage 2: Post-Retrieval Synthesis (LLM Prompt)
```python
# Simplified prompt for LLM - just synthesis, not retrieval
synthesis_prompt = f"""
You are a financial analyst. You have been provided with EXACT metric values from SEC filings.

User Query: {user_query}

**EXACT DATA (DO NOT MODIFY THESE NUMBERS):**
{pre_filled_facts_from_structured_retrieval}

**Management Commentary:**
{narrative_chunks_if_needed}

Your task:
1. Present the exact numbers provided above
2. Add brief context from management commentary if relevant
3. DO NOT change, round, or approximate any numbers
4. Use the response format specified in the system prompt

Response:
"""
```

### 4.2 Reduce Chunk Retrieval

**Current:** 100 chunks  
**Target:** 5-10 chunks

**Why:**  
- You're getting random fragments across 100 chunks
- Metadata filtering + lower k = more precise results
- Structured retrieval eliminates need for high k

---

## Phase 5: Scale to 10+ Companies (Week 5-6)

### 5.1 Batch Processing Pipeline
```python
import boto3
from concurrent.futures import ThreadPoolExecutor

tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'JPM', 'BAC', 'WFC']

def process_ticker(ticker):
    # Download latest 10-K and 10-Q
    dl = Downloader("FundLens", "ajay@fundlens.ai")
    dl.get("10-K", ticker, limit=1)
    dl.get("10-Q", ticker, limit=3)  # Last 3 quarters
    
    # Extract metrics
    # ... (reuse extraction code)
    
    # Store in RDS
    # ... (bulk insert)

# Parallel processing
with ThreadPoolExecutor(max_workers=5) as executor:
    executor.map(process_ticker, tickers)
```

### 5.2 Automate Daily Updates
```python
# AWS Lambda function (triggered daily)
import boto3

def lambda_handler(event, context):
    # Check for new filings on SEC.gov
    recent_filings = check_sec_rss_feed()
    
    for filing in recent_filings:
        if filing['form_type'] in ['10-K', '10-Q', '8-K']:
            # Download and process
            process_filing(filing)
            
            # Update Bedrock KB
            upload_to_s3(processed_markdown, filing['ticker'])
    
    return {'statusCode': 200}
```

---

## Testing & Validation

### Accuracy Test Suite
```python
test_queries = [
    ("What is AAPL's accounts payable for latest fiscal year?", "5234M", "FY2024"),
    ("Give me TSLA's latest revenue", ["Q3 2024", "FY 2023"]),  # Must have both!
    ("What was MSFT's Q2 2024 operating income?", "27.9B", "Q2 2024"),
    ("Show me AMZN's free cash flow for FY 2023", "84.9B", "FY2023")
]

def run_accuracy_test():
    correct = 0
    total = len(test_queries)
    
    for query, expected_value, expected_period in test_queries:
        response = fundlens_query(query)
        
        # Check if expected value appears in response
        if expected_value in response and expected_period in response:
            correct += 1
            print(f"✅ PASS: {query}")
        else:
            print(f"❌ FAIL: {query}")
            print(f"   Expected: {expected_value} ({expected_period})")
            print(f"   Got: {response[:200]}...")
    
    accuracy = (correct / total) * 100
    print(f"\nAccuracy: {accuracy}%")
    return accuracy

# Target: >95% accuracy
```

---

## Monitoring & Debugging

### Key Metrics to Track
1. **Extraction Accuracy:** % of metrics successfully extracted from filings
2. **Query Routing Accuracy:** % of queries routed to correct doc types
3. **Retrieval Precision:** % of retrieved chunks that contain relevant data
4. **Response Accuracy:** % of responses with correct numbers
5. **Hallucination Rate:** % of responses with fabricated numbers

### Debug Logs
```python
import logging

logger = logging.getLogger('fundlens')
logger.setLevel(logging.DEBUG)

# Log each stage
logger.debug(f"Query Intent: {intent}")
logger.debug(f"Metadata Filter: {metadata_filter}")
logger.debug(f"Retrieved Chunks: {len(kb_results)}")
logger.debug(f"Structured Data: {structured_data}")
```

---

## Cost Optimization

### Current Bedrock KB Costs
- 100 chunks × N queries/day = high vector search costs

### Optimized Costs
- 5-10 chunks × N queries/day = 90% cost reduction
- Structured retrieval (SQL) = near-zero incremental cost
- Metadata filtering = faster queries = lower latency costs

---

## Rollout Plan

### Phase 1: Proof of Concept (Week 1-2)
- [ ] Extract tables from 1 company (AAPL)
- [ ] Test 10 queries
- [ ] Validate >90% accuracy

### Phase 2: Alpha (Week 3-4)
- [ ] Scale to 5 companies
- [ ] Integrate with query processor
- [ ] A/B test against current system

### Phase 3: Beta (Week 5-6)
- [ ] Scale to 50+ companies
- [ ] Automate daily updates
- [ ] User testing with 10 analysts

### Phase 4: Production (Week 7-8)
- [ ] Full deployment
- [ ] Monitoring dashboards
- [ ] Documentation & training

---

## Success Criteria

- ✅ **Accuracy:** >95% on simple metric queries
- ✅ **"Latest" Handling:** Always returns both Q + FY when appropriate
- ✅ **No Hallucination:** Numbers match source documents
- ✅ **Speed:** <3 seconds per query
- ✅ **Scale:** Support 100+ companies
- ✅ **Cost:** <$0.01 per query

---

## Next Steps

1. **Week 1:** Run POC with code I provided
2. **Schedule sync:** Review POC results, discuss Option A vs B for storage
3. **Week 2:** Begin Phase 2 implementation
4. **Ongoing:** Weekly check-ins to validate progress

Questions? Let's discuss!
