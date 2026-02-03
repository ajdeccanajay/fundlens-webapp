# FundLens.ai - Developer Implementation Guide
## Week 1 Sprint: SEC Filings Accuracy Fix + News/Docs Integration

**Target:** 99.999% accuracy on financial metrics retrieval  
**Timeline:** 1 week  
**Audience:** Junior developer with AWS/Python experience  

---

## 🎯 CRITICAL SUCCESS CRITERIA

### Accuracy Requirements (99.999%)
- **Financial Metrics:** MUST match SEC source document EXACTLY
- **Fiscal Periods:** MUST be correct (FY2024 vs Q3 2024)
- **No Hallucination:** LLM cannot modify numbers
- **Source Attribution:** Every number MUST link to page/line in source doc

### How to Achieve 99.999%
```
99.999% = 1 error per 100,000 queries

Strategy:
1. ✅ ZERO LLM involvement in number extraction → Use structured parsing only
2. ✅ Validation layer → Check extracted values against XBRL when available
3. ✅ Human QA on 1% sample → Flag discrepancies for model retraining
4. ✅ Automated testing → Run 1000 test queries daily, alert on any mismatch
```

---

## 📋 YOUR EXISTING INFRASTRUCTURE (What We're Building On)

Based on your description:
- ✅ **S3 Bucket:** SEC filings stored (10-K, 10-Q, 8-K)
- ✅ **Bedrock Knowledge Base:** Currently vectorizing markdown
- ✅ **News API:** 30 days of financial news (needs vectorization)
- ✅ **Preprocessing:** HTML → Markdown conversion exists
- ❌ **Missing:** Document router, table extraction, metadata layer
- ❌ **Missing:** Multi-modal doc upload handling

---

## 🏗️ ARCHITECTURE DECISION: DynamoDB vs RDS

### DynamoDB Serverless (⭐ RECOMMENDED for FundLens)

**Why DynamoDB Wins for Your Use Case:**

1. **Serverless = Zero Ops**
   - No patching, scaling, or maintenance
   - Your junior dev doesn't manage servers
   - Auto-scales from 0 to millions of queries

2. **Cost Efficiency**
   ```
   RDS: $50-200/month minimum (even if idle)
   DynamoDB: $0 when idle, pay only for reads/writes
   
   Your Usage (estimated):
   - 10,000 queries/day = 300K/month
   - DynamoDB: ~$10-20/month
   - RDS: $100-150/month minimum
   ```

3. **Perfect for Key-Value Lookups**
   ```python
   # Your query pattern (perfect for DynamoDB):
   ticker = "AAPL"
   metric = "accounts_payable"
   period = "FY2024"
   
   # DynamoDB query (sub-10ms):
   result = table.get_item(
       Key={'PK': 'AAPL#accounts_payable', 'SK': 'FY2024'}
   )
   ```

4. **Native AWS Integration**
   - Works seamlessly with Lambda, Bedrock, S3
   - No VPC needed (unlike RDS)
   - Built-in point-in-time recovery

**When RDS Would Be Better (Not Your Case):**
- Complex JOIN queries across multiple tables
- Need full SQL (GROUP BY, window functions, etc.)
- Legacy apps requiring PostgreSQL-specific features

**Decision: Use DynamoDB On-Demand**

---

## 📐 DYNAMODB SCHEMA DESIGN (Single Table)

### Primary Table: `fundlens_financial_metrics`

```python
# Partition Key (PK) and Sort Key (SK) design for optimal queries
{
    # Keys (for fast lookups)
    'PK': 'TICKER#METRIC',           # e.g., 'AAPL#accounts_payable'
    'SK': 'PERIOD#FILING',           # e.g., 'FY2024#10K'
    
    # Attributes (data)
    'ticker': 'AAPL',
    'normalized_metric': 'accounts_payable',
    'raw_label': 'Accounts Payable',
    'value': Decimal('5234000000'),   # Use Decimal for precision!
    'unit': 'USD',
    'scale': 'thousands',
    'fiscal_period': 'FY2024',
    'period_type': 'annual',          # 'annual' | 'quarterly' | 'ttm'
    'statement_type': 'balance_sheet',
    'statement_date': '2024-09-28',
    'filing_type': '10-K',
    'filing_date': '2024-11-01',
    'filing_url': 's3://fundlens-filings/AAPL/10K/2024/...',
    'source_page': 45,
    'source_line_number': 234,        # Line in original HTML
    'xbrl_tag': 'us-gaap:AccountsPayableCurrent',
    'xbrl_value': Decimal('5234000000'),  # For validation
    'extraction_method': 'html_table_parser',  # 'html_table_parser' | 'xbrl' | 'manual'
    'validation_status': 'xbrl_match',  # 'xbrl_match' | 'manual_verified' | 'pending'
    'confidence_score': 1.0,           # 0.0-1.0 (for 99.999% tracking)
    'synonyms': ['Trade Payables', 'Payables to Suppliers'],
    'last_updated': '2024-11-16T22:30:00Z',
    
    # GSI attributes (for alternative access patterns)
    'GSI1PK': 'METRIC#PERIOD',       # For cross-company queries
    'GSI1SK': 'TICKER',
    'GSI2PK': 'FILING_DATE',         # For "latest" queries
    'GSI2SK': 'TICKER#METRIC'
}
```

### Global Secondary Indexes (GSIs)

```python
# GSI-1: Query by metric across companies
# Use case: "Show me revenue for all tech companies in Q3 2024"
GSI1:
    PK: 'revenue#Q32024'
    SK: 'AAPL' | 'MSFT' | 'GOOGL' ...

# GSI-2: Query latest filing by date
# Use case: "What's the most recent accounts_payable for AAPL?"
GSI2:
    PK: 'AAPL#accounts_payable'
    SK: '2024-11-01' (filing_date, descending)
```

### Secondary Tables

