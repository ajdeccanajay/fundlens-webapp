#!/bin/bash
# =============================================================================
# FundLens - Deploy AWS Infrastructure (CloudFormation Stacks)
# =============================================================================

set -euo pipefail

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-production}"
HOSTED_ZONE_ID="${HOSTED_ZONE_ID:-}"  # Must be provided
ALERT_EMAIL="${ALERT_EMAIL:-ops@fundlens.ai}"

# Database credentials (for Secrets Manager)
DB_PASSWORD="${DB_PASSWORD:-}"  # Must be provided
COGNITO_CLIENT_SECRET="${COGNITO_CLIENT_SECRET:-}"  # Must be provided
PLATFORM_ADMIN_KEY="${PLATFORM_ADMIN_KEY:-}"  # Must be provided

# Stack names
VPC_STACK="fundlens-vpc-${ENVIRONMENT}"
SG_STACK="fundlens-sg-${ENVIRONMENT}"
ECR_STACK="fundlens-ecr-${ENVIRONMENT}"
SECRETS_STACK="fundlens-secrets-${ENVIRONMENT}"
ECS_STACK="fundlens-ecs-${ENVIRONMENT}"
ALB_STACK="fundlens-alb-${ENVIRONMENT}"
SERVICE_STACK="fundlens-service-${ENVIRONMENT}"
FRONTEND_STACK="fundlens-frontend-${ENVIRONMENT}"
MONITORING_STACK="fundlens-monitoring-${ENVIRONMENT}"

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../infrastructure/cloudformation" && pwd)"

echo "=============================================="
echo "FundLens Infrastructure Deployment"
echo "=============================================="
echo "Environment: ${ENVIRONMENT}"
echo "AWS Region: ${AWS_REGION}"
echo "Infrastructure Dir: ${INFRA_DIR}"
echo "=============================================="

# Validate required parameters
if [ -z "${HOSTED_ZONE_ID}" ]; then
    echo "❌ Error: HOSTED_ZONE_ID is required"
    echo "   Set it with: export HOSTED_ZONE_ID=your-hosted-zone-id"
    exit 1
fi

if [ -z "${DB_PASSWORD}" ]; then
    echo "❌ Error: DB_PASSWORD is required for Secrets Manager"
    exit 1
fi

# Function to deploy a stack
deploy_stack() {
    local stack_name=$1
    local template_file=$2
    shift 2
    local parameters=("$@")
    
    echo ""
    echo "📦 Deploying ${stack_name}..."
    
    # Check if stack exists
    if aws cloudformation describe-stacks --stack-name ${stack_name} --region ${AWS_REGION} &>/dev/null; then
        echo "   Stack exists, updating..."
        aws cloudformation update-stack \
            --stack-name ${stack_name} \
            --template-body file://${template_file} \
            --parameters "${parameters[@]}" \
            --capabilities CAPABILITY_NAMED_IAM \
            --region ${AWS_REGION} 2>/dev/null || echo "   No updates needed"
    else
        echo "   Creating new stack..."
        aws cloudformation create-stack \
            --stack-name ${stack_name} \
            --template-body file://${template_file} \
            --parameters "${parameters[@]}" \
            --capabilities CAPABILITY_NAMED_IAM \
            --region ${AWS_REGION}
    fi
    
    echo "   Waiting for stack to complete..."
    aws cloudformation wait stack-create-complete --stack-name ${stack_name} --region ${AWS_REGION} 2>/dev/null || \
    aws cloudformation wait stack-update-complete --stack-name ${stack_name} --region ${AWS_REGION} 2>/dev/null || true
    
    echo "   ✅ ${stack_name} deployed"
}

# Step 1: VPC and Networking
echo ""
echo "🌐 Step 1: Deploying VPC and Networking..."
deploy_stack ${VPC_STACK} ${INFRA_DIR}/vpc-networking.yaml \
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}"

# Step 2: Security Groups
echo ""
echo "🔒 Step 2: Deploying Security Groups..."
deploy_stack ${SG_STACK} ${INFRA_DIR}/security-groups.yaml \
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}" \
    "ParameterKey=VpcStackName,ParameterValue=${VPC_STACK}"

# Step 3: ECR Repositories
echo ""
echo "📦 Step 3: Deploying ECR Repositories..."
deploy_stack ${ECR_STACK} ${INFRA_DIR}/ecr-repositories.yaml \
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}"

# Step 4: Secrets Manager
echo ""
echo "🔐 Step 4: Deploying Secrets..."
deploy_stack ${SECRETS_STACK} ${INFRA_DIR}/secrets.yaml \
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}" \
    "ParameterKey=DatabasePassword,ParameterValue=${DB_PASSWORD}" \
    "ParameterKey=CognitoClientSecret,ParameterValue=${COGNITO_CLIENT_SECRET}" \
    "ParameterKey=PlatformAdminKey,ParameterValue=${PLATFORM_ADMIN_KEY}"

