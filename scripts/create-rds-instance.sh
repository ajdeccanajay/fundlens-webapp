#!/bin/bash

echo "🚀 Creating AWS RDS PostgreSQL Instance for FundLens"
echo ""

# Configuration
DB_INSTANCE_ID="fundlens-db"
DB_NAME="fundlens_db"
DB_USERNAME="fundlens_admin"
DB_PASSWORD="FundLens2025!SecureDB"  # Strong password
DB_CLASS="db.t3.medium"  # 2 vCPU, 4 GB RAM - good for development/testing
ALLOCATED_STORAGE=100
ENGINE_VERSION="15.4"
REGION="us-east-1"

echo "📋 Configuration:"
echo "  Instance ID: $DB_INSTANCE_ID"
echo "  Database: $DB_NAME"
echo "  Username: $DB_USERNAME"
echo "  Instance Class: $DB_CLASS"
echo "  Storage: ${ALLOCATED_STORAGE}GB"
echo "  Engine: PostgreSQL $ENGINE_VERSION"
echo ""

# Check if instance already exists
if aws rds describe-db-instances --db-instance-identifier $DB_INSTANCE_ID --region $REGION 2>/dev/null >/dev/null; then
    echo "✅ RDS instance '$DB_INSTANCE_ID' already exists"
    
    # Get current status
    STATUS=$(aws rds describe-db-instances \
        --db-instance-identifier $DB_INSTANCE_ID \
        --region $REGION \
        --query 'DBInstances[0].DBInstanceStatus' \
        --output text)
    
    echo "📊 Current status: $STATUS"
    
    if [ "$STATUS" = "available" ]; then
        ENDPOINT=$(aws rds describe-db-instances \
            --db-instance-identifier $DB_INSTANCE_ID \
            --region $REGION \
            --query 'DBInstances[0].Endpoint.Address' \
            --output text)
        
        echo "📍 Endpoint: $ENDPOINT"
        echo ""
        echo "🔗 Connection string:"
        echo "postgresql://$DB_USERNAME:$DB_PASSWORD@$ENDPOINT:5432/$DB_NAME?sslmode=require"
    else
        echo "⏳ Instance is still being created. Status: $STATUS"
        echo "   This usually takes 10-15 minutes..."
    fi
    
    exit 0
fi

echo "🏗️  Creating RDS instance..."

# Create the RDS instance
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
    --preferred-maintenance-window "sun:04:00-sun:05:00" \
    --db-name $DB_NAME \
    --publicly-accessible \
    --enable-cloudwatch-logs-exports '["postgresql"]' \
    --deletion-protection \
    --region $REGION \
    --tags Key=Project,Value=FundLens Key=Environment,Value=Development Key=Owner,Value=ajay.swamy@fundlens.ai

if [ $? -eq 0 ]; then
    echo "✅ RDS instance creation initiated successfully!"
    echo ""
    echo "⏳ The instance is being created. This will take 10-15 minutes..."
    echo ""
    echo "📋 Next steps:"
    echo "1. Wait for instance to become available"
    echo "2. Configure security group"
    echo "3. Test connection"
    echo "4. Run migration"
    echo ""
    echo "🔍 Check status with:"
    echo "aws rds describe-db-instances --db-instance-identifier $DB_INSTANCE_ID --region $REGION"
    echo ""
    echo "🔔 You'll receive an email notification when it's ready"
else
    echo "❌ Failed to create RDS instance"
    echo "Check your AWS credentials and permissions"
    exit 1
fi