# AWS RDS PostgreSQL Setup & Migration Guide

## Overview

This guide covers setting up a production-grade PostgreSQL database on AWS RDS and migrating your local data to the cloud.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Current (Local)                           │
│  PostgreSQL on localhost:5432                                │
│  - Development database                                      │
│  - All data stored locally                                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Migration
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Production (AWS RDS)                        │
│  PostgreSQL on RDS                                           │
│  - Multi-AZ deployment                                       │
│  - Automated backups                                         │
│  - High availability                                         │
│  - Scalable                                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Create RDS PostgreSQL Instance

### Option A: Using AWS Console (Recommended for First Time)

#### Step 1: Navigate to RDS

1. Go to: https://console.aws.amazon.com/rds/
2. Click **"Create database"**

#### Step 2: Choose Database Creation Method

- Select: **Standard create**
- Engine type: **PostgreSQL**
- Engine version: **PostgreSQL 15.x** (latest stable)

#### Step 3: Templates

Choose based on your needs:
- **Production**: Multi-AZ, high availability (~$200/month)
- **Dev/Test**: Single-AZ, lower cost (~$50/month)
- **Free tier**: Very limited, good for testing (~$0 for 12 months)

**Recommendation**: Start with **Dev/Test**, upgrade to Production later

#### Step 4: Settings

```
DB instance identifier: fundlens-db
Master username: fundlens_admin
Master password: [Generate strong password - save it!]
```

**Important**: Save the password securely!

#### Step 5: Instance Configuration

**For Dev/Test**:
- DB instance class: **db.t3.medium** (2 vCPU, 4 GB RAM)
- Storage type: **General Purpose SSD (gp3)**
- Allocated storage: **100 GB**
- Enable storage autoscaling: **Yes**
- Maximum storage threshold: **500 GB**

**For Production**:
- DB instance class: **db.r6g.xlarge** (4 vCPU, 32 GB RAM)
- Storage type: **Provisioned IOPS SSD (io1)**
- Allocated storage: **500 GB**
- Provisioned IOPS: **10,000**

#### Step 6: Connectivity

```
Virtual private cloud (VPC): [Default VPC]
Subnet group: [Default]
Public access: Yes (for now - will restrict later)
VPC security group: Create new
  - Name: fundlens-db-sg
  - Inbound rules: PostgreSQL (5432) from your IP
```

**Security Note**: We'll restrict this to your application's security group later

#### Step 7: Database Authentication

- Database authentication: **Password authentication**
- (Optional) Enable IAM database authentication for extra security

#### Step 8: Additional Configuration

```
Initial database name: fundlens_db
DB parameter group: default.postgres15
Backup:
  - Enable automated backups: Yes
  - Backup retention period: 7 days
  - Backup window: Preferred time
  
Encryption:
  - Enable encryption: Yes
  - Use AWS KMS key: (default) aws/rds
  
Monitoring:
  - Enable Enhanced Monitoring: Yes
  - Granularity: 60 seconds
  
Maintenance:
  - Enable auto minor version upgrade: Yes
  - Maintenance window: Preferred time
  
Deletion protection: Enable (for production)
```

#### Step 9: Create Database

- Review all settings
- Click **"Create database"**
- Wait 10-15 minutes for creation

---

### Option B: Using AWS CLI / Script

Create a script to automate RDS creation:

