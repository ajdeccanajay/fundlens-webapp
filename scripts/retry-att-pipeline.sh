#!/bin/bash

# Retry AT&T Pipeline Script
# This script retries the AT&T (ticker "T") SEC filing pipeline after fixing S3 permissions

set -e

ADMIN_KEY="c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"
API_URL="https://app.fundlens.ai"

echo "🔄 Retrying AT&T (T) SEC Filing Pipeline..."
echo "API: $API_URL"
echo ""

# Trigger the pipeline for AT&T
echo "📡 Sending request to pipeline endpoint..."
RESPONSE=$(curl -s -X POST \
  "$API_URL/api/comprehensive-sec-pipeline/execute-company/T" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: $ADMIN_KEY" \
  -d '{
    "years": [2023, 2022, 2021],
    "filingTypes": ["10-K", "10-Q"],
    "skipExisting": false,
    "syncToKnowledgeBase": false
  }')

echo "Response:"
echo "$RESPONSE" | jq '.'

echo ""
echo "✅ Pipeline request submitted!"
echo ""
echo "To monitor progress, check CloudWatch logs:"
echo "aws logs tail /ecs/fundlens-production/backend --follow --region us-east-1 | grep -i 'AT&T\\|ticker.*T\\|comprehensive'"
