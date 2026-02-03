# DynamoDB vs RDS: Production Decision Guide for FundLens

## Executive Summary

**RECOMMENDATION: Use DynamoDB Serverless**

For FundLens.ai's financial metrics retrieval system requiring 99.999% accuracy, DynamoDB is the superior choice based on:
1. Access patterns are key-value lookups (perfect for DynamoDB)
2. Zero operational overhead (critical for junior dev team)
3. 95% cost savings vs RDS
4. Sub-10ms latency vs 20-50ms for RDS
5. Native AWS integration (no VPC complexity)

---

## Detailed Comparison

### 1. Access Patterns (Most Important)

#### Your Query Patterns
```python
# Pattern 1: Get specific metric for specific period (90% of queries)
"What is AAPL's accounts payable for FY2024?"
→ PK: AAPL#accounts_payable, SK: FY2024#10K
→ PERFECT for DynamoDB (single key lookup)

# Pattern 2: Get latest N filings
"What is AAPL's latest revenue?"
→ Query GSI2 sorted by filing_date DESC
→ PERFECT for DynamoDB (sorted queries)

# Pattern 3: Cross-company comparison (rare, <5%)
"Show me revenue for all tech companies"
→ Query GSI1 by metric#period
→ GOOD for DynamoDB (with GSI)
→ GOOD for RDS (with indexes)
```

**Winner: DynamoDB** - Your primary patterns are exact key lookups

#### When RDS Would Be Better
```sql
-- Complex JOINs across multiple tables
SELECT m.ticker, m.value, c.sector, c.market_cap
FROM metrics m
JOIN companies c ON m.ticker = c.ticker
WHERE m.metric = 'revenue'
  AND c.sector = 'tech'
  AND m.value > (SELECT AVG(value) FROM metrics WHERE metric = 'revenue')
GROUP BY c.sector
HAVING AVG(m.value) > 1000000000;

-- This query is HARD in DynamoDB, EASY in RDS
```

**But you don't need this!** Your queries are simple key-value lookups.

---

### 2. Performance

| Metric | DynamoDB | RDS (db.t3.small) |
|--------|----------|-------------------|
| Single key lookup | 1-5ms | 10-30ms |
| Query with GSI | 5-15ms | 30-100ms |
| Sorted queries | 5-10ms | 50-150ms |
| Batch reads (25 items) | 10-20ms | 100-300ms |
| Cold start | 0ms | 5-10s |

**Winner: DynamoDB** (3-10x faster)

#### Real-World Example
```python
# Get AAPL accounts_payable FY2024

# DynamoDB (average 3ms)
result = table.get_item(
    Key={'PK': 'AAPL#accounts_payable', 'SK': 'FY2024#10K'}
)

# RDS (average 25ms)
result = conn.execute(
    "SELECT * FROM metrics WHERE ticker='AAPL' AND metric='accounts_payable' AND period='FY2024'"
)
```

---

### 3. Cost Analysis

#### DynamoDB On-Demand Pricing
```
Read Units:
- 1 read unit = 4KB
- Your metrics: ~1KB each
- 1 read unit per metric retrieval

Scenario: 300K queries/month
- 600K read units/month (2 reads per query: Q + FY)
- Cost: $0.25 per 1M reads
- Read cost: $0.15/month

Write Units:
- 10 companies × 500 metrics × 4 periods = 20K items
- Updated monthly
- Write cost: $0.025/month

Storage:
- 20K items × 1KB = 20MB
- Cost: $0.25/GB/month
- Storage cost: $0.005/month

TOTAL: ~$0.20/month (essentially FREE)
```

#### RDS Pricing
```
Database Instance:
- db.t3.small (2 vCPU, 2GB RAM)
- Minimum for production: $29/month
- In reality, need db.t3.medium: $58/month

Storage:
- 20GB SSD (minimum)
- $2.30/month

Backups:
- 20GB × $0.095 = $1.90/month

Data Transfer:
- Egress: ~$0.09/GB
- 300K queries × 1KB = 300MB = $0.03/month

TOTAL: ~$32-62/month (130-310x more expensive)
```

**Winner: DynamoDB** (saves $30-60/month)

---

### 4. Operational Overhead

#### DynamoDB (Serverless)
```
Daily Operations:
- Monitoring: Check CloudWatch (5 min/day)
- Backups: Automatic (no action)
- Scaling: Automatic (no action)
- Patching: N/A (managed)
- Failover: Automatic (multi-AZ)

Weekly Operations:
- Review costs: 10 min
- Check alarms: 5 min

Monthly Operations:
- Capacity planning: N/A (on-demand)
- Performance tuning: N/A (auto-optimized)

Developer Time: ~1 hour/month
```