```python
# Table 2: fundlens_metric_mappings
# (Your mini_MVP_metrics.xlsx loaded here)
{
    'PK': 'SYNONYM',                  # e.g., 'Net Sales'
    'SK': 'METADATA',
    'normalized_metric': 'revenue',
    'statement_type': 'income_statement',
    'synonyms': ['Revenue', 'Revenues', 'Total Sales', ...],
    'calculation_formula': None,      # or 'ebit + depreciation_amortization'
    'xbrl_tags': ['us-gaap:Revenues', 'us-gaap:SalesRevenueNet'],
    'source': 'mini_MVP_metrics.xlsx'
}

# Table 3: fundlens_news_vectors
# (For 30-day news integration)
{
    'PK': 'NEWS#DATE',                # e.g., 'NEWS#2024-11-16'
    'SK': 'ARTICLE_ID',
    'ticker': 'AAPL',                 # Extracted from article
    'headline': 'Apple announces...',
    'summary': '...',
    'source': 'Bloomberg',
    'url': 'https://...',
    'published_date': '2024-11-16T10:30:00Z',
    'embedding_s3_path': 's3://fundlens-embeddings/news/2024-11-16/article123.json',
    'bedrock_kb_id': 'kb-xxxx',       # If stored in Bedrock KB
    'relevance_score': 0.95           # For ticker/company matching
}

# Table 4: fundlens_user_documents
# (For multi-modal document uploads)
{
    'PK': 'USER_DOC#USER_ID',
    'SK': 'DOC_ID#TIMESTAMP',
    'user_id': 'ajay@fundlens.ai',
    'document_name': 'Q3_2024_Analysis.pdf',
    'document_type': 'pdf',           # 'pdf' | 'docx' | 'xlsx' | 'image'
    'file_size_bytes': 2048000,
    's3_path': 's3://fundlens-user-docs/ajay/Q3_2024_Analysis.pdf',
    'processing_status': 'completed',  # 'pending' | 'processing' | 'completed' | 'failed'
    'extracted_text_s3': 's3://fundlens-processed/ajay/Q3_2024_Analysis.txt',
    'embedding_s3_path': 's3://fundlens-embeddings/user-docs/...',
    'bedrock_kb_id': 'kb-yyyy',
    'upload_date': '2024-11-16T22:30:00Z',
    'metadata': {
        'page_count': 45,
        'contains_tables': True,
        'detected_tickers': ['AAPL', 'MSFT']
    }
}
```

---

## 🔧 IMPLEMENTATION TASKS (1 WEEK SPRINT)

### DAY 1: Infrastructure Setup

#### Task 1.1: Create DynamoDB Tables (30 min)
```python
# File: infrastructure/create_dynamodb_tables.py

import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb', region_name='us-east-1')

def create_metrics_table():
    table = dynamodb.create_table(
        TableName='fundlens_financial_metrics',
        KeySchema=[
            {'AttributeName': 'PK', 'KeyType': 'HASH'},
            {'AttributeName': 'SK', 'KeyType': 'RANGE'}
        ],
        AttributeDefinitions=[
            {'AttributeName': 'PK', 'AttributeType': 'S'},
            {'AttributeName': 'SK', 'AttributeType': 'S'},
            {'AttributeName': 'GSI1PK', 'AttributeType': 'S'},
            {'AttributeName': 'GSI1SK', 'AttributeType': 'S'},
            {'AttributeName': 'GSI2PK', 'AttributeType': 'S'},
            {'AttributeName': 'GSI2SK', 'AttributeType': 'S'}
        ],
        GlobalSecondaryIndexes=[
            {
                'IndexName': 'GSI1',
                'KeySchema': [
                    {'AttributeName': 'GSI1PK', 'KeyType': 'HASH'},
                    {'AttributeName': 'GSI1SK', 'KeyType': 'RANGE'}
                ],
                'Projection': {'ProjectionType': 'ALL'}
            },
            {
                'IndexName': 'GSI2',
                'KeySchema': [
                    {'AttributeName': 'GSI2PK', 'KeyType': 'HASH'},
                    {'AttributeName': 'GSI2SK', 'KeyType': 'RANGE'}
                ],
                'Projection': {'ProjectionType': 'ALL'}
            }
        ],
        BillingMode='PAY_PER_REQUEST',  # On-Demand (no capacity planning needed)
        PointInTimeRecoverySpecification={'PointInTimeRecoveryEnabled': True},
        Tags=[
            {'Key': 'Project', 'Value': 'FundLens'},
            {'Key': 'Environment', 'Value': 'production'}
        ]
    )
    
    table.wait_until_exists()
    print(f"✅ Table {table.table_name} created successfully")
    return table

def create_metric_mappings_table():
    # Similar structure for fundlens_metric_mappings
    pass

def create_news_table():
    # Similar structure for fundlens_news_vectors
    pass

def create_user_docs_table():
    # Similar structure for fundlens_user_documents
    pass

if __name__ == "__main__":
    create_metrics_table()
    create_metric_mappings_table()
    create_news_table()
    create_user_docs_table()
```

**Action:** Run this script to create all 4 tables.

#### Task 1.2: Load mini_MVP_metrics.xlsx into DynamoDB (1 hour)
```python
# File: data_loaders/load_metric_mappings.py

import pandas as pd
import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
table = dynamodb.Table('fundlens_metric_mappings')

def load_mappings_from_excel(excel_path: str):
    """Load Ajay's mini_MVP_metrics.xlsx into DynamoDB"""
    
    # Load the detailed synonym sheet
    df = pd.read_excel(excel_path, sheet_name='IS+BS+CF+SE-Condensed')
    
    items_to_load = []
    
    for _, row in df.iterrows():
        metric_id = row['Direct Metric']
        statement_type = row['Statement'].lower().replace(' ', '_')
        synonyms_str = row['Synonyms']
        xbrl_tags_str = row.get('Common_XBRL_Tags', '')
        
        if pd.notna(synonyms_str):
            synonyms = [s.strip() for s in str(synonyms_str).split(';')]
        else:
            synonyms = []
        
        if pd.notna(xbrl_tags_str):
            xbrl_tags = [s.strip() for s in str(xbrl_tags_str).split(';')]
        else:
            xbrl_tags = []
        
        # Primary item (by normalized metric)
        item = {
            'PK': f'METRIC#{metric_id}',
            'SK': 'METADATA',
            'normalized_metric': metric_id,
            'statement_type': statement_type,
            'synonyms': synonyms,
            'xbrl_tags': xbrl_tags,
            'source': 'mini_MVP_metrics.xlsx'
        }
        items_to_load.append(item)
        
        # Create reverse lookups for each synonym
        for synonym in synonyms:
            synonym_item = {
                'PK': f'SYNONYM#{synonym.lower()}',
                'SK': 'MAPPING',
                'normalized_metric': metric_id,
                'original_synonym': synonym
            }
            items_to_load.append(synonym_item)
    
    # Batch write to DynamoDB
    with table.batch_writer() as batch:
        for item in items_to_load:
            batch.put_item(Item=item)
    
    print(f"✅ Loaded {len(items_to_load)} mapping items")

if __name__ == "__main__":
    load_mappings_from_excel('/path/to/mini_MVP_metrics.xlsx')
```

