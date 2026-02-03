#!/bin/bash
# =============================================================================
# FundLens - Deploy Backend to ECS
# =============================================================================

set -euo pipefail

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ENVIRONMENT="${ENVIRONMENT:-production}"
ECS_CLUSTER="fundlens-${ENVIRONMENT}"
ECS_SERVICE="fundlens-${ENVIRONMENT}-service"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# ECR Repository URIs
BACKEND_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/fundlens-backend"
PYTHON_PARSER_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/fundlens-python-parser"

echo "=============================================="
echo "FundLens Backend Deployment"
echo "=============================================="
echo "Environment: ${ENVIRONMENT}"
echo "ECS Cluster: ${ECS_CLUSTER}"
echo "ECS Service: ${ECS_SERVICE}"
echo "Image Tag: ${IMAGE_TAG}"
echo "=============================================="

# Get current task definition
echo ""
echo "📋 Getting current task definition..."
TASK_FAMILY="fundlens-${ENVIRONMENT}"
CURRENT_TASK_DEF=$(aws ecs describe-task-definition \
    --task-definition ${TASK_FAMILY} \
    --region ${AWS_REGION} \
    --query 'taskDefinition' \
    --output json)

# Update container images in task definition
echo ""
echo "🔄 Updating task definition with new images..."
NEW_TASK_DEF=$(echo ${CURRENT_TASK_DEF} | jq --arg BACKEND_IMAGE "${BACKEND_REPO}:${IMAGE_TAG}" --arg PARSER_IMAGE "${PYTHON_PARSER_REPO}:${IMAGE_TAG}" '
    .containerDefinitions |= map(
        if .name == "backend" then .image = $BACKEND_IMAGE
        elif .name == "python-parser" then .image = $PARSER_IMAGE
        else .
        end
    ) |
    del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)
')

# Register new task definition
echo ""
echo "📝 Registering new task definition..."
NEW_TASK_DEF_ARN=$(aws ecs register-task-definition \
    --region ${AWS_REGION} \
    --cli-input-json "${NEW_TASK_DEF}" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

echo "New task definition: ${NEW_TASK_DEF_ARN}"

# Update ECS service
echo ""
echo "🚀 Updating ECS service..."
aws ecs update-service \
    --region ${AWS_REGION} \
    --cluster ${ECS_CLUSTER} \
    --service ${ECS_SERVICE} \
    --task-definition ${NEW_TASK_DEF_ARN} \
    --force-new-deployment \
    --output text > /dev/null

# Wait for deployment to stabilize
echo ""
echo "⏳ Waiting for deployment to stabilize (this may take a few minutes)..."
aws ecs wait services-stable \
    --region ${AWS_REGION} \
    --cluster ${ECS_CLUSTER} \
    --services ${ECS_SERVICE}

# Check deployment status
echo ""
echo "📊 Checking deployment status..."
DEPLOYMENT_STATUS=$(aws ecs describe-services \
    --region ${AWS_REGION} \
    --cluster ${ECS_CLUSTER} \
    --services ${ECS_SERVICE} \
    --query 'services[0].deployments[0].rolloutState' \
    --output text)

if [ "${DEPLOYMENT_STATUS}" == "COMPLETED" ]; then
    echo ""
    echo "=============================================="
    echo "✅ Deployment successful!"
    echo "=============================================="
    echo "Task Definition: ${NEW_TASK_DEF_ARN}"
    echo "Deployment Status: ${DEPLOYMENT_STATUS}"
    echo "=============================================="
    exit 0
else
    echo ""
    echo "=============================================="
    echo "⚠️  Deployment status: ${DEPLOYMENT_STATUS}"
    echo "=============================================="
    
    # Check for rollback
    ROLLBACK_STATE=$(aws ecs describe-services \
        --region ${AWS_REGION} \
        --cluster ${ECS_CLUSTER} \
        --services ${ECS_SERVICE} \
        --query 'services[0].deployments[0].rolloutState' \
        --output text)
    
    if [ "${ROLLBACK_STATE}" == "FAILED" ]; then
        echo "❌ Deployment failed and rolled back!"
        echo "Check CloudWatch logs for details."
        exit 1
    fi
    
    exit 0
fi
