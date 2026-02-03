#!/bin/bash
# =============================================================================
# FundLens - Build and Push Docker Images to ECR
# =============================================================================

set -euo pipefail

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ENVIRONMENT="${ENVIRONMENT:-production}"

# ECR Repository URIs
BACKEND_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/fundlens-backend"
PYTHON_PARSER_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/fundlens-python-parser"

# Generate image tag (git SHA + timestamp)
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
TIMESTAMP=$(date +%Y%m%d%H%M%S)
IMAGE_TAG="prod-${GIT_SHA}-${TIMESTAMP}"

echo "=============================================="
echo "FundLens Docker Build & Push"
echo "=============================================="
echo "Environment: ${ENVIRONMENT}"
echo "AWS Region: ${AWS_REGION}"
echo "AWS Account: ${AWS_ACCOUNT_ID}"
echo "Image Tag: ${IMAGE_TAG}"
echo "=============================================="

# Login to ECR
echo ""
echo "🔐 Logging into ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build Backend Image
echo ""
echo "🔨 Building NestJS backend image..."
docker build \
    --platform linux/amd64 \
    --target production \
    -t fundlens-backend:${IMAGE_TAG} \
    -t fundlens-backend:latest \
    -f Dockerfile \
    .

# Build Python Parser Image
echo ""
echo "🔨 Building Python parser image..."
docker build \
    --platform linux/amd64 \
    --target production \
    -t fundlens-python-parser:${IMAGE_TAG} \
    -t fundlens-python-parser:latest \
    -f python_parser/Dockerfile \
    python_parser/

# Tag images for ECR
echo ""
echo "🏷️  Tagging images for ECR..."
docker tag fundlens-backend:${IMAGE_TAG} ${BACKEND_REPO}:${IMAGE_TAG}
docker tag fundlens-backend:latest ${BACKEND_REPO}:latest
docker tag fundlens-python-parser:${IMAGE_TAG} ${PYTHON_PARSER_REPO}:${IMAGE_TAG}
docker tag fundlens-python-parser:latest ${PYTHON_PARSER_REPO}:latest

# Push Backend Image
echo ""
echo "📤 Pushing backend image to ECR..."
docker push ${BACKEND_REPO}:${IMAGE_TAG}
docker push ${BACKEND_REPO}:latest

# Push Python Parser Image
echo ""
echo "📤 Pushing Python parser image to ECR..."
docker push ${PYTHON_PARSER_REPO}:${IMAGE_TAG}
docker push ${PYTHON_PARSER_REPO}:latest

echo ""
echo "=============================================="
echo "✅ Build and push complete!"
echo "=============================================="
echo "Backend Image: ${BACKEND_REPO}:${IMAGE_TAG}"
echo "Python Parser Image: ${PYTHON_PARSER_REPO}:${IMAGE_TAG}"
echo ""
echo "To deploy, run:"
echo "  IMAGE_TAG=${IMAGE_TAG} ./scripts/deploy/deploy-backend.sh"
echo "=============================================="

# Export for use in other scripts
export IMAGE_TAG
export BACKEND_IMAGE="${BACKEND_REPO}:${IMAGE_TAG}"
export PYTHON_PARSER_IMAGE="${PYTHON_PARSER_REPO}:${IMAGE_TAG}"