**Action:** Update path and run to load all mappings.

---

### DAY 2-3: Table Extraction & Validation Pipeline

#### Task 2.1: Enhanced Table Extractor with XBRL Validation (4 hours)
```python
# File: extractors/sec_table_extractor_v2.py

import boto3
from bs4 import BeautifulSoup
import pandas as pd
from decimal import Decimal
from typing import Dict, List, Optional, Tuple
import re
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
metrics_table = dynamodb.Table('fundlens_financial_metrics')
mappings_table = dynamodb.Table('fundlens_metric_mappings')

class SecTableExtractorWithValidation:
    """
    Enhanced extractor with XBRL validation for 99.999% accuracy
    """
    
    def __init__(self):
        self.mappings_cache = self._load_mappings()
    
    def _load_mappings(self) -> Dict:
        """Load all metric mappings into memory for fast lookup"""
        cache = {}
        
        # Scan all synonyms
        response = mappings_table.scan()
        for item in response['Items']:
            if item['PK'].startswith('SYNONYM#'):
                synonym = item['PK'].replace('SYNONYM#', '')
                cache[synonym] = item['normalized_metric']
        
        return cache
    
    def extract_and_validate(
        self,
        s3_html_path: str,
        ticker: str,
        filing_type: str,
        filing_date: str
    ) -> List[Dict]:
        """
        Main extraction method with validation
        
        Returns list of validated metrics ready for DynamoDB
        """
        # Download HTML from S3
        html_content = self._download_from_s3(s3_html_path)
        
        # Parse HTML tables
        raw_metrics = self._parse_tables(html_content, ticker, filing_type, filing_date)
        
        # Validate against XBRL (if available)
        validated_metrics = self._validate_with_xbrl(raw_metrics, s3_html_path)
        
        # Calculate confidence scores
        final_metrics = self._calculate_confidence(validated_metrics)
        
        return final_metrics
    
    def _parse_tables(
        self,
        html_content: str,
        ticker: str,
        filing_type: str,
        filing_date: str
    ) -> List[Dict]:
        """Parse financial tables from HTML"""
        soup = BeautifulSoup(html_content, 'lxml')
        metrics = []
        
        for i, table in enumerate(soup.find_all('table')):
            # Identify statement type from context
            context = self._get_table_context(table)
            statement_type = self._identify_statement_type(context)
            
            if not statement_type:
                continue
            
            # Convert to DataFrame
            try:
                df = pd.read_html(str(table))[0]
            except:
                continue
            
            # Check if financial table
            if not self._is_financial_table(df):
                continue
            
            # Parse periods from column headers
            period_columns = self._parse_periods(df.columns, filing_type)
            
            # Extract metrics row by row
            for idx, row in df.iterrows():
                raw_label = str(row.iloc[0]).strip()
                
                if not raw_label or raw_label.lower() in ['nan', 'none', '']:
                    continue
                
                # Normalize label using mappings
                normalized_metric = self._normalize_label(raw_label)
                
                if not normalized_metric:
                    continue  # Skip unrecognized metrics
                
                # Extract values for each period
                for col_name, period_info in period_columns.items():
                    value_raw = row[col_name]
                    value = self._parse_value(value_raw)
                    
                    if value is None:
                        continue
                    
                    metric = {
                        'ticker': ticker,
                        'normalized_metric': normalized_metric,
                        'raw_label': raw_label,
                        'value': value,
                        'fiscal_period': period_info['period'],
                        'period_type': period_info['type'],
                        'statement_type': statement_type,
                        'filing_type': filing_type,
                        'filing_date': filing_date,
                        'statement_date': period_info.get('date', filing_date),
                        'source_page': None,  # TODO: extract page number
                        'source_line_number': idx,
                        'table_number': i,
                        'extraction_method': 'html_table_parser'
                    }
                    
                    metrics.append(metric)
        
        return metrics
    
    def _normalize_label(self, raw_label: str) -> Optional[str]:
        """Normalize label using DynamoDB mappings"""
        raw_lower = raw_label.lower().strip()
        
        # Direct lookup
        if raw_lower in self.mappings_cache:
            return self.mappings_cache[raw_lower]
        
        # Fuzzy match (contains)
        for synonym, metric_id in self.mappings_cache.items():
            if synonym in raw_lower or raw_lower in synonym:
                return metric_id
        
        return None
    
    def _validate_with_xbrl(
        self,
        raw_metrics: List[Dict],
        s3_html_path: str
    ) -> List[Dict]:
        """
        Validate extracted values against XBRL tags
        
        THIS IS KEY FOR 99.999% ACCURACY
        """
        # Check if XBRL file exists
        xbrl_path = s3_html_path.replace('.html', '_xbrl.xml')
        
        try:
            xbrl_data = self._parse_xbrl(xbrl_path)
        except:
            # No XBRL available, return raw metrics with lower confidence
            for metric in raw_metrics:
                metric['validation_status'] = 'no_xbrl'
                metric['confidence_score'] = 0.95
            return raw_metrics
        
        # Match each metric with XBRL value
        validated = []
        for metric in raw_metrics:
            xbrl_value = self._find_xbrl_value(
                xbrl_data,
                metric['normalized_metric'],
                metric['fiscal_period']
            )
            
            if xbrl_value is not None:
                # Compare values
                if abs(metric['value'] - xbrl_value) < 0.01:  # Allow tiny rounding diff
                    metric['xbrl_value'] = xbrl_value
                    metric['validation_status'] = 'xbrl_match'
                    metric['confidence_score'] = 1.0  # Perfect match
                else:
                    # Mismatch - flag for manual review
                    metric['xbrl_value'] = xbrl_value
                    metric['validation_status'] = 'xbrl_mismatch'
                    metric['confidence_score'] = 0.5
                    metric['needs_manual_review'] = True
            else:
                metric['validation_status'] = 'xbrl_not_found'
                metric['confidence_score'] = 0.9
            
            validated.append(metric)
        
        return validated
    
    def _parse_xbrl(self, xbrl_path: str) -> Dict:
        """Parse XBRL file for validation data"""
        # Download and parse XBRL XML
        # Extract all us-gaap tags with values
        # Return dict: {tag_name: {period: value}}
        pass  # Implementation details
    
    def _find_xbrl_value(
        self,
        xbrl_data: Dict,
        normalized_metric: str,
        fiscal_period: str
    ) -> Optional[Decimal]:
        """Find corresponding XBRL value for a metric"""
        # Get expected XBRL tags for this metric
        response = mappings_table.get_item(
            Key={'PK': f'METRIC#{normalized_metric}', 'SK': 'METADATA'}
        )
        
        if 'Item' not in response:
            return None
        
        xbrl_tags = response['Item'].get('xbrl_tags', [])
        
        # Look for matching value in XBRL data
        for tag in xbrl_tags:
            if tag in xbrl_data and fiscal_period in xbrl_data[tag]:
                return Decimal(str(xbrl_data[tag][fiscal_period]))
        
        return None
    
    def save_to_dynamodb(self, metrics: List[Dict]):
        """Batch write validated metrics to DynamoDB"""
        with metrics_table.batch_writer() as batch:
            for metric in metrics:
                # Only save high-confidence metrics
                if metric.get('confidence_score', 0) < 0.9:
                    print(f"⚠️  Skipping low-confidence metric: {metric}")
                    continue
                
                # Construct DynamoDB item
                item = {
                    'PK': f"{metric['ticker']}#{metric['normalized_metric']}",
                    'SK': f"{metric['fiscal_period']}#{metric['filing_type']}",
                    'ticker': metric['ticker'],
                    'normalized_metric': metric['normalized_metric'],
                    'raw_label': metric['raw_label'],
                    'value': Decimal(str(metric['value'])),
                    'fiscal_period': metric['fiscal_period'],
                    'period_type': metric['period_type'],
                    'statement_type': metric['statement_type'],
                    'filing_type': metric['filing_type'],
                    'filing_date': metric['filing_date'],
                    'statement_date': metric['statement_date'],
                    'source_line_number': metric['source_line_number'],
                    'extraction_method': metric['extraction_method'],
                    'validation_status': metric['validation_status'],
                    'confidence_score': Decimal(str(metric['confidence_score'])),
                    'xbrl_value': Decimal(str(metric['xbrl_value'])) if 'xbrl_value' in metric else None,
                    'last_updated': datetime.utcnow().isoformat(),
                    # GSI attributes
                    'GSI1PK': f"{metric['normalized_metric']}#{metric['fiscal_period']}",
                    'GSI1SK': metric['ticker'],
                    'GSI2PK': f"{metric['ticker']}#{metric['normalized_metric']}",
                    'GSI2SK': metric['filing_date']
                }
                
                batch.put_item(Item=item)
        
        print(f"✅ Saved {len(metrics)} metrics to DynamoDB")

# Helper methods from original extractor
# (copy _parse_periods, _is_financial_table, _parse_value, etc. from sec_table_extractor.py)
```