```bash
#!/bin/bash

# Configuration
DB_INSTANCE_ID="fundlens-db"
DB_NAME="fundlens_db"
DB_USERNAME="fundlens_admin"
DB_PASSWORD="YourSecurePassword123!"  # Change this!
DB_CLASS="db.t3.medium"
ALLOCATED_STORAGE=100
ENGINE_VERSION="15.4"

# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier $DB_INSTANCE_ID \
  --db-instance-class $DB_CLASS \
  --engine postgres \
  --engine-version $ENGINE_VERSION \
  --master-username $DB_USERNAME \
  --master-user-password $DB_PASSWORD \
  --allocated-storage $ALLOCATED_STORAGE \
  --storage-type gp3 \
  --storage-encrypted \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00" \
  --preferred-maintenance-window "mon:04:00-mon:05:00" \
  --db-name $DB_NAME \
  --publicly-accessible \
  --enable-cloudwatch-logs-exports '["postgresql"]' \
  --deletion-protection \
  --tags Key=Project,Value=FundLens Key=Environment,Value=Production

echo "✅ RDS instance creation initiated"
echo "⏳ This will take 10-15 minutes..."
echo ""
echo "Check status with:"
echo "aws rds describe-db-instances --db-instance-identifier $DB_INSTANCE_ID"
```

---

## Phase 2: Configure Security

### Step 1: Get RDS Endpoint

```bash
# Get the endpoint
aws rds describe-db-instances \
  --db-instance-identifier fundlens-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text

# Example output: fundlens-db.abc123.us-east-1.rds.amazonaws.com
```

### Step 2: Configure Security Group

```bash
# Get your current IP
MY_IP=$(curl -s https://checkip.amazonaws.com)

# Get security group ID
SG_ID=$(aws rds describe-db-instances \
  --db-instance-identifier fundlens-db \
  --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' \
  --output text)

# Allow access from your IP
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 5432 \
  --cidr $MY_IP/32

echo "✅ Security group configured"
```

### Step 3: Test Connection

```bash
# Test connection (requires psql)
psql -h fundlens-db.abc123.us-east-1.rds.amazonaws.com \
     -U fundlens_admin \
     -d fundlens_db

# Or using Node.js
node -e "
const { Client } = require('pg');
const client = new Client({
  host: 'fundlens-db.abc123.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'fundlens_db',
  user: 'fundlens_admin',
  password: 'YourPassword',
  ssl: { rejectUnauthorized: false }
});
client.connect()
  .then(() => console.log('✅ Connected to RDS!'))
  .catch(err => console.error('❌ Connection failed:', err.message))
  .finally(() => client.end());
"
```

---

## Phase 3: Migration Strategy

### Option 1: pg_dump/pg_restore (Recommended)

**Best for**: Complete database migration with all data

```bash
#!/bin/bash

# Configuration
LOCAL_DB="postgresql://fundlens_user:fundlens_password@localhost:5432/fundlens_db"
RDS_DB="postgresql://fundlens_admin:YourPassword@fundlens-db.abc123.us-east-1.rds.amazonaws.com:5432/fundlens_db"

echo "📦 Creating backup of local database..."
pg_dump $LOCAL_DB > fundlens_backup.sql

echo "📊 Backup size:"
ls -lh fundlens_backup.sql

echo "🚀 Restoring to RDS..."
psql $RDS_DB < fundlens_backup.sql

echo "✅ Migration complete!"

# Verify
echo "🔍 Verifying migration..."
psql $RDS_DB -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"
```

### Option 2: Prisma Migrate (For Schema Only)

**Best for**: Fresh start with schema only, no data

```bash
# Update .env with RDS connection
DATABASE_URL="postgresql://fundlens_admin:YourPassword@fundlens-db.abc123.us-east-1.rds.amazonaws.com:5432/fundlens_db?schema=public&sslmode=require"

# Push schema to RDS
npx prisma db push

# Run migrations
node scripts/run-migration.js

echo "✅ Schema migrated to RDS"
```

### Option 3: Incremental Migration (Zero Downtime)

**Best for**: Production migration with no downtime

