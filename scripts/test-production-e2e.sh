#!/bin/bash

echo "=========================================="
echo "  FundLens Production E2E Tests"
echo "=========================================="
echo ""

BASE_URL="https://app.fundlens.ai"
ADMIN_KEY="c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

test_endpoint() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"
    local headers="$4"
    
    echo -n "Testing: $name... "
    
    if [ -n "$headers" ]; then
        response=$(curl -s -w "\n%{http_code}" -H "$headers" "$url")
    else
        response=$(curl -s -w "\n%{http_code}" "$url")
    fi
    
    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$status" = "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $status)"
        ((pass_count++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $status, expected $expected_status)"
        echo "Response: $body" | head -3
        ((fail_count++))
        return 1
    fi
}

echo "1️⃣  Testing Core Endpoints"
echo "----------------------------"
test_endpoint "Health Check" "$BASE_URL/api/health"
test_endpoint "Frontend Homepage" "$BASE_URL/"
test_endpoint "Login Page" "$BASE_URL/login.html"
test_endpoint "Deal Dashboard" "$BASE_URL/app/deals/index.html"
test_endpoint "RAG Query Interface" "$BASE_URL/rag-query.html"
echo ""

echo "2️⃣  Testing Admin API"
echo "----------------------------"
test_endpoint "List Clients" "$BASE_URL/api/v1/internal/ops/clients" 200 "x-admin-key: $ADMIN_KEY"
test_endpoint "Admin Auth (no key)" "$BASE_URL/api/v1/internal/ops/clients" 401
echo ""

echo "3️⃣  Testing API Endpoints"
echo "----------------------------"
test_endpoint "API Docs" "$BASE_URL/docs"
echo ""

echo "4️⃣  Testing Static Assets"
echo "----------------------------"
test_endpoint "JavaScript File" "$BASE_URL/fundlens-main.html"
echo ""

echo "5️⃣  Testing Data Availability"
echo "----------------------------"
echo -n "Checking deals via Admin API... "
deals_response=$(curl -s "$BASE_URL/api/v1/internal/ops/clients" -H "x-admin-key: $ADMIN_KEY")
deal_count=$(echo "$deals_response" | grep -o '"dealCount":[0-9]*' | grep -o '[0-9]*')

if [ "$deal_count" -gt 0 ]; then
    echo -e "${GREEN}✓ PASS${NC} ($deal_count deals found)"
    ((pass_count++))
else
    echo -e "${YELLOW}⚠ WARNING${NC} (0 deals found)"
fi
echo ""

echo "=========================================="
echo "  Test Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$pass_count${NC}"
echo -e "Failed: ${RED}$fail_count${NC}"
echo ""

if [ $fail_count -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
