#!/bin/bash

# Post-Deployment Smoke Tests
# Production Deployment - February 2026 v2.0.0
#
# Run these tests after deployment to verify everything is working

set -e

echo "=========================================="
echo "POST-DEPLOYMENT SMOKE TESTS"
echo "Production Feb 2026 v2.0.0"
echo "=========================================="
echo ""

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
ADMIN_KEY="${PLATFORM_ADMIN_KEY:-c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Test counter
PASSED=0
FAILED=0

# Helper function to run test
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    echo -e "${YELLOW}Testing: ${test_name}${NC}"
    
    if eval "$test_command"; then
        echo -e "${GREEN}✅ PASSED${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAILED${NC}"
        ((FAILED++))
    fi
    echo ""
}

# Test 1: Health Check
run_test "Health Check" \
    "curl -s -f ${API_URL}/health > /dev/null"

# Test 2: RAG Subsection Retrieval
run_test "RAG Subsection Retrieval (NVDA competitors)" \
    "curl -s -X POST ${API_URL}/api/rag/query \
        -H 'Content-Type: application/json' \
        -d '{\"query\": \"Who are NVDA competitors?\", \"ticker\": \"NVDA\"}' \
        | grep -q 'competitors'"

# Test 3: Intent Analytics Dashboard
run_test "Intent Analytics - Realtime Metrics" \
    "curl -s -f ${API_URL}/api/admin/intent-analytics/realtime?tenantId=test-tenant \
        -H 'x-admin-key: ${ADMIN_KEY}' > /dev/null"

# Test 4: Intent Analytics - Failed Patterns
run_test "Intent Analytics - Failed Patterns" \
    "curl -s -f ${API_URL}/api/admin/intent-analytics/failed-patterns?tenantId=test-tenant \
        -H 'x-admin-key: ${ADMIN_KEY}' > /dev/null"

# Test 5: Research Assistant - Scratchpad
run_test "Research Assistant - Get Scratchpad Items" \
    "curl -s -f ${API_URL}/api/scratchpad-items?tenantId=test-tenant > /dev/null"

# Test 6: Workspace Enhancements - Anomaly Detection
run_test "Workspace - Anomaly Detection" \
    "curl -s -f ${API_URL}/api/deals/test-tenant/anomalies?ticker=NVDA > /dev/null"

# Test 7: Platform Admin Access
run_test "Platform Admin - Access Check" \
    "curl -s -f ${API_URL}/api/admin/health \
        -H 'x-admin-key: ${ADMIN_KEY}' > /dev/null"

# Summary
echo "=========================================="
echo "SMOKE TEST RESULTS"
echo "=========================================="
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL SMOKE TESTS PASSED${NC}"
    echo ""
    echo "Deployment appears successful!"
    echo "Continue monitoring for 24-48 hours."
    exit 0
else
    echo -e "${RED}❌ SOME SMOKE TESTS FAILED${NC}"
    echo ""
    echo "Review failed tests and consider rollback if critical."
    echo "See DEPLOYMENT_PLAN_FEB_2026.md for rollback procedures."
    exit 1
fi
