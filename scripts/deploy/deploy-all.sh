#!/bin/bash
# =============================================================================
# FundLens - Full Production Deployment
# Orchestrates build, push, and deployment of all components
# =============================================================================

set -euo pipefail

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-production}"
SKIP_BUILD="${SKIP_BUILD:-false}"
SKIP_BACKEND="${SKIP_BACKEND:-false}"
SKIP_FRONTEND="${SKIP_FRONTEND:-false}"
SKIP_SMOKE_TESTS="${SKIP_SMOKE_TESTS:-false}"

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=============================================="
echo "FundLens Full Production Deployment"
echo "=============================================="
echo "Environment: ${ENVIRONMENT}"
echo "AWS Region: ${AWS_REGION}"
echo "Skip Build: ${SKIP_BUILD}"
echo "Skip Backend: ${SKIP_BACKEND}"
echo "Skip Frontend: ${SKIP_FRONTEND}"
echo "Skip Smoke Tests: ${SKIP_SMOKE_TESTS}"
echo "=============================================="
echo ""

# Track deployment start time
START_TIME=$(date +%s)

# Step 1: Build and Push Docker Images
if [ "${SKIP_BUILD}" != "true" ] && [ "${SKIP_BACKEND}" != "true" ]; then
    echo "📦 Step 1: Building and pushing Docker images..."
    echo "----------------------------------------------"
    source ${SCRIPT_DIR}/build-and-push.sh
    echo ""
else
    echo "⏭️  Skipping build step"
    IMAGE_TAG="${IMAGE_TAG:-latest}"
fi

# Step 2: Deploy Backend to ECS
if [ "${SKIP_BACKEND}" != "true" ]; then
    echo "🚀 Step 2: Deploying backend to ECS..."
    echo "----------------------------------------------"
    export IMAGE_TAG
    ${SCRIPT_DIR}/deploy-backend.sh
    echo ""
else
    echo "⏭️  Skipping backend deployment"
fi

# Step 3: Deploy Frontend to S3/CloudFront
if [ "${SKIP_FRONTEND}" != "true" ]; then
    echo "🌐 Step 3: Deploying frontend to S3/CloudFront..."
    echo "----------------------------------------------"
    ${SCRIPT_DIR}/deploy-frontend.sh
    echo ""
else
    echo "⏭️  Skipping frontend deployment"
fi

# Step 4: Run Smoke Tests
if [ "${SKIP_SMOKE_TESTS}" != "true" ]; then
    echo "🧪 Step 4: Running smoke tests..."
    echo "----------------------------------------------"
    
    DOMAIN="app.fundlens.ai"
    SMOKE_TEST_PASSED=true
    
    # Test 1: Homepage loads
    echo "  Testing homepage..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" --max-time 30 || echo "000")
    if [ "${HTTP_CODE}" == "200" ]; then
        echo "  ✅ Homepage: OK (${HTTP_CODE})"
    else
        echo "  ❌ Homepage: FAILED (${HTTP_CODE})"
        SMOKE_TEST_PASSED=false
    fi
    
    # Test 2: API Health endpoint
    echo "  Testing API health endpoint..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/api/health" --max-time 30 || echo "000")
    if [ "${HTTP_CODE}" == "200" ]; then
        echo "  ✅ API Health: OK (${HTTP_CODE})"
    else
        echo "  ❌ API Health: FAILED (${HTTP_CODE})"
        SMOKE_TEST_PASSED=false
    fi
    
    # Test 3: Swagger docs
    echo "  Testing Swagger docs..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/docs" --max-time 30 || echo "000")
    if [ "${HTTP_CODE}" == "200" ] || [ "${HTTP_CODE}" == "301" ] || [ "${HTTP_CODE}" == "302" ]; then
        echo "  ✅ Swagger Docs: OK (${HTTP_CODE})"
    else
        echo "  ❌ Swagger Docs: FAILED (${HTTP_CODE})"
        SMOKE_TEST_PASSED=false
    fi
    
    # Test 4: Login page
    echo "  Testing login page..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/login.html" --max-time 30 || echo "000")
    if [ "${HTTP_CODE}" == "200" ]; then
        echo "  ✅ Login Page: OK (${HTTP_CODE})"
    else
        echo "  ❌ Login Page: FAILED (${HTTP_CODE})"
        SMOKE_TEST_PASSED=false
    fi
    
    echo ""
    
    if [ "${SMOKE_TEST_PASSED}" != "true" ]; then
        echo "⚠️  Some smoke tests failed. Please investigate."
    fi
else
    echo "⏭️  Skipping smoke tests"
fi

# Calculate deployment duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo "=============================================="
echo "✅ Deployment Complete!"
echo "=============================================="
echo "Duration: ${MINUTES}m ${SECONDS}s"
echo "Environment: ${ENVIRONMENT}"
echo "Image Tag: ${IMAGE_TAG:-latest}"
echo ""
echo "URLs:"
echo "  Website: https://app.fundlens.ai"
echo "  API Health: https://app.fundlens.ai/api/health"
echo "  Swagger Docs: https://app.fundlens.ai/docs"
echo "=============================================="