**Action:** This is the CRITICAL component for 99.999% accuracy. Test thoroughly.

#### Task 2.2: Automated Testing Suite (2 hours)
```python
# File: tests/test_extraction_accuracy.py

import boto3
import pytest
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
metrics_table = dynamodb.Table('fundlens_financial_metrics')

# Ground truth test cases (manually verified from SEC filings)
GROUND_TRUTH = [
    {
        'ticker': 'AAPL',
        'metric': 'accounts_payable',
        'period': 'FY2024',
        'expected_value': Decimal('67889000000'),  # From 10-K page 32
        'filing_type': '10-K',
        'filing_date': '2024-11-01'
    },
    {
        'ticker': 'AAPL',
        'metric': 'revenue',
        'period': 'FY2024',
        'expected_value': Decimal('391035000000'),  # From 10-K page 28
        'filing_type': '10-K',
        'filing_date': '2024-11-01'
    },
    # Add 100+ test cases here
]

def test_extraction_accuracy():
    """Test that extracted values match ground truth"""
    errors = []
    
    for test_case in GROUND_TRUTH:
        # Query DynamoDB
        response = metrics_table.get_item(
            Key={
                'PK': f"{test_case['ticker']}#{test_case['metric']}",
                'SK': f"{test_case['period']}#{test_case['filing_type']}"
            }
        )
        
        if 'Item' not in response:
            errors.append(f"Missing: {test_case}")
            continue
        
        extracted_value = response['Item']['value']
        
        if extracted_value != test_case['expected_value']:
            errors.append({
                'test_case': test_case,
                'extracted': extracted_value,
                'expected': test_case['expected_value'],
                'diff': abs(extracted_value - test_case['expected_value'])
            })
    
    accuracy = (len(GROUND_TRUTH) - len(errors)) / len(GROUND_TRUTH) * 100
    print(f"Accuracy: {accuracy:.3f}%")
    
    if errors:
        print("\n❌ FAILED TEST CASES:")
        for error in errors:
            print(f"  {error}")
    
    # Require 99.999% accuracy
    assert accuracy >= 99.999, f"Accuracy {accuracy}% below threshold 99.999%"

if __name__ == "__main__":
    test_extraction_accuracy()
```

**Action:** Build ground truth dataset by manually verifying 100 metrics from actual filings.

---

### DAY 4: Query Router Implementation