```javascript
// scripts/migrate-to-rds.js
const { Client } = require('pg');
require('dotenv').config();

const LOCAL_DB = process.env.DATABASE_URL;
const RDS_DB = process.env.RDS_DATABASE_URL;

async function migrateTable(tableName) {
  const localClient = new Client({ connectionString: LOCAL_DB });
  const rdsClient = new Client({ 
    connectionString: RDS_DB,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await localClient.connect();
    await rdsClient.connect();

    console.log(`Migrating table: ${tableName}...`);

    // Get row count
    const countResult = await localClient.query(`SELECT COUNT(*) FROM ${tableName}`);
    const totalRows = parseInt(countResult.rows[0].count);
    console.log(`  Total rows: ${totalRows}`);

    // Migrate in batches
    const batchSize = 1000;
    let offset = 0;

    while (offset < totalRows) {
      const result = await localClient.query(
        `SELECT * FROM ${tableName} LIMIT $1 OFFSET $2`,
        [batchSize, offset]
      );

      if (result.rows.length > 0) {
        // Insert into RDS
        for (const row of result.rows) {
          const columns = Object.keys(row);
          const values = Object.values(row);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          
          await rdsClient.query(
            `INSERT INTO ${tableName} (${columns.join(', ')}) 
             VALUES (${placeholders}) 
             ON CONFLICT DO NOTHING`,
            values
          );
        }
      }

      offset += batchSize;
      console.log(`  Progress: ${Math.min(offset, totalRows)}/${totalRows}`);
    }

    console.log(`✅ ${tableName} migrated successfully`);
  } catch (error) {
    console.error(`❌ Error migrating ${tableName}:`, error.message);
    throw error;
  } finally {
    await localClient.end();
    await rdsClient.end();
  }
}

async function migrateAll() {
  const tables = [
    'tenants',
    'tenant_users',
    'data_sources',
    'tenant_data_access',
    'financial_metrics',
    'narrative_chunks',
    'uploaded_documents',
    'news_articles',
    'subscriptions',
    'usage_logs',
    's3_sync_state'
  ];

  for (const table of tables) {
    await migrateTable(table);
  }

  console.log('🎉 All tables migrated successfully!');
}

migrateAll();
```

---

## Phase 4: Update Application Configuration

### Step 1: Update .env

```bash
# Add RDS connection (keep local for development)
DATABASE_URL="postgresql://fundlens_user:fundlens_password@localhost:5432/fundlens_db?schema=public"

# Production RDS connection
RDS_DATABASE_URL="postgresql://fundlens_admin:YourPassword@fundlens-db.abc123.us-east-1.rds.amazonaws.com:5432/fundlens_db?schema=public&sslmode=require"

# Use this for production
# DATABASE_URL="${RDS_DATABASE_URL}"
```

### Step 2: SSL Configuration

Update Prisma client for SSL:

```typescript
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // Add SSL configuration for RDS
  // url      = env("DATABASE_URL") + "?sslmode=require"
}
```

### Step 3: Connection Pooling

For production, use connection pooling:

```typescript
// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      // Connection pool settings for RDS
      log: ['error', 'warn'],
      errorFormat: 'pretty',
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
```

---

## Phase 5: Monitoring & Optimization

### CloudWatch Metrics

Monitor these key metrics:
- **CPUUtilization**: Should be < 80%
- **DatabaseConnections**: Monitor connection pool
- **FreeableMemory**: Should have headroom
- **ReadLatency/WriteLatency**: Should be < 10ms
- **DiskQueueDepth**: Should be < 10

### Performance Tuning

