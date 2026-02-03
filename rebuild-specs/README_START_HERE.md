# FundLens.ai - Developer Handoff Package
## SEC Filings Accuracy Enhancement + News/Docs Integration

**Target:** 99.999% accuracy on financial metrics  
**Timeline:** 1 week sprint  
**Developer:** India-based team  

---

## 📦 PACKAGE CONTENTS

You've received **9 files** to implement FundLens.ai's production-grade financial data retrieval:

| File | Purpose | Read Order |
|------|---------|------------|
| **README.md** | ← YOU ARE HERE (start here!) | 1️⃣ |
| **DEVELOPER_IMPLEMENTATION_GUIDE.md** | Day-by-day tasks with code | 2️⃣ |
| **DYNAMODB_VS_RDS_DECISION.md** | Why DynamoDB (vs RDS) | 3️⃣ |
| **EXECUTIVE_SUMMARY.md** | High-level overview for Ajay | Reference |
| **implementation_roadmap.md** | Original week-by-week plan | Reference |
| **sec_table_extractor.py** | Table extraction code | Implementation |
| **query_processor.py** | Query routing code | Implementation |
| **sec_preprocessing_strategy.md** | Technical deep-dive | Reference |
| **deployment_package.sh** | Deployment automation | Deploy |

---

## 🎯 WHAT YOU'RE BUILDING

### The Problem
Current system has ~50% accuracy on queries like:
```
"What is AAPL's accounts payable for latest fiscal year?"
```

### The Solution
**Structured extraction** for tables + **vector search** for narratives = **99.999% accuracy**

### How It Works
```
SEC Filing (HTML)
    ↓
Split into TWO paths:
    ├─> TABLES → Parse → Normalize → DynamoDB → EXACT retrieval
    └─> TEXT → Chunk → Embed → Bedrock KB → Context retrieval
```

---

## 🏗️ ARCHITECTURE DECISIONS (Already Made)

### 1. Database: DynamoDB Serverless ✅
**Why not RDS?**
- DynamoDB: $0.20/month, 3ms latency, zero ops
- RDS: $30-60/month, 25ms latency, 10 hours/month ops

See `DYNAMODB_VS_RDS_DECISION.md` for full analysis.

### 2. Table Extraction: HTML Parsing + XBRL Validation ✅
- Parse HTML `<table>` tags with BeautifulSoup
- Validate against XBRL (if available) for 99.999% accuracy
- Use Ajay's mini_MVP_metrics.xlsx for synonym normalization