#### Task 4.1: Production Query Router (3 hours)
```python
# File: routers/query_router_v2.py
# (Enhanced version of query_processor.py with DynamoDB integration)

import boto3
from typing import Dict, List, Optional
from decimal import Decimal
from enum import Enum

dynamodb = boto3.resource('dynamodb')
metrics_table = dynamodb.Table('fundlens_financial_metrics')

class PeriodType(Enum):
    LATEST_BOTH = "latest_both"
    LATEST_QUARTERLY = "latest_quarterly"
    LATEST_ANNUAL = "latest_annual"
    SPECIFIC_QUARTER = "specific_quarter"
    SPECIFIC_YEAR = "specific_year"
    TTM = "ttm"

class QueryRouterV2:
    """Production query router with DynamoDB queries"""
    
    def __init__(self):
        self.mappings_cache = self._load_mappings()
    
    def route_and_retrieve(self, user_query: str) -> Dict:
        """
        Main entry point: route query and retrieve exact metrics
        
        Returns:
            {
                'intent': {...},
                'structured_data': {
                    '10-Q': [...],
                    '10-K': [...]
                },
                'response_text': 'Formatted response'
            }
        """
        # Parse query intent
        intent = self._parse_query(user_query)
        
        # Retrieve structured data from DynamoDB
        structured_data = self._retrieve_metrics(intent)
        
        # Build formatted response
        response_text = self._build_response(intent, structured_data)
        
        return {
            'intent': intent,
            'structured_data': structured_data,
            'response_text': response_text
        }
    
    def _parse_query(self, user_query: str) -> Dict:
        """Parse query intent (same logic as query_processor.py)"""
        # Extract ticker
        ticker = self._extract_ticker(user_query)
        
        # Extract metric and normalize
        metric_raw, normalized_metric = self._extract_and_normalize_metric(user_query)
        
        # Extract period intent
        period_type, specific_period = self._extract_period_intent(user_query)
        
        # Determine doc types
        doc_types = self._determine_doc_types(period_type)
        
        return {
            'ticker': ticker,
            'metric': metric_raw,
            'normalized_metric': normalized_metric,
            'period_type': period_type,
            'specific_period': specific_period,
            'doc_types': doc_types
        }
    
    def _retrieve_metrics(self, intent: Dict) -> Dict[str, List[Dict]]:
        """
        Retrieve metrics from DynamoDB
        
        Uses GSI2 for "latest" queries (sorted by filing_date DESC)
        """
        results = {}
        
        ticker = intent['ticker']
        normalized_metric = intent['normalized_metric']
        period_type = intent['period_type']
        
        if period_type == PeriodType.LATEST_BOTH:
            # Need both quarterly (10-Q) and annual (10-K)
            results['10-Q'] = self._get_latest_filings(ticker, normalized_metric, '10-Q', limit=4)
            results['10-K'] = self._get_latest_filings(ticker, normalized_metric, '10-K', limit=3)
        
        elif period_type == PeriodType.LATEST_QUARTERLY:
            results['10-Q'] = self._get_latest_filings(ticker, normalized_metric, '10-Q', limit=4)
        
        elif period_type == PeriodType.LATEST_ANNUAL:
            results['10-K'] = self._get_latest_filings(ticker, normalized_metric, '10-K', limit=3)
        
        elif period_type == PeriodType.SPECIFIC_QUARTER:
            results['10-Q'] = self._get_specific_period(
                ticker, normalized_metric, intent['specific_period'], '10-Q'
            )
        
        elif period_type == PeriodType.SPECIFIC_YEAR:
            results['10-K'] = self._get_specific_period(
                ticker, normalized_metric, intent['specific_period'], '10-K'
            )
        
        return results
    
    def _get_latest_filings(
        self,
        ticker: str,
        metric: str,
        filing_type: str,
        limit: int = 4
    ) -> List[Dict]:
        """
        Get latest N filings using GSI2 (sorted by filing_date DESC)
        """
        response = metrics_table.query(
            IndexName='GSI2',
            KeyConditionExpression='GSI2PK = :pk',
            ExpressionAttributeValues={
                ':pk': f'{ticker}#{metric}'
            },
            ScanIndexForward=False,  # Descending order (newest first)
            Limit=limit * 2  # Get extra in case of duplicates
        )
        
        # Filter by filing_type and deduplicate by period
        seen_periods = set()
        results = []
        
        for item in response.get('Items', []):
            if item['filing_type'] == filing_type and item['fiscal_period'] not in seen_periods:
                results.append(self._dynamodb_item_to_dict(item))
                seen_periods.add(item['fiscal_period'])
                
                if len(results) >= limit:
                    break
        
        return results
    
    def _get_specific_period(
        self,
        ticker: str,
        metric: str,
        fiscal_period: str,
        filing_type: str
    ) -> List[Dict]:
        """Get specific period (e.g., Q3 2024, FY2024)"""
        response = metrics_table.get_item(
            Key={
                'PK': f'{ticker}#{metric}',
                'SK': f'{fiscal_period}#{filing_type}'
            }
        )
        
        if 'Item' in response:
            return [self._dynamodb_item_to_dict(response['Item'])]
        else:
            return []
    
    def _dynamodb_item_to_dict(self, item: Dict) -> Dict:
        """Convert DynamoDB item to plain dict"""
        return {
            'ticker': item['ticker'],
            'normalized_metric': item['normalized_metric'],
            'raw_label': item['raw_label'],
            'value': float(item['value']),
            'fiscal_period': item['fiscal_period'],
            'period_type': item['period_type'],
            'filing_type': item['filing_type'],
            'filing_date': item['filing_date'],
            'statement_date': item['statement_date'],
            'source_page': item.get('source_page'),
            'confidence_score': float(item.get('confidence_score', 1.0)),
            'validation_status': item.get('validation_status', 'unknown')
        }
    
    def _build_response(self, intent: Dict, structured_data: Dict) -> str:
        """
        Build formatted response with EXACT numbers pre-filled
        """
        ticker = intent['ticker']
        metric_name = intent['metric'].replace('_', ' ').title()
        
        response_parts = []
        
        # Summary Answer
        response_parts.append("📊 **Summary Answer**")
        
        quarterly_data = structured_data.get('10-Q', [])
        annual_data = structured_data.get('10-K', [])
        
        if intent['period_type'] == PeriodType.LATEST_BOTH and quarterly_data and annual_data:
            latest_q = quarterly_data[0]
            latest_fy = annual_data[0]
            
            response_parts.append(
                f"{ticker}'s {metric_name}: "
                f"Latest quarterly ({latest_q['fiscal_period']}) was ${latest_q['value']:,.0f}M "
                f"and latest annual ({latest_fy['fiscal_period']}) was ${latest_fy['value']:,.0f}M."
            )
        elif quarterly_data:
            latest_q = quarterly_data[0]
            response_parts.append(
                f"{ticker}'s latest quarterly {metric_name} ({latest_q['fiscal_period']}): "
                f"${latest_q['value']:,.0f}M"
            )
        elif annual_data:
            latest_fy = annual_data[0]
            response_parts.append(
                f"{ticker}'s latest annual {metric_name} ({latest_fy['fiscal_period']}): "
                f"${latest_fy['value']:,.0f}M"
            )
        
        response_parts.append("")
        
        # Temporal Analysis
        response_parts.append("📅 **Temporal Analysis**")
        
        if quarterly_data:
            response_parts.append("**Latest Quarterly Results:**")
            for metric in quarterly_data[:4]:
                response_parts.append(
                    f"- {metric['fiscal_period']}: ${metric['value']:,.0f}M"
                )
            response_parts.append("")
        
        if annual_data:
            response_parts.append("**Latest Annual Results:**")
            for metric in annual_data[:3]:
                response_parts.append(
                    f"- {metric['fiscal_period']}: ${metric['value']:,.0f}M"
                )
            response_parts.append("")
        
        # Source Documentation
        response_parts.append("📄 **Source Documentation**")
        
        if quarterly_data:
            latest_q = quarterly_data[0]
            response_parts.append(
                f"- Document: {latest_q['filing_type']} | Period: {latest_q['fiscal_period']} | "
                f"Confidence: {latest_q['confidence_score']*100:.1f}% | "
                f"Validation: {latest_q['validation_status']}"
            )
        
        if annual_data:
            latest_fy = annual_data[0]
            response_parts.append(
                f"- Document: {latest_fy['filing_type']} | Period: {latest_fy['fiscal_period']} | "
                f"Confidence: {latest_fy['confidence_score']*100:.1f}% | "
                f"Validation: {latest_fy['validation_status']}"
            )
        
        return '\n'.join(response_parts)

# Copy helper methods from query_processor.py
# (_extract_ticker, _extract_period_intent, etc.)
```

