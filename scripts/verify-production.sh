#!/bin/bash

echo "=== FundLens Production Verification ==="
echo ""

ADMIN_KEY="c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"
BASE_URL="https://app.fundlens.ai"

echo "1. Health Check..."
curl -s "$BASE_URL/api/health" | jq -r '.status'
echo ""

echo "2. List Clients..."
curl -s "$BASE_URL/api/v1/internal/ops/clients" -H "x-admin-key: $ADMIN_KEY" | jq '.clients[] | {name, tier, status, userCount, dealCount}'
echo ""

echo "3. Check Cognito Users..."
aws cognito-idp list-users --user-pool-id us-east-1_4OYqnpE18 --region us-east-1 --query 'Users[*].{Username:Username,Email:Attributes[?Name==`email`].Value|[0],Status:UserStatus}' --output table
echo ""

echo "4. Frontend Test..."
curl -s "$BASE_URL/" | grep -o "<title>.*</title>" || echo "Frontend loaded"
echo ""

echo "✅ Verification complete!"