```sql
-- Check slow queries
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  max_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check index usage
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

---

## Cost Estimation

### Monthly Costs

| Instance Type | vCPU | RAM | Storage | Cost/Month |
|---------------|------|-----|---------|------------|
| db.t3.micro (Free tier) | 2 | 1 GB | 20 GB | $0 (12 months) |
| db.t3.small | 2 | 2 GB | 100 GB | ~$30 |
| db.t3.medium | 2 | 4 GB | 100 GB | ~$60 |
| db.t3.large | 2 | 8 GB | 200 GB | ~$120 |
| db.r6g.xlarge | 4 | 32 GB | 500 GB | ~$250 |
| db.r6g.2xlarge | 8 | 64 GB | 1 TB | ~$500 |

**Additional Costs**:
- Storage: $0.115/GB/month (gp3)
- Backup storage: $0.095/GB/month
- Data transfer: $0.09/GB out

**Recommendation**: Start with **db.t3.medium** (~$60/month)

---

## Backup & Disaster Recovery

### Automated Backups

RDS automatically backs up your database:
- **Retention**: 7-35 days
- **Point-in-time recovery**: Any second within retention period
- **Automated snapshots**: Daily during backup window

### Manual Snapshots

```bash
# Create manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier fundlens-db \
  --db-snapshot-identifier fundlens-db-snapshot-$(date +%Y%m%d)

# List snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier fundlens-db

# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier fundlens-db-restored \
  --db-snapshot-identifier fundlens-db-snapshot-20251209
```

### Export to S3

```bash
# Export snapshot to S3
aws rds start-export-task \
  --export-task-identifier fundlens-export-$(date +%Y%m%d) \
  --source-arn arn:aws:rds:us-east-1:ACCOUNT_ID:snapshot:fundlens-db-snapshot \
  --s3-bucket-name fundlens-db-backups \
  --iam-role-arn arn:aws:iam::ACCOUNT_ID:role/rds-s3-export-role \
  --kms-key-id arn:aws:kms:us-east-1:ACCOUNT_ID:key/KEY_ID
```

---

## Migration Checklist

### Pre-Migration

- [ ] Create RDS instance
- [ ] Configure security groups
- [ ] Test connection from local machine
- [ ] Create backup of local database
- [ ] Document current database size
- [ ] Plan migration window (if needed)

### Migration

- [ ] Run schema migration (Prisma)
- [ ] Run custom migrations (multi-tenant schema)
- [ ] Migrate data (pg_dump or incremental)
- [ ] Verify row counts match
- [ ] Test application with RDS
- [ ] Run integration tests

### Post-Migration

- [ ] Update production .env
- [ ] Configure connection pooling
- [ ] Set up CloudWatch alarms
- [ ] Enable Performance Insights
- [ ] Document RDS endpoint
- [ ] Update team documentation
- [ ] Schedule regular backups
- [ ] Test disaster recovery

---

## Quick Start Script

Create `scripts/setup-rds.sh`:

```bash
#!/bin/bash

echo "🚀 FundLens RDS Setup"
echo ""

# Check if RDS instance exists
if aws rds describe-db-instances --db-instance-identifier fundlens-db 2>/dev/null; then
  echo "✅ RDS instance already exists"
  
  # Get endpoint
  ENDPOINT=$(aws rds describe-db-instances \
    --db-instance-identifier fundlens-db \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text)
  
  echo "📍 Endpoint: $ENDPOINT"
  echo ""
  echo "Add to .env:"
  echo "RDS_DATABASE_URL=\"postgresql://fundlens_admin:PASSWORD@$ENDPOINT:5432/fundlens_db?sslmode=require\""
else
  echo "❌ RDS instance not found"
  echo ""
  echo "Create it with:"
  echo "1. Go to: https://console.aws.amazon.com/rds/"
  echo "2. Click 'Create database'"
  echo "3. Follow the guide in AWS_RDS_SETUP_GUIDE.md"
fi
```

---

## Summary

### Development (Current)
- Local PostgreSQL
- Fast development
- No cost
- Easy testing

### Production (RDS)
- Managed PostgreSQL
- High availability
- Automated backups
- Scalable
- ~$60-250/month

### Migration Path
1. Create RDS instance (~15 min)
2. Configure security (~5 min)
3. Migrate schema (~2 min)
4. Migrate data (~10-60 min depending on size)
5. Update application (~5 min)
6. Test and verify (~30 min)

**Total time**: 1-2 hours

**Ready to proceed with RDS setup?**