**Action:** Test with 50+ queries to ensure routing is correct.

---

### DAY 5: News & Document Upload Integration

#### Task 5.1: News Vectorization Pipeline (3 hours)
```python
# File: news/news_vectorizer.py

import boto3
import requests
from datetime import datetime, timedelta

dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')
bedrock_agent = boto3.client('bedrock-agent-runtime')

news_table = dynamodb.Table('fundlens_news_vectors')

class NewsVectorizer:
    """Vectorize and store 30 days of financial news"""
    
    def __init__(self, news_api_endpoint: str, bedrock_kb_id: str):
        self.news_api_endpoint = news_api_endpoint
        self.bedrock_kb_id = bedrock_kb_id
    
    def fetch_and_vectorize_news(self, days_back: int = 30):
        """
        Fetch last N days of news and add to Bedrock KB
        """
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days_back)
        
        # Call your existing news API
        news_articles = self._fetch_news(start_date, end_date)
        
        print(f"Fetched {len(news_articles)} articles")
        
        # Process each article
        for article in news_articles:
            self._process_article(article)
    
    def _fetch_news(self, start_date, end_date) -> List[Dict]:
        """Call your existing news API"""
        response = requests.get(
            self.news_api_endpoint,
            params={
                'start_date': start_date.isoformat(),
                'end_date': end_date.isoformat(),
                'categories': 'finance,tech,markets'
            }
        )
        return response.json()['articles']
    
    def _process_article(self, article: Dict):
        """Process single news article"""
        # Extract tickers mentioned in article
        tickers = self._extract_tickers(article['headline'] + ' ' + article['summary'])
        
        # Create markdown for Bedrock KB
        markdown = self._format_article_markdown(article, tickers)
        
        # Upload to S3
        s3_key = f"news/{article['published_date']}/{article['article_id']}.md"
        s3.put_object(
            Bucket='fundlens-knowledge-base',
            Key=s3_key,
            Body=markdown.encode('utf-8'),
            ContentType='text/markdown',
            Metadata={
                'ticker': ','.join(tickers),
                'source': article['source'],
                'published_date': article['published_date'],
                'article_type': 'news'
            }
        )
        
        # Store reference in DynamoDB
        news_table.put_item(Item={
            'PK': f"NEWS#{article['published_date'][:10]}",
            'SK': article['article_id'],
            'ticker': tickers[0] if tickers else 'UNKNOWN',
            'all_tickers': tickers,
            'headline': article['headline'],
            'summary': article['summary'],
            'source': article['source'],
            'url': article['url'],
            'published_date': article['published_date'],
            's3_path': f's3://fundlens-knowledge-base/{s3_key}',
            'bedrock_kb_id': self.bedrock_kb_id
        })
        
        print(f"✅ Processed: {article['headline'][:50]}...")
    
    def _extract_tickers(self, text: str) -> List[str]:
        """Extract stock tickers from text"""
        # Simple regex for tickers (improve with NER model)
        import re
        tickers = re.findall(r'\b[A-Z]{2,5}\b', text)
        
        # Filter to known tickers only
        valid_tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA']  # Load from config
        return [t for t in tickers if t in valid_tickers]
    
    def _format_article_markdown(self, article: Dict, tickers: List[str]) -> str:
        """Format article as markdown with metadata"""
        return f"""---
article_type: news
tickers: {', '.join(tickers)}
source: {article['source']}
published_date: {article['published_date']}
url: {article['url']}
---

# {article['headline']}

**Published:** {article['published_date']}  
**Source:** {article['source']}  
**Tickers:** {', '.join(tickers)}

## Summary
{article['summary']}

## Full Article
{article.get('body', article['summary'])}

---
**Query Keywords:** {', '.join(tickers)}, {article['source']}, financial news, {article['published_date'][:10]}
"""

if __name__ == "__main__":
    vectorizer = NewsVectorizer(
        news_api_endpoint='YOUR_NEWS_API_ENDPOINT',
        bedrock_kb_id='YOUR_BEDROCK_KB_ID'
    )
    vectorizer.fetch_and_vectorize_news(days_back=30)
```

**Action:** Run daily via AWS EventBridge to keep news current.

