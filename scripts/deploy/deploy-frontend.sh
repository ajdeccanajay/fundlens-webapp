#!/bin/bash
# =============================================================================
# FundLens - Deploy Frontend to S3 and CloudFront
# =============================================================================

set -euo pipefail

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-production}"
S3_BUCKET="fundlens-${ENVIRONMENT}-frontend"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"
PUBLIC_DIR="${PUBLIC_DIR:-./public}"

echo "=============================================="
echo "FundLens Frontend Deployment"
echo "=============================================="
echo "Environment: ${ENVIRONMENT}"
echo "S3 Bucket: ${S3_BUCKET}"
echo "Source Directory: ${PUBLIC_DIR}"
echo "=============================================="

# Verify public directory exists
if [ ! -d "${PUBLIC_DIR}" ]; then
    echo "❌ Error: Public directory '${PUBLIC_DIR}' not found!"
    exit 1
fi

# Get CloudFront distribution ID if not provided
if [ -z "${CLOUDFRONT_DISTRIBUTION_ID}" ]; then
    echo ""
    echo "🔍 Looking up CloudFront distribution ID..."
    CLOUDFRONT_DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
        --stack-name fundlens-frontend-${ENVIRONMENT} \
        --region ${AWS_REGION} \
        --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "${CLOUDFRONT_DISTRIBUTION_ID}" ]; then
        echo "⚠️  Warning: Could not find CloudFront distribution ID. Skipping invalidation."
    else
        echo "Found distribution: ${CLOUDFRONT_DISTRIBUTION_ID}"
    fi
fi

# Sync static assets with long cache (JS, CSS, images, fonts)
echo ""
echo "📤 Syncing static assets (with 1-year cache)..."
aws s3 sync ${PUBLIC_DIR} s3://${S3_BUCKET} \
    --region ${AWS_REGION} \
    --exclude "*.html" \
    --exclude "*.json" \
    --cache-control "public, max-age=31536000, immutable" \
    --delete

# Sync HTML files with short cache
echo ""
echo "📤 Syncing HTML files (with 1-hour cache)..."
aws s3 sync ${PUBLIC_DIR} s3://${S3_BUCKET} \
    --region ${AWS_REGION} \
    --exclude "*" \
    --include "*.html" \
    --cache-control "public, max-age=3600, must-revalidate" \
    --content-type "text/html; charset=utf-8"

# Sync JSON files (config, manifests) with short cache
echo ""
echo "📤 Syncing JSON files (with 1-hour cache)..."
aws s3 sync ${PUBLIC_DIR} s3://${S3_BUCKET} \
    --region ${AWS_REGION} \
    --exclude "*" \
    --include "*.json" \
    --cache-control "public, max-age=3600, must-revalidate" \
    --content-type "application/json"

# Create CloudFront invalidation
if [ -n "${CLOUDFRONT_DISTRIBUTION_ID}" ]; then
    echo ""
    echo "🔄 Creating CloudFront cache invalidation..."
    INVALIDATION_ID=$(aws cloudfront create-invalidation \
        --distribution-id ${CLOUDFRONT_DISTRIBUTION_ID} \
        --paths "/*" \
        --query 'Invalidation.Id' \
        --output text)
    
    echo "Invalidation ID: ${INVALIDATION_ID}"
    
    # Wait for invalidation to complete (optional, can be slow)
    echo ""
    echo "⏳ Waiting for invalidation to complete..."
    aws cloudfront wait invalidation-completed \
        --distribution-id ${CLOUDFRONT_DISTRIBUTION_ID} \
        --id ${INVALIDATION_ID}
    
    echo "✅ Invalidation complete!"
fi

echo ""
echo "=============================================="
echo "✅ Frontend deployment complete!"
echo "=============================================="
echo "S3 Bucket: s3://${S3_BUCKET}"
if [ -n "${CLOUDFRONT_DISTRIBUTION_ID}" ]; then
    echo "CloudFront Distribution: ${CLOUDFRONT_DISTRIBUTION_ID}"
    echo "Website URL: https://app.fundlens.ai"
fi
echo "=============================================="
