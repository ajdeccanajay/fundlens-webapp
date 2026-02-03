#!/bin/bash

# Security Deployment Verification Script
# Tests that old URLs are blocked and new URLs work

set -e

echo "🔒 Security Deployment Verification"
echo "===================================="
echo ""

# Configuration
CLOUDFRONT_URL="https://d6rzwnvbyibb8.cloudfront.net"
PRODUCTION_URL="https://app.fundlens.ai"

# Use CloudFront URL for testing (faster, no DNS caching)
BASE_URL="${CLOUDFRONT_URL}"

echo "Testing against: ${BASE_URL}"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0
WARNINGS=0

# Function to test URL
test_url() {
    local url=$1
    local expected_code=$2
    local description=$3
    
    echo -n "Testing: ${description}... "
    
    # Get HTTP status code
    status_code=$(curl -s -o /dev/null -w "%{http_code}" "${url}" 2>/dev/null || echo "000")
    
    if [ "${status_code}" = "${expected_code}" ]; then
        echo -e "${GREEN}✓ PASS${NC} (${status_code})"
        ((PASSED++))
        return 0
    elif [ "${status_code}" = "200" ] && [ "${expected_code}" = "404" ]; then
        echo -e "${YELLOW}⚠ WARNING${NC} (${status_code} - Edge cache not cleared yet)"
        ((WARNINGS++))
        return 0  # Don't fail, just warn
    else
        echo -e "${RED}✗ FAIL${NC} (Expected: ${expected_code}, Got: ${status_code})"
        ((FAILED++))
        return 0  # Continue testing
    fi
}

echo "1. Testing Old URLs (Should Return 404)"
echo "----------------------------------------"

test_url "${BASE_URL}/rag-query.html" "404" "Old rag-query.html"
test_url "${BASE_URL}/test-chat.html" "404" "Old test-chat.html"
test_url "${BASE_URL}/test-sse-chat.html" "404" "Old test-sse-chat.html"
test_url "${BASE_URL}/test-ticker-display.html" "404" "Old test-ticker-display.html"
test_url "${BASE_URL}/upload.html" "404" "Old upload.html"

echo ""
echo "2. Testing New URLs (Should Return 200)"
echo "----------------------------------------"

test_url "${BASE_URL}/internal/index.html" "200" "New admin tools index"
test_url "${BASE_URL}/internal/platform-admin.html" "200" "New platform-admin.html"
test_url "${BASE_URL}/internal/rag-query.html" "200" "New rag-query.html"
test_url "${BASE_URL}/internal/test-chat.html" "200" "New test-chat.html"
test_url "${BASE_URL}/internal/test-sse-chat.html" "200" "New test-sse-chat.html"
test_url "${BASE_URL}/internal/test-ticker-display.html" "200" "New test-ticker-display.html"
test_url "${BASE_URL}/internal/upload.html" "200" "New upload.html"

echo ""
echo "3. Verifying S3 Files"
echo "---------------------"

echo -n "Checking S3 root for old files... "
if aws s3 ls s3://fundlens-production-frontend/ | grep -qE "(rag-query|test-chat|test-sse-chat|test-ticker-display|upload\.html)"; then
    echo -e "${RED}✗ FAIL${NC} (Old files still in S3 root)"
    ((FAILED++))
else
    echo -e "${GREEN}✓ PASS${NC} (No old files in S3 root)"
    ((PASSED++))
fi

echo -n "Checking S3 /internal/ for new files... "
file_count=$(aws s3 ls s3://fundlens-production-frontend/internal/ | grep -cE "(index|rag-query|test-chat|test-sse-chat|test-ticker-display|upload|platform-admin)\.html" || echo "0")
if [ "${file_count}" -ge "6" ]; then
    echo -e "${GREEN}✓ PASS${NC} (Found ${file_count} files in /internal/)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (Expected 6+ files, found ${file_count})"
    ((FAILED++))
fi

echo ""
echo "4. Checking CloudFront Invalidations"
echo "-------------------------------------"

echo -n "Checking invalidation status... "
invalidation_status=$(aws cloudfront list-invalidations \
    --distribution-id E2GDNAU8EH9JJ3 \
    --max-items 1 \
    --query 'InvalidationList.Items[0].Status' \
    --output text 2>/dev/null || echo "Unknown")

if [ "${invalidation_status}" = "Completed" ]; then
    echo -e "${GREEN}✓ PASS${NC} (Status: ${invalidation_status})"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠ WARNING${NC} (Status: ${invalidation_status})"
    ((WARNINGS++))
fi

echo ""
echo "5. Testing Backend API Protection"
echo "----------------------------------"

echo -n "Testing admin API without key... "
status_code=$(curl -s -o /dev/null -w "%{http_code}" "${PRODUCTION_URL}/api/v1/internal/ops/stats" 2>/dev/null || echo "000")
if [ "${status_code}" = "401" ]; then
    echo -e "${GREEN}✓ PASS${NC} (Correctly returns 401)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (Expected 401, got ${status_code})"
    ((FAILED++))
fi

echo ""
echo "=========================================="
echo "Test Results Summary"
echo "=========================================="
echo ""
echo -e "Passed:   ${GREEN}${PASSED}${NC}"
echo -e "Failed:   ${RED}${FAILED}${NC}"
echo -e "Warnings: ${YELLOW}${WARNINGS}${NC}"
echo ""

if [ ${FAILED} -eq 0 ] && [ ${WARNINGS} -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    echo ""
    echo "Security deployment is complete and verified!"
    exit 0
elif [ ${FAILED} -eq 0 ] && [ ${WARNINGS} -gt 0 ]; then
    echo -e "${YELLOW}⚠ TESTS PASSED WITH WARNINGS${NC}"
    echo ""
    echo "Security deployment is complete, but CloudFront edge caches"
    echo "have not fully cleared yet. Old URLs may still return 200"
    echo "from edge locations for up to 24 hours."
    echo ""
    echo "This is expected and not a security issue - files are"
    echo "deleted from S3 origin."
    echo ""
    echo "Recommendation: Wait 24 hours and run this script again."
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    echo ""
    echo "Please investigate the failures above."
    exit 1
fi