#### Task 5.2: Multi-Modal Document Upload Handler (3 hours)
```python
# File: document_processing/multimodal_handler.py

import boto3
from PIL import Image
import pytesseract
from pdf2image import convert_from_path
import docx
import pandas as pd

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
bedrock_runtime = boto3.client('bedrock-runtime')

user_docs_table = dynamodb.Table('fundlens_user_documents')

class MultiModalDocumentHandler:
    """Handle PDF, DOCX, XLSX, images uploaded by users"""
    
    def __init__(self, bedrock_kb_id: str):
        self.bedrock_kb_id = bedrock_kb_id
    
    def process_upload(
        self,
        user_id: str,
        file_path: str,
        file_name: str,
        file_type: str
    ) -> Dict:
        """
        Main entry point for document processing
        
        Returns processing status and metadata
        """
        doc_id = f"{user_id}_{datetime.utcnow().timestamp()}"
        
        # Update status to 'processing'
        self._update_status(user_id, doc_id, 'processing')
        
        try:
            # Process based on file type
            if file_type == 'pdf':
                extracted_text = self._process_pdf(file_path)
            elif file_type == 'docx':
                extracted_text = self._process_docx(file_path)
            elif file_type == 'xlsx':
                extracted_text = self._process_xlsx(file_path)
            elif file_type in ['png', 'jpg', 'jpeg']:
                extracted_text = self._process_image(file_path)
            else:
                raise ValueError(f"Unsupported file type: {file_type}")
            
            # Extract metadata (tickers, dates, etc.)
            metadata = self._extract_metadata(extracted_text)
            
            # Upload to S3
            s3_path = self._upload_to_s3(user_id, doc_id, extracted_text, file_name)
            
            # Add to Bedrock KB
            self._add_to_bedrock_kb(s3_path, metadata)
            
            # Update DynamoDB
            self._save_document_record(user_id, doc_id, file_name, file_type, s3_path, metadata)
            
            # Update status to 'completed'
            self._update_status(user_id, doc_id, 'completed')
            
            return {
                'status': 'success',
                'doc_id': doc_id,
                's3_path': s3_path,
                'metadata': metadata
            }
        
        except Exception as e:
            self._update_status(user_id, doc_id, 'failed', error=str(e))
            raise
    
    def _process_pdf(self, file_path: str) -> str:
        """Extract text from PDF (handles images via OCR)"""
        text = ""
        
        try:
            # Try PyPDF2 first (faster for text-based PDFs)
            import PyPDF2
            with open(file_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                for page in reader.pages:
                    text += page.extract_text()
        except:
            # Fall back to OCR for image-based PDFs
            images = convert_from_path(file_path)
            for image in images:
                text += pytesseract.image_to_string(image)
        
        return text
    
    def _process_docx(self, file_path: str) -> str:
        """Extract text from DOCX"""
        doc = docx.Document(file_path)
        text = '\n'.join([paragraph.text for paragraph in doc.paragraphs])
        return text
    
    def _process_xlsx(self, file_path: str) -> str:
        """Extract data from Excel (convert to markdown table)"""
        xl = pd.ExcelFile(file_path)
        text = ""
        
        for sheet_name in xl.sheet_names:
            df = pd.read_excel(xl, sheet_name=sheet_name)
            text += f"\n\n## Sheet: {sheet_name}\n\n"
            text += df.to_markdown(index=False)
        
        return text
    
    def _process_image(self, file_path: str) -> str:
        """Extract text from image via OCR"""
        image = Image.open(file_path)
        text = pytesseract.image_to_string(image)
        return text
    
    def _extract_metadata(self, text: str) -> Dict:
        """Extract tickers, dates, and other metadata from text"""
        import re
        
        # Extract tickers
        tickers = re.findall(r'\b[A-Z]{2,5}\b', text)
        tickers = list(set(tickers))[:10]  # Dedupe and limit
        
        # Extract dates
        dates = re.findall(r'\b\d{4}-\d{2}-\d{2}\b', text)
        
        return {
            'detected_tickers': tickers,
            'detected_dates': dates,
            'word_count': len(text.split()),
            'contains_tables': 'table' in text.lower() or '|' in text
        }
    
    def _upload_to_s3(self, user_id: str, doc_id: str, text: str, file_name: str) -> str:
        """Upload extracted text to S3"""
        s3_key = f"user-docs/{user_id}/{doc_id}/{file_name}.md"
        
        s3.put_object(
            Bucket='fundlens-knowledge-base',
            Key=s3_key,
            Body=text.encode('utf-8'),
            ContentType='text/markdown',
            Metadata={
                'user_id': user_id,
                'doc_id': doc_id,
                'original_filename': file_name
            }
        )
        
        return f's3://fundlens-knowledge-base/{s3_key}'
    
    def _add_to_bedrock_kb(self, s3_path: str, metadata: Dict):
        """Add document to Bedrock Knowledge Base"""
        # Bedrock KB automatically syncs S3 bucket
        # Just ensure file is in correct location with metadata
        pass
    
    def _save_document_record(
        self,
        user_id: str,
        doc_id: str,
        file_name: str,
        file_type: str,
        s3_path: str,
        metadata: Dict
    ):
        """Save document record to DynamoDB"""
        user_docs_table.put_item(Item={
            'PK': f'USER_DOC#{user_id}',
            'SK': f'DOC#{doc_id}',
            'user_id': user_id,
            'document_name': file_name,
            'document_type': file_type,
            's3_path': s3_path,
            'processing_status': 'completed',
            'upload_date': datetime.utcnow().isoformat(),
            'metadata': metadata,
            'bedrock_kb_id': self.bedrock_kb_id
        })

# Lambda handler for S3 upload trigger
def lambda_handler(event, context):
    """Triggered when user uploads file to S3"""
    for record in event['Records']:
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']
        
        # Parse user_id and file info from key
        # e.g., uploads/ajay@fundlens.ai/document.pdf
        user_id = key.split('/')[1]
        file_name = key.split('/')[-1]
        file_type = file_name.split('.')[-1].lower()
        
        # Download file to /tmp
        local_path = f'/tmp/{file_name}'
        s3.download_file(bucket, key, local_path)
        
        # Process document
        handler = MultiModalDocumentHandler(bedrock_kb_id='YOUR_KB_ID')
        result = handler.process_upload(user_id, local_path, file_name, file_type)
        
        print(f"✅ Processed: {result}")
    
    return {'statusCode': 200}
```

**Action:** Deploy as Lambda function triggered by S3 uploads.

---

### DAY 6-7: Integration & Testing

