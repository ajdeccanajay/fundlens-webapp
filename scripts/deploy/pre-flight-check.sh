#!/bin/bash
# =============================================================================
# FundLens - Pre-Flight Deployment Check
# Validates that all changes are in place before deployment
# =============================================================================

set -euo pipefail

echo "=============================================="
echo "FundLens Pre-Flight Deployment Check"
echo "=============================================="
echo ""

ERRORS=0

# Check 1: Python Calculator Changes
echo "✓ Checking Python calculator changes..."
if grep -q "operating_expenses" python_parser/comprehensive_financial_calculator.py; then
    echo "  ✅ Python calculator has operating_expenses fallback"
else
    echo "  ❌ Python calculator missing operating_expenses fallback"
    ERRORS=$((ERRORS + 1))
fi

# Check 2: Frontend YoY Growth Fix (comprehensive-financial-analysis.html)
echo "✓ Checking comprehensive-financial-analysis.html..."
if grep -q "g.period.endsWith(period)" public/comprehensive-financial-analysis.html; then
    echo "  ✅ comprehensive-financial-analysis.html has YoY growth fix"
else
    echo "  ❌ comprehensive-financial-analysis.html missing YoY growth fix"
    ERRORS=$((ERRORS + 1))
fi

# Check 3: Frontend YoY Growth Fix (workspace.html)
echo "✓ Checking workspace.html..."
if grep -q "g.period.endsWith(period)" public/app/deals/workspace.html; then
    echo "  ✅ workspace.html has YoY growth fix"
else
    echo "  ❌ workspace.html missing YoY growth fix"
    ERRORS=$((ERRORS + 1))
fi

# Check 4: AWS CLI Available
echo "✓ Checking AWS CLI..."
if command -v aws &> /dev/null; then
    AWS_VERSION=$(aws --version 2>&1 | cut -d' ' -f1)
    echo "  ✅ AWS CLI available: $AWS_VERSION"
else
    echo "  ❌ AWS CLI not found"
    ERRORS=$((ERRORS + 1))
fi

# Check 5: Docker Available
echo "✓ Checking Docker..."
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | tr -d ',')
    echo "  ✅ Docker available: $DOCKER_VERSION"
else
    echo "  ❌ Docker not found"
    ERRORS=$((ERRORS + 1))
fi

# Check 6: AWS Credentials
echo "✓ Checking AWS credentials..."
if aws sts get-caller-identity &> /dev/null; then
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    echo "  ✅ AWS credentials valid (Account: $AWS_ACCOUNT)"
else
    echo "  ❌ AWS credentials not configured or invalid"
    ERRORS=$((ERRORS + 1))
fi

# Check 7: ECR Access
echo "✓ Checking ECR access..."
if aws ecr describe-repositories --repository-names fundlens-backend &> /dev/null; then
    echo "  ✅ ECR repository 'fundlens-backend' accessible"
else
    echo "  ❌ Cannot access ECR repository 'fundlens-backend'"
    ERRORS=$((ERRORS + 1))
fi

# Check 8: ECS Cluster
echo "✓ Checking ECS cluster..."
if aws ecs describe-clusters --clusters fundlens-production --query 'clusters[0].status' --output text 2>/dev/null | grep -q "ACTIVE"; then
    echo "  ✅ ECS cluster 'fundlens-production' is ACTIVE"
else
    echo "  ❌ ECS cluster 'fundlens-production' not found or not active"
    ERRORS=$((ERRORS + 1))
fi

# Check 9: Deployment Scripts Executable
echo "✓ Checking deployment scripts..."
if [ -x "scripts/deploy/build-and-push.sh" ]; then
    echo "  ✅ build-and-push.sh is executable"
else
    echo "  ❌ build-and-push.sh is not executable"
    ERRORS=$((ERRORS + 1))
fi

if [ -x "scripts/deploy/deploy-backend.sh" ]; then
    echo "  ✅ deploy-backend.sh is executable"
else
    echo "  ❌ deploy-backend.sh is not executable"
    ERRORS=$((ERRORS + 1))
fi

# Summary
echo ""
echo "=============================================="
if [ $ERRORS -eq 0 ]; then
    echo "✅ PRE-FLIGHT CHECK PASSED"
    echo "=============================================="
    echo ""
    echo "All checks passed! Ready to deploy."
    echo ""
    echo "Next steps:"
    echo "  1. ./scripts/deploy/build-and-push.sh"
    echo "  2. IMAGE_TAG=<from-output> ./scripts/deploy/deploy-backend.sh"
    echo ""
    exit 0
else
    echo "❌ PRE-FLIGHT CHECK FAILED"
    echo "=============================================="
    echo ""
    echo "Found $ERRORS error(s). Please fix before deploying."
    echo ""
    exit 1
fi