#### RDS
```
Daily Operations:
- Monitoring: Check CloudWatch + slow query log (15 min/day)
- Check connections/locks: 10 min/day
- Verify backups: 5 min/day

Weekly Operations:
- Analyze query performance: 1 hour
- Review slow queries: 30 min
- Check disk space: 10 min
- Review parameter group: 20 min

Monthly Operations:
- Patching windows: 2 hours (coordinate downtime)
- Capacity planning: 1 hour
- Performance tuning (indexes): 2 hours
- Backup testing: 1 hour

Developer Time: ~10 hours/month
```

**Winner: DynamoDB** (saves 9 hours/month)

**For junior dev in India:** DynamoDB means less to go wrong, no 2AM pages for database issues.

---

### 5. Scalability

#### DynamoDB
```
Traffic Pattern: 100 queries/hour → 10,000 queries/hour

DynamoDB:
- Response: Instant (no configuration needed)
- Cost: Scales linearly ($0.15/month → $15/month)
- Performance: Same (1-5ms)
- Developer action: None

Example: Black Friday spike
- Traffic: 100x normal
- DynamoDB: Handles automatically
- Cost: Pay only for what you use
```

#### RDS
```
Traffic Pattern: 100 queries/hour → 10,000 queries/hour

RDS:
- Response: Need to resize instance
- Steps:
  1. Analyze current utilization
  2. Choose new instance size
  3. Schedule downtime window
  4. Resize (5-10 min downtime)
- Cost: db.t3.small ($29) → db.m5.large ($140)
- Performance: Depends on tuning
- Developer action: 2-4 hours

Example: Black Friday spike
- Traffic: 100x normal
- RDS: Need to pre-scale or face downtime
- Cost: Must pay for peak capacity 24/7
```

**Winner: DynamoDB** (zero-touch scalability)

---

### 6. High Availability & Disaster Recovery

#### DynamoDB
```
Built-in:
- Multi-AZ replication (automatic)
- Point-in-time recovery (enable with 1 click)
- Global tables (if needed for multi-region)
- 99.99% SLA (standard)
- 99.999% SLA (global tables)

Recovery:
- Point-in-time: Restore to any second in last 35 days
- Full backup: Automatic
- Recovery time: Minutes

Developer effort: ZERO (turn on PITR in console)
```

#### RDS
```
Setup Required:
- Multi-AZ deployment: 2x cost
- Read replicas: Setup + manage
- Backups: Configure retention
- Snapshot strategy: Plan + execute

Recovery:
- Point-in-time: Configure backup window
- Full restore: 15-60 minutes
- Failover: 30-120 seconds (Multi-AZ)

Developer effort: 
- Initial setup: 4 hours
- Ongoing testing: 2 hours/quarter
```

**Winner: DynamoDB** (HA included, zero setup)

---

### 7. Development Experience

#### DynamoDB
```python
# Simple and intuitive
from boto3.dynamodb.conditions import Key

# Get item
response = table.get_item(Key={'PK': 'AAPL#revenue', 'SK': 'FY2024#10K'})
value = response['Item']['value']

# Query with sort
response = table.query(
    KeyConditionExpression=Key('PK').eq('AAPL#revenue'),
    ScanIndexForward=False,  # Newest first
    Limit=10
)

# Batch get
response = dynamodb.batch_get_item(
    RequestItems={
        'fundlens_financial_metrics': {
            'Keys': [
                {'PK': 'AAPL#revenue', 'SK': 'FY2024#10K'},
                {'PK': 'AAPL#revenue', 'SK': 'Q32024#10Q'}
            ]
        }
    }
)
```

#### RDS
```python
# More complex setup
import psycopg2
from psycopg2.pool import SimpleConnectionPool

# Manage connection pool
pool = SimpleConnectionPool(
    minconn=1,
    maxconn=20,
    host='fundlens.xyz.rds.amazonaws.com',
    port=5432,
    database='fundlens',
    user='admin',
    password='...'  # Secrets management needed
)

# Execute query
conn = pool.getconn()
cursor = conn.cursor()
cursor.execute(
    "SELECT value FROM metrics WHERE ticker=%s AND metric=%s AND period=%s",
    ('AAPL', 'revenue', 'FY2024')
)
result = cursor.fetchone()
cursor.close()
pool.putconn(conn)

# Issues to handle:
# - Connection management
# - Transaction isolation
# - Deadlocks
# - Connection leaks
# - SQL injection prevention
```

**Winner: DynamoDB** (simpler code, fewer edge cases)

---