#### Task 6.1: End-to-End API Integration (4 hours)
```python
# File: api/fundlens_api.py
# Main API Gateway Lambda handler

import json
from routers.query_router_v2 import QueryRouterV2
from news.news_vectorizer import NewsVectorizer

router = QueryRouterV2()

def lambda_handler(event, context):
    """
    Main API endpoint for FundLens queries
    
    Handles:
    - SEC metrics queries
    - News queries
    - User document queries
    """
    body = json.loads(event['body'])
    query = body.get('query')
    query_type = body.get('type', 'metrics')  # 'metrics' | 'news' | 'documents'
    
    try:
        if query_type == 'metrics':
            # Route to structured metrics retrieval
            result = router.route_and_retrieve(query)
            
            response = {
                'status': 'success',
                'query': query,
                'intent': result['intent'],
                'response': result['response_text'],
                'structured_data': result['structured_data'],
                'confidence': 0.999  # High confidence from structured data
            }
        
        elif query_type == 'news':
            # Query news from Bedrock KB
            result = query_news(query)
            response = {
                'status': 'success',
                'query': query,
                'news_articles': result
            }
        
        elif query_type == 'documents':
            # Query user documents
            result = query_user_documents(query, user_id=body.get('user_id'))
            response = {
                'status': 'success',
                'query': query,
                'documents': result
            }
        
        return {
            'statusCode': 200,
            'body': json.dumps(response)
        }
    
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({
                'status': 'error',
                'message': str(e)
            })
        }
```

#### Task 6.2: Comprehensive Testing (4 hours)
```bash
# Run all test suites

# 1. Extraction accuracy
python tests/test_extraction_accuracy.py

# 2. Query routing
python tests/test_query_router.py

# 3. DynamoDB performance
python tests/test_dynamodb_queries.py

# 4. End-to-end API
python tests/test_api_integration.py
```

**Expected Results:**
- Extraction: 99.999% accuracy
- Routing: 100% correct doc types
- Query latency: <200ms for DynamoDB lookups
- API end-to-end: <2 seconds

---

## 📊 MONITORING & ALERTING

### CloudWatch Dashboards
```python
# File: monitoring/create_dashboard.py

import boto3

cloudwatch = boto3.client('cloudwatch')

# Create dashboard for monitoring 99.999% accuracy
dashboard_body = {
    "widgets": [
        {
            "type": "metric",
            "properties": {
                "metrics": [
                    ["FundLens", "ExtractionAccuracy", {"stat": "Average"}],
                    [".", "ConfidenceScore", {"stat": "Average"}],
                    [".", "XBRLMismatch", {"stat": "Sum"}]
                ],
                "period": 300,
                "region": "us-east-1",
                "title": "Accuracy Metrics"
            }
        },
        {
            "type": "metric",
            "properties": {
                "metrics": [
                    ["FundLens", "QueryLatency", {"stat": "Average"}],
                    [".", "DynamoDBLatency", {"stat": "Average"}]
                ],
                "period": 300,
                "region": "us-east-1",
                "title": "Latency Metrics"
            }
        }
    ]
}

cloudwatch.put_dashboard(
    DashboardName='FundLens-Production',
    DashboardBody=json.dumps(dashboard_body)
)
```

### Alerting Rules
```python
# Alert if accuracy drops below 99.9%
cloudwatch.put_metric_alarm(
    AlarmName='FundLens-Accuracy-Alert',
    ComparisonOperator='LessThanThreshold',
    EvaluationPeriods=1,
    MetricName='ExtractionAccuracy',
    Namespace='FundLens',
    Period=300,
    Statistic='Average',
    Threshold=99.9,
    ActionsEnabled=True,
    AlarmActions=['arn:aws:sns:us-east-1:ACCOUNT:fundlens-alerts']
)
```

---

## 🚀 DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] All DynamoDB tables created
- [ ] mini_MVP_metrics.xlsx loaded
- [ ] Ground truth test dataset prepared (100+ metrics)
- [ ] Extraction tested on 5+ companies
- [ ] Query router tested with 50+ queries
- [ ] XBRL validation working

### Week 1 Deployment
- [ ] Deploy table extractor Lambda
- [ ] Deploy query router Lambda
- [ ] Deploy news vectorizer (EventBridge trigger)
- [ ] Deploy document upload handler
- [ ] Set up CloudWatch monitoring
- [ ] Run 24-hour soak test

### Post-Deployment
- [ ] Monitor accuracy dashboard
- [ ] Review flagged mismatches
- [ ] Adjust confidence thresholds if needed
- [ ] Scale DynamoDB if latency >100ms

---

## 💰 COST ESTIMATE

### DynamoDB On-Demand
```
Metrics:
- 100K queries/month
- Average 2 reads per query (quarterly + annual)
- 200K read units/month
- Cost: $0.25 per million reads = $0.05/month

Storage:
- 10M metrics (100 companies × 100K metrics each)
- 1KB per metric = 10GB storage
- Cost: $0.25/GB/month = $2.50/month

Total DynamoDB: ~$3/month (negligible)
```

### Bedrock KB
```
Current: 100 chunks × $X = High cost
Optimized: 5-10 chunks × $X = 90% reduction
```

### Lambda
```
Extraction: Run once per filing (minimal)
Query Router: <1ms per query = negligible
News/Docs: Event-driven = minimal

Total Lambda: ~$10/month
```

**Total Infrastructure: ~$15/month** (vs $100+ for RDS)

---

## 📞 SUPPORT & ESCALATION

### Issues Requiring Escalation
1. Accuracy below 99.9% after tuning
2. XBRL validation failures >1%
3. DynamoDB latency >200ms
4. Extraction failures on new filing formats

### Debug Checklist
1. Check CloudWatch logs for specific metric
2. Verify ground truth value in source filing
3. Check if XBRL tag mapping is correct
4. Review table extraction heuristics
5. Escalate to Ajay with specific filing URL + metric

---

## ✅ SUCCESS METRICS (Week 1)

- **Extraction Accuracy:** ≥99.999% (validated against ground truth)
- **Query Routing:** 100% correct document types
- **Latency:** <2 seconds end-to-end
- **XBRL Match Rate:** >98%
- **Confidence Scores:** Average >0.95
- **News Integration:** 30 days vectorized
- **Document Upload:** Multi-modal working

**If all metrics hit, you're ready for production!** 🎯
