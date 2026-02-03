# YoY Growth Fix - Implementation Plan

## Problem
NVDA (and potentially other tickers) showing N/A for YoY growth on Revenue and Net Income because:
1. No `fiscalYear` field in schema - only `fiscalPeriod` (e.g., "FY2024", "2024")
2. YoY calculations done in frontend JavaScript (non-deterministic)
3. Calculated metrics not stored or exposed to RAG

## Solution Architecture

### 1. Use Deterministic Python Calculator
- Leverage existing `python_parser/comprehensive_financial_calculator.py`
- Add YoY growth calculation methods
- Ensure calculations are deterministic and auditable

### 2. Store Calculated Metrics
- Create `calculated_metrics` table to store YoY growth, margins, ratios
- Link to source metrics for traceability
- Include calculation metadata (formula, confidence, timestamp)

### 3. Expose to RAG
- Sync calculated metrics to Bedrock KB as structured data
- Enable queries like "What is NVDA's revenue growth?" 
- Include calculation provenance in responses

## Implementation Steps

### Step 1: Database Schema (5 min)
- Create `calculated_metrics` table
- Add indexes for efficient querying
- Migration script

### Step 2: Python Calculator Enhancement (15 min)
- Add `calculate_yoy_growth()` method
- Add `calculate_margins()` method  
- Add `calculate_ratios()` method
- Unit tests for deterministic behavior

### Step 3: TypeScript Service Integration (15 min)
- Create `CalculatedMetricsService`
- Call Python calculator via HTTP
- Store results in database
- Unit tests

### Step 4: Pipeline Integration (10 min)
- Add Step E: Calculate derived metrics
- Run after financial metrics extraction
- Batch process for efficiency

### Step 5: RAG Integration (10 min)
- Extend structured retriever to query calculated metrics
- Add intent patterns for growth/margin queries
- Format responses with calculation details

### Step 6: Frontend Integration (5 min)
- Update workspace to fetch from calculated_metrics
- Remove frontend YoY calculation logic
- Display with confidence indicators

## Database Schema

```sql
CREATE TABLE calculated_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker VARCHAR(10) NOT NULL,
  metric_type VARCHAR(50) NOT NULL, -- 'yoy_growth', 'margin', 'ratio'
  metric_name VARCHAR(100) NOT NULL, -- 'revenue_yoy_growth', 'gross_margin'
  value DECIMAL(20, 4) NOT NULL,
  fiscal_period VARCHAR(50) NOT NULL,
  comparison_period VARCHAR(50), -- For YoY: prior period
  calculation_method VARCHAR(50) NOT NULL, -- 'python_calculator_v1'
  formula TEXT, -- Human-readable formula
  source_metric_ids TEXT[], -- Array of source metric IDs
  confidence_score DECIMAL(5, 2) DEFAULT 1.0,
  metadata JSONB, -- Additional calculation details
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(ticker, metric_type, metric_name, fiscal_period)
);

CREATE INDEX idx_calculated_metrics_ticker ON calculated_metrics(ticker);
CREATE INDEX idx_calculated_metrics_type ON calculated_metrics(metric_type);
CREATE INDEX idx_calculated_metrics_period ON calculated_metrics(fiscal_period);
```

## Python Calculator API

```python
# POST /calculate/yoy-growth
{
  "ticker": "NVDA",
  "metrics": ["revenue", "net_income", "operating_income"],
  "periods": ["FY2024", "FY2023"]
}

# Response
{
  "calculations": [
    {
      "metric_name": "revenue_yoy_growth",
      "value": 122.4,
      "unit": "percent",
      "current_period": "FY2024",
      "prior_period": "FY2023",
      "current_value": 60922000000,
      "prior_value": 26974000000,
      "formula": "(current - prior) / prior * 100",
      "confidence": 1.0
    }
  ]
}
```

## Benefits

1. **Deterministic**: Same inputs always produce same outputs
2. **Auditable**: Full calculation provenance stored
3. **RAG-Enabled**: Analysts can query growth metrics naturally
4. **Performant**: Pre-calculated, no runtime computation
5. **Testable**: Unit tests ensure accuracy
6. **Scalable**: Batch processing for all tickers

## Testing Strategy

1. **Unit Tests**: Python calculator logic
2. **Integration Tests**: TypeScript service → Python API
3. **E2E Tests**: Pipeline → Database → RAG → Frontend
4. **Regression Tests**: Verify NVDA YoY growth displays correctly

## Timeline

- Step 1 (Schema): 5 min
- Step 2 (Python): 15 min  
- Step 3 (TypeScript): 15 min
- Step 4 (Pipeline): 10 min
- Step 5 (RAG): 10 min
- Step 6 (Frontend): 5 min
- Testing: 10 min

**Total**: ~70 minutes

## Success Criteria

✅ NVDA Revenue YoY growth shows 122.4% (not N/A)
✅ NVDA Net Income YoY growth shows correct value
✅ RAG query "What is NVDA's revenue growth?" returns accurate answer
✅ All calculations deterministic (same result every time)
✅ Unit tests passing (100%)
✅ E2E test passing

## Next Steps

1. Run diagnostic script to confirm root cause
2. Implement database schema
3. Enhance Python calculator
4. Integrate with pipeline
5. Test with NVDA
6. Deploy to production
