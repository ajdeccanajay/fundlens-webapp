#!/bin/bash

echo "🚀 Creating PostgreSQL RDS Instance"

aws rds create-db-instance \
  --db-instance-identifier "fundlens-db" \
  --db-instance-class "db.t3.small" \
  --engine "postgres" \
  --engine-version "15.15" \
  --master-username "fundlens_admin" \
  --master-user-password "FundLens2025SecureDB" \
  --allocated-storage 20 \
  --storage-type "gp3" \
  --db-name "fundlens_db" \
  --publicly-accessible \
  --backup-retention-period 7 \
  --region "us-east-1"

echo "✅ RDS creation initiated. This takes 10-15 minutes."