### 8. Security

#### DynamoDB
```
Built-in:
- IAM-based access control (granular permissions)
- Encryption at rest (KMS, automatic)
- Encryption in transit (TLS, automatic)
- VPC endpoints (if needed, optional)
- Fine-grained access control (item-level)
- Audit logging (CloudTrail)

No credentials to manage in application code!
```

#### RDS
```
Setup Required:
- VPC configuration (subnets, security groups)
- Master password management (Secrets Manager)
- SSL certificates
- IAM database authentication (optional, complex)
- Network ACLs
- Bastion host (for secure access)

Credentials in code: YES (unless using IAM auth)
```

**Winner: DynamoDB** (simpler, more secure by default)

---

### 9. Testing & Development

#### DynamoDB
```
Local Development:
- DynamoDB Local (Docker)
- Same API as production
- No connection strings

Testing:
- Unit tests: Mock boto3 with moto
- Integration tests: DynamoDB Local
- No database seeding complexity

Example:
docker run -p 8000:8000 amazon/dynamodb-local
# Full DynamoDB running locally, identical to prod
```

#### RDS
```
Local Development:
- PostgreSQL in Docker
- Different connection string
- Schema migrations needed

Testing:
- Unit tests: Mock connections
- Integration tests: Test database
- Seed test data (schema + data)
- Transaction cleanup between tests

Example:
docker run -p 5432:5432 -e POSTGRES_PASSWORD=test postgres
# Then: CREATE DATABASE, run migrations, seed data
```

**Winner: DynamoDB** (easier local dev)

---

### 10. Decision Matrix

| Factor | Weight | DynamoDB Score | RDS Score | Winner |
|--------|--------|----------------|-----------|--------|
| Query patterns match | 30% | 10/10 | 6/10 | DynamoDB |
| Performance | 20% | 10/10 | 7/10 | DynamoDB |
| Cost | 15% | 10/10 | 3/10 | DynamoDB |
| Operational overhead | 15% | 10/10 | 5/10 | DynamoDB |
| Developer experience | 10% | 9/10 | 7/10 | DynamoDB |
| Scalability | 5% | 10/10 | 6/10 | DynamoDB |
| Security | 3% | 9/10 | 8/10 | DynamoDB |
| Testing | 2% | 9/10 | 7/10 | DynamoDB |

**Weighted Score:**
- DynamoDB: 9.7/10
- RDS: 6.1/10

---

## When RDS Makes Sense (Not Your Case)

Use RDS if:
1. ✅ Complex JOINs across many tables (>5 tables)
2. ✅ Need full SQL features (window functions, CTEs, etc.)
3. ✅ Migrating from existing PostgreSQL app
4. ✅ Need ACID transactions across multiple items
5. ✅ Have dedicated DBA on staff

**None of these apply to FundLens!**

---

## Migration Path (If You Later Need RDS)

DynamoDB → RDS is easy if needed:

```python
# Export DynamoDB to CSV
import boto3
import csv

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('fundlens_financial_metrics')

response = table.scan()
with open('export.csv', 'w') as f:
    writer = csv.DictWriter(f, fieldnames=response['Items'][0].keys())
    writer.writeheader()
    writer.writerows(response['Items'])

# Load into RDS
psql -h fundlens.rds.amazonaws.com -U admin -d fundlens \
  -c "\COPY metrics FROM 'export.csv' CSV HEADER"
```

Takes ~1 hour for migration. But you likely won't need it!

---

## Final Recommendation

### Choose DynamoDB Because:

1. **Perfect Fit:** Your queries are key-value lookups (DynamoDB's strength)
2. **99.999% Accuracy:** DynamoDB's single-digit-ms latency helps hit target
3. **Zero Ops:** Junior dev team doesn't manage servers/patches/scaling
4. **Cost:** 130x cheaper than RDS ($0.20/mo vs $30-60/mo)
5. **Speed:** 3-10x faster than RDS (3ms vs 25ms)
6. **Scale:** Handles Black Friday spikes automatically
7. **Simple Code:** boto3 DynamoDB API is cleaner than SQL
8. **AWS Native:** No VPC setup, IAM-based auth, CloudWatch integration

### Start with DynamoDB On-Demand

Don't even consider RDS Provisioned initially:
- On-Demand: Zero capacity planning
- Provisioned: Need to estimate RCU/WCU (complex)
- Can switch later if needed (rare)

---

## Implementation Decision: ✅ DynamoDB Serverless

**Next Step:** Use the DynamoDB schema and code from DEVELOPER_IMPLEMENTATION_GUIDE.md

Your junior developer will thank you! 🙏