# Get secret ARNs
DB_SECRET_ARN=$(aws cloudformation describe-stacks --stack-name ${SECRETS_STACK} --region ${AWS_REGION} \
    --query 'Stacks[0].Outputs[?OutputKey==`DatabaseSecretArn`].OutputValue' --output text)
COGNITO_SECRET_ARN=$(aws cloudformation describe-stacks --stack-name ${SECRETS_STACK} --region ${AWS_REGION} \
    --query 'Stacks[0].Outputs[?OutputKey==`CognitoSecretArn`].OutputValue' --output text)
PLATFORM_SECRET_ARN=$(aws cloudformation describe-stacks --stack-name ${SECRETS_STACK} --region ${AWS_REGION} \
    --query 'Stacks[0].Outputs[?OutputKey==`PlatformSecretArn`].OutputValue' --output text)

# Step 5: ECS Cluster and Task Definition
echo ""
echo "🐳 Step 5: Deploying ECS Cluster..."
deploy_stack ${ECS_STACK} ${INFRA_DIR}/ecs-cluster.yaml \
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}" \
    "ParameterKey=VpcStackName,ParameterValue=${VPC_STACK}" \
    "ParameterKey=SecurityGroupsStackName,ParameterValue=${SG_STACK}" \
    "ParameterKey=ECRStackName,ParameterValue=${ECR_STACK}" \
    "ParameterKey=DatabaseSecretArn,ParameterValue=${DB_SECRET_ARN}" \
    "ParameterKey=CognitoSecretArn,ParameterValue=${COGNITO_SECRET_ARN}" \
    "ParameterKey=PlatformSecretArn,ParameterValue=${PLATFORM_SECRET_ARN}"

# Step 6: Frontend Hosting (includes ACM certificate)
echo ""
echo "🌐 Step 6: Deploying Frontend Hosting (S3, CloudFront, ACM)..."
deploy_stack ${FRONTEND_STACK} ${INFRA_DIR}/frontend-hosting.yaml \
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}" \
    "ParameterKey=HostedZoneId,ParameterValue=${HOSTED_ZONE_ID}" \
    "ParameterKey=ALBStackName,ParameterValue=${ALB_STACK}"

# Get certificate ARN (wait for validation)
echo "   Waiting for ACM certificate validation..."
CERT_ARN=$(aws cloudformation describe-stacks --stack-name ${FRONTEND_STACK} --region ${AWS_REGION} \
    --query 'Stacks[0].Outputs[?OutputKey==`CertificateArn`].OutputValue' --output text 2>/dev/null || echo "")

# Step 7: Application Load Balancer
echo ""
echo "⚖️ Step 7: Deploying Application Load Balancer..."
deploy_stack ${ALB_STACK} ${INFRA_DIR}/alb.yaml \
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}" \
    "ParameterKey=VpcStackName,ParameterValue=${VPC_STACK}" \
    "ParameterKey=SecurityGroupsStackName,ParameterValue=${SG_STACK}" \
    "ParameterKey=CertificateArn,ParameterValue=${CERT_ARN}"

# Step 8: ECS Service with Auto-Scaling
echo ""
echo "🚀 Step 8: Deploying ECS Service..."
deploy_stack ${SERVICE_STACK} ${INFRA_DIR}/ecs-service.yaml \
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}" \
    "ParameterKey=VpcStackName,ParameterValue=${VPC_STACK}" \
    "ParameterKey=SecurityGroupsStackName,ParameterValue=${SG_STACK}" \
    "ParameterKey=ECSClusterStackName,ParameterValue=${ECS_STACK}" \
    "ParameterKey=ALBStackName,ParameterValue=${ALB_STACK}"

# Step 9: Monitoring and Alerting
echo ""
echo "📊 Step 9: Deploying Monitoring..."
deploy_stack ${MONITORING_STACK} ${INFRA_DIR}/monitoring.yaml \
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}" \
    "ParameterKey=ECSClusterStackName,ParameterValue=${ECS_STACK}" \
    "ParameterKey=ECSServiceStackName,ParameterValue=${SERVICE_STACK}" \
    "ParameterKey=ALBStackName,ParameterValue=${ALB_STACK}" \
    "ParameterKey=AlertEmail,ParameterValue=${ALERT_EMAIL}"

echo ""
echo "=============================================="
echo "✅ Infrastructure Deployment Complete!"
echo "=============================================="
echo ""
echo "Next steps:"
echo "1. Build and push Docker images:"
echo "   ./scripts/deploy/build-and-push.sh"
echo ""
echo "2. Deploy backend:"
echo "   ./scripts/deploy/deploy-backend.sh"
echo ""
echo "3. Deploy frontend:"
echo "   ./scripts/deploy/deploy-frontend.sh"
echo ""
echo "Or run full deployment:"
echo "   ./scripts/deploy/deploy-all.sh"
echo "=============================================="