### 3. Query Routing: Intent-Based ✅
- "latest" = BOTH quarterly + annual (Ajay's requirement)
- "latest quarter" = quarterly only
- Direct DynamoDB queries (not vector search) for metrics

---

## 🚀 WEEK 1 SPRINT PLAN

### DAY 1: Infrastructure (4 hours)
**Tasks:**
1. Create 4 DynamoDB tables
2. Load mini_MVP_metrics.xlsx into mappings table
3. Verify tables in AWS Console

**Deliverable:** DynamoDB tables ready with mappings loaded

**Files to use:**
- `DEVELOPER_IMPLEMENTATION_GUIDE.md` → Task 1.1, 1.2

---

### DAY 2-3: Table Extraction (8 hours)
**Tasks:**
1. Implement enhanced table extractor with XBRL validation
2. Build 100-item ground truth test dataset
3. Run extraction on 5 companies (AAPL, MSFT, GOOGL, AMZN, TSLA)
4. Validate 99.999% accuracy

**Deliverable:** Extraction pipeline achieving target accuracy

**Files to use:**
- `sec_table_extractor.py` (base code)
- `DEVELOPER_IMPLEMENTATION_GUIDE.md` → Task 2.1, 2.2

**Critical for 99.999%:**
```python
# Three-layer validation
1. HTML table parsing
2. XBRL cross-check (when available)
3. Confidence scoring (reject if <0.9)
```

---

### DAY 4: Query Router (3 hours)
**Tasks:**
1. Integrate query_processor.py with DynamoDB
2. Implement "latest" = both Q + FY logic
3. Test with 50 sample queries

**Deliverable:** Router correctly handling all query types

**Files to use:**
- `query_processor.py` (base code)
- `DEVELOPER_IMPLEMENTATION_GUIDE.md` → Task 4.1

**Critical Logic:**
```python
if "latest" in query and not "quarter" and not "annual":
    doc_types = ['10-Q', '10-K']  # MUST retrieve BOTH
```

---

### DAY 5: News & Docs Integration (6 hours)
**Tasks:**
1. Build news vectorizer for 30-day news API
2. Implement multi-modal document handler (PDF, DOCX, XLSX, images)
3. Deploy Lambda triggers for S3 uploads

**Deliverable:** News and user docs integrated into Bedrock KB

**Files to use:**
- `DEVELOPER_IMPLEMENTATION_GUIDE.md` → Task 5.1, 5.2

---

### DAY 6-7: Testing & Deployment (6 hours)
**Tasks:**
1. Run comprehensive test suite (extraction, routing, API)
2. Set up CloudWatch monitoring and alerts
3. Deploy to production
4. 24-hour soak test

**Deliverable:** Production system with 99.999% accuracy verified

**Files to use:**
- `DEVELOPER_IMPLEMENTATION_GUIDE.md` → Task 6.1, 6.2
- `deployment_package.sh` (automation)

---

## 📋 SETUP INSTRUCTIONS

### Prerequisites
```bash
# AWS CLI configured
aws --version  # Should be 2.x

# Python 3.9+
python3 --version

# Install dependencies
pip install boto3 pandas beautifulsoup4 lxml pytesseract pdf2image python-docx openpyxl
```

### Environment Variables
```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export FUNDLENS_ENV=production
```

### Clone & Navigate
```bash
cd /path/to/fundlens-project
# Place all 9 files from this package in project root
```

---

## 🔧 IMPLEMENTATION GUIDE

### Step 1: Read This File (YOU ARE HERE) ✅

### Step 2: Read DEVELOPER_IMPLEMENTATION_GUIDE.md
This is your **primary implementation document**. It has:
- Day-by-day task breakdown
- Complete Python code for all components
- DynamoDB schema with examples
- Testing procedures
- Deployment checklist

**Time:** 30 minutes to read thoroughly

### Step 3: Understand Why DynamoDB
Read `DYNAMODB_VS_RDS_DECISION.md` to understand the architectural decision.

**Time:** 15 minutes

### Step 4: Start Implementation
Follow tasks in `DEVELOPER_IMPLEMENTATION_GUIDE.md` Day 1 → Day 7.

**Time:** 1 week

---

## 🎯 SUCCESS CRITERIA

After Week 1, you should have:

### Accuracy Metrics
- [ ] Extraction accuracy: ≥99.999% (1 error per 100,000 queries)
- [ ] XBRL match rate: >98%
- [ ] Confidence scores: Average >0.95
- [ ] Query routing: 100% correct document types

### Performance Metrics
- [ ] DynamoDB query latency: <10ms
- [ ] API end-to-end latency: <2 seconds
- [ ] News vectorization: Complete for 30 days
- [ ] Document uploads: Multi-modal working

### Operational Metrics
- [ ] CloudWatch dashboard: Active
- [ ] Alerts: Configured (accuracy <99.9%)
- [ ] Test suite: All passing
- [ ] Documentation: Updated

---

## 🧪 TESTING STRATEGY

### Unit Tests
```bash
# Test individual components
python tests/test_table_extractor.py
python tests/test_query_router.py
python tests/test_metric_normalizer.py
```

### Integration Tests
```bash
# Test DynamoDB integration
python tests/test_dynamodb_queries.py

# Test API integration
python tests/test_api_integration.py
```

### Accuracy Validation
```bash
# Run against ground truth dataset
python tests/test_extraction_accuracy.py

# Expected output:
# ✅ Accuracy: 99.999% (1000/1000 test cases passed)
```

---

## 🚨 COMMON PITFALLS & SOLUTIONS

### Pitfall 1: XBRL Validation Failing
**Symptom:** Accuracy below 99%

**Solution:**
```python
# Check if XBRL file exists for the filing
# Some older filings don't have XBRL
# In that case, confidence_score = 0.95 instead of 1.0

if xbrl_available:
    validate_against_xbrl()
else:
    confidence_score = 0.95  # Still acceptable!
```

### Pitfall 2: DynamoDB Throttling
**Symptom:** `ProvisionedThroughputExceededException`

**Solution:**
```python
# We're using On-Demand mode (pay per request)
# This should NEVER happen

# If it does, check:
1. Are you in On-Demand mode? (not Provisioned)
2. Are you doing a table scan? (DON'T - use queries)
```

### Pitfall 3: "Latest" Returns Only One Period
**Symptom:** User asks for "latest revenue", only gets Q3 2024

**Solution:**
```python
# Check query_processor.py routing logic
if period_type == PeriodType.LATEST_BOTH:
    # MUST retrieve BOTH 10-Q and 10-K
    results['10-Q'] = self._get_latest_filings(ticker, metric, '10-Q')
    results['10-K'] = self._get_latest_filings(ticker, metric, '10-K')
```

### Pitfall 4: Table Parsing Missing Metrics
**Symptom:** Can't find "Net Income" but it's in the filing

**Solution:**
```python
# Check synonym mappings
# "Net Income" might be labeled as:
# - "Net Earnings"
# - "Net Profit"
# - "Net Income Attributable to Common Shareholders"

# Verify mini_MVP_metrics.xlsx has all synonyms loaded
```

---

## 📊 MONITORING & ALERTS

### CloudWatch Dashboard
URL: `https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=FundLens-Production`

**Key Metrics:**
- Extraction Accuracy (target: >99.999%)
- XBRL Match Rate (target: >98%)
- Query Latency (target: <2s)
- DynamoDB Latency (target: <10ms)

### Alerts
You'll receive SNS alerts for:
- Accuracy drops below 99.9%
- XBRL mismatch rate >2%
- API latency >5 seconds
- Lambda errors

---

## 💰 COST TRACKING

### Expected Monthly Costs
```
DynamoDB: ~$0.20
Lambda: ~$10
S3: ~$5
Bedrock KB: ~$20
CloudWatch: ~$3

TOTAL: ~$40/month
```

### Cost Optimization
- DynamoDB On-Demand scales to zero when idle
- Lambda charged only when running
- S3 uses Intelligent-Tiering
- Bedrock KB uses chunking optimization (5-10 chunks, not 100)

---

## 🆘 GETTING HELP

### Issues Requiring Escalation to Ajay
1. Extraction accuracy <99.9% after validation tuning
2. XBRL validation failures >2%
3. New filing format that parser can't handle
4. Architecture-level questions

### Debug Process
1. Check CloudWatch Logs for specific error
2. Verify ground truth value in source SEC filing
3. Review XBRL tag mapping in DynamoDB
4. Check table extraction heuristics
5. Escalate with specific details:
   - Filing URL
   - Metric name
   - Expected vs actual value
   - Confidence score

### Contact
- **Slack:** #fundlens-dev
- **Email:** ajay@fundlens.ai
- **Hours:** India time zone aligned

---

## 📚 REFERENCE DOCUMENTATION

### AWS Documentation
- [DynamoDB Developer Guide](https://docs.aws.amazon.com/dynamodb/)
- [Lambda Developer Guide](https://docs.aws.amazon.com/lambda/)
- [Bedrock Knowledge Bases](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)

### SEC Filing Formats
- [SEC EDGAR Documentation](https://www.sec.gov/edgar)
- [XBRL Taxonomy](https://www.sec.gov/structureddata/osd-inline-xbrl.html)

### Python Libraries
- [boto3 Documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html)
- [BeautifulSoup4](https://www.crummy.com/software/BeautifulSoup/bs4/doc/)
- [pandas](https://pandas.pydata.org/docs/)

---

## ✅ FINAL CHECKLIST BEFORE STARTING

- [ ] AWS CLI configured and working
- [ ] Python 3.9+ installed with all dependencies
- [ ] mini_MVP_metrics.xlsx file downloaded
- [ ] Read DEVELOPER_IMPLEMENTATION_GUIDE.md
- [ ] Understood DYNAMODB_VS_RDS_DECISION.md
- [ ] Have access to existing SEC filings S3 bucket
- [ ] Have Bedrock KB ID from Ajay
- [ ] Slack channel access for questions
- [ ] Calendar blocked for 1-week sprint

---

## 🎉 LET'S BUILD!

You have everything you need to build a production-grade financial data system with **99.999% accuracy**. 

**Key Success Factors:**
1. Follow DEVELOPER_IMPLEMENTATION_GUIDE.md day by day
2. Don't skip XBRL validation (that's the key to 99.999%)
3. Test extraction on ground truth dataset before moving forward
4. Ask questions early (don't wait until day 7!)

**Start here:** Open `DEVELOPER_IMPLEMENTATION_GUIDE.md` and begin with Day 1, Task 1.1.

Good luck! 🚀
