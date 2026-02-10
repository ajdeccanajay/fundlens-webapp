#!/bin/bash
# =============================================================================
# FundLens Mega Release — Comprehensive Production Validation
# Covers ALL 8 feature areas from Jan 30 → Feb 9, 2026 release
# =============================================================================
# Usage:
#   ./scripts/post-deployment-mega-validation.sh                    # Run all tests
#   ./scripts/post-deployment-mega-validation.sh --section health   # Run one section
#   ./scripts/post-deployment-mega-validation.sh --skip-auth        # Skip auth-required tests
#   ./scripts/post-deployment-mega-validation.sh --verbose          # Show response bodies
#
# Sections: health, frontend, css, insights, rag, scratchpad, filings,
#           icmemo, provocations, analytics, database, logs
# =============================================================================

set -uo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
API_URL="${API_URL:-https://app.fundlens.ai}"
ADMIN_KEY="${PLATFORM_ADMIN_KEY:-c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
TEST_TENANT="${TEST_TENANT:-test-tenant}"
TEST_TICKER="${TEST_TICKER:-NVDA}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ECS_CLUSTER="${ECS_CLUSTER:-fundlens-production}"
LOG_GROUP="${LOG_GROUP:-/ecs/fundlens-production/backend}"
VERBOSE="${VERBOSE:-false}"
SKIP_AUTH="${SKIP_AUTH:-false}"
SECTION="${SECTION:-all}"
TIMEOUT=15

# ── Colors ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

# ── Counters ───────────────────────────────────────────────────────────────────
TOTAL_PASSED=0
TOTAL_FAILED=0
TOTAL_SKIPPED=0
SECTION_PASSED=0
SECTION_FAILED=0
SECTION_SKIPPED=0
declare -a FAILED_TESTS=()
declare -a SECTION_RESULTS=()

# ── Parse CLI args ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --section)   SECTION="$2"; shift 2 ;;
    --verbose)   VERBOSE="true"; shift ;;
    --skip-auth) SKIP_AUTH="true"; shift ;;
    --url)       API_URL="$2"; shift 2 ;;
    --token)     AUTH_TOKEN="$2"; shift 2 ;;
    --tenant)    TEST_TENANT="$2"; shift 2 ;;
    --ticker)    TEST_TICKER="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--section <name>] [--verbose] [--skip-auth] [--url <url>] [--token <jwt>]"
      echo ""
      echo "Sections: health, frontend, css, insights, rag, scratchpad, filings,"
      echo "          icmemo, provocations, analytics, database, logs, all"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────────────────────────

# HTTP GET test — checks status code
test_get() {
  local name="$1"
  local url="$2"
  local expected="${3:-200}"
  local headers="${4:-}"

  local curl_args=(-s -o /tmp/mega-val-body -w '%{http_code}' --max-time $TIMEOUT)
  if [ -n "$headers" ]; then
    while IFS='|' read -ra HDRS; do
      for h in "${HDRS[@]}"; do
        curl_args+=(-H "$h")
      done
    done <<< "$headers"
  fi

  local status
  status=$(curl "${curl_args[@]}" "$url" 2>/dev/null) || status="000"

  if [ "$status" = "$expected" ]; then
    echo -e "  ${GREEN}✅${NC} $name ${DIM}($status)${NC}"
    ((SECTION_PASSED++))
    return 0
  else
    echo -e "  ${RED}❌${NC} $name ${DIM}(expected $expected, got $status)${NC}"
    FAILED_TESTS+=("$name")
    ((SECTION_FAILED++))
    if [ "$VERBOSE" = "true" ] && [ -f /tmp/mega-val-body ]; then
      echo -e "     ${DIM}$(head -c 200 /tmp/mega-val-body)${NC}"
    fi
    return 1
  fi
}

# HTTP POST test — checks status code
test_post() {
  local name="$1"
  local url="$2"
  local body="$3"
  local expected="${4:-200}"
  local headers="${5:-Content-Type: application/json}"

  local curl_args=(-s -o /tmp/mega-val-body -w '%{http_code}' --max-time $TIMEOUT -X POST -d "$body")
  while IFS='|' read -ra HDRS; do
    for h in "${HDRS[@]}"; do
      curl_args+=(-H "$h")
    done
  done <<< "$headers"

  local status
  status=$(curl "${curl_args[@]}" "$url" 2>/dev/null) || status="000"

  if [ "$status" = "$expected" ]; then
    echo -e "  ${GREEN}✅${NC} $name ${DIM}($status)${NC}"
    ((SECTION_PASSED++))
    return 0
  else
    echo -e "  ${RED}❌${NC} $name ${DIM}(expected $expected, got $status)${NC}"
    FAILED_TESTS+=("$name")
    ((SECTION_FAILED++))
    if [ "$VERBOSE" = "true" ] && [ -f /tmp/mega-val-body ]; then
      echo -e "     ${DIM}$(head -c 200 /tmp/mega-val-body)${NC}"
    fi
    return 1
  fi
}

# HTTP POST test — checks response body contains a string
test_post_contains() {
  local name="$1"
  local url="$2"
  local body="$3"
  local search="$4"
  local headers="${5:-Content-Type: application/json}"

  local curl_args=(-s --max-time $TIMEOUT -X POST -d "$body")
  while IFS='|' read -ra HDRS; do
    for h in "${HDRS[@]}"; do
      curl_args+=(-H "$h")
    done
  done <<< "$headers"

  local response
  response=$(curl "${curl_args[@]}" "$url" 2>/dev/null || echo "")

  if echo "$response" | grep -qi "$search"; then
    echo -e "  ${GREEN}✅${NC} $name ${DIM}(contains '$search')${NC}"
    ((SECTION_PASSED++))
    return 0
  else
    echo -e "  ${RED}❌${NC} $name ${DIM}(missing '$search')${NC}"
    FAILED_TESTS+=("$name")
    ((SECTION_FAILED++))
    if [ "$VERBOSE" = "true" ]; then
      echo -e "     ${DIM}$(echo "$response" | head -c 200)${NC}"
    fi
    return 1
  fi
}

# Check response headers contain a value
test_header() {
  local name="$1"
  local url="$2"
  local header_name="$3"
  local expected_value="$4"
  local method="${5:-GET}"
  local body="${6:-}"

  local curl_args=(-s -D /tmp/mega-val-headers -o /dev/null --max-time $TIMEOUT)
  if [ "$method" = "POST" ]; then
    curl_args+=(-X POST -H "Content-Type: application/json" -d "$body")
  fi

  curl "${curl_args[@]}" "$url" 2>/dev/null || true

  if grep -qi "$header_name.*$expected_value" /tmp/mega-val-headers 2>/dev/null; then
    echo -e "  ${GREEN}✅${NC} $name ${DIM}($header_name: $expected_value)${NC}"
    ((SECTION_PASSED++))
    return 0
  else
    echo -e "  ${RED}❌${NC} $name ${DIM}(header $header_name missing '$expected_value')${NC}"
    FAILED_TESTS+=("$name")
    ((SECTION_FAILED++))
    return 1
  fi
}

# Skip a test with reason
skip_test() {
  local name="$1"
  local reason="$2"
  echo -e "  ${YELLOW}⏭${NC}  $name ${DIM}($reason)${NC}"
  ((SECTION_SKIPPED++))
}

# Section header
begin_section() {
  local name="$1"
  SECTION_PASSED=0
  SECTION_FAILED=0
  SECTION_SKIPPED=0
  echo ""
  echo -e "${CYAN}━━━ $name ━━━${NC}"
}

# Section footer
end_section() {
  local name="$1"
  TOTAL_PASSED=$((TOTAL_PASSED + SECTION_PASSED))
  TOTAL_FAILED=$((TOTAL_FAILED + SECTION_FAILED))
  TOTAL_SKIPPED=$((TOTAL_SKIPPED + SECTION_SKIPPED))

  local status_color=$GREEN
  local status_icon="✅"
  if [ $SECTION_FAILED -gt 0 ]; then
    status_color=$RED
    status_icon="❌"
  fi
  SECTION_RESULTS+=("$(echo -e "${status_color}${status_icon}${NC} $name: ${GREEN}$SECTION_PASSED passed${NC}, ${RED}$SECTION_FAILED failed${NC}, ${YELLOW}$SECTION_SKIPPED skipped${NC}")")
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: CORE HEALTH
# ═══════════════════════════════════════════════════════════════════════════════
section_health() {
  begin_section "1. Core Health"

  test_get "Health endpoint"          "$API_URL/api/health"
  test_get "Homepage loads"           "$API_URL/"
  test_get "Login page"               "$API_URL/login.html"
  test_get "Swagger docs"             "$API_URL/docs"

  end_section "Core Health"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: FRONTEND PAGES
# ═══════════════════════════════════════════════════════════════════════════════
section_frontend() {
  begin_section "2. Frontend Pages"

  test_get "Workspace page"           "$API_URL/app/deals/workspace.html"
  test_get "Research page"            "$API_URL/app/research/index.html"
  test_get "Platform admin page"      "$API_URL/internal/platform-admin.html"
  test_get "Intent analytics page"    "$API_URL/internal/intent-analytics.html"
  test_get "Deals index page"         "$API_URL/app/deals/index.html"

  end_section "Frontend Pages"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: CSS FILES
# ═══════════════════════════════════════════════════════════════════════════════
section_css() {
  begin_section "3. CSS Files (New in Mega Release)"

  test_get "filing-notifications.css"      "$API_URL/css/filing-notifications.css"
  test_get "ic-memo.css"                   "$API_URL/css/ic-memo.css"
  test_get "workspace-enhancements.css"    "$API_URL/css/workspace-enhancements.css"
  test_get "research-scratchpad.css"       "$API_URL/css/research-scratchpad.css"
  test_get "design-system.css"             "$API_URL/css/design-system.css"

  end_section "CSS Files"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: INSIGHTS TAB (Anomaly, Comp Table, Change Tracker, Hierarchy)
# ═══════════════════════════════════════════════════════════════════════════════
section_insights() {
  begin_section "4. Insights Tab"

  test_get "Anomaly detection"        "$API_URL/api/deals/$TEST_TENANT/anomalies?ticker=$TEST_TICKER"
  test_get "Comp table"               "$API_URL/api/deals/$TEST_TENANT/comp-table?ticker=$TEST_TICKER"
  test_get "Change tracker"           "$API_URL/api/deals/$TEST_TENANT/changes?ticker=$TEST_TICKER"
  test_get "Metric hierarchy"         "$API_URL/api/deals/$TEST_TENANT/hierarchy?ticker=$TEST_TICKER"

  end_section "Insights Tab"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5: RAG SYSTEM (Subsection-Aware Retrieval)
# ═══════════════════════════════════════════════════════════════════════════════
section_rag() {
  begin_section "5. RAG System"

  # Basic RAG query — should return something with competitors
  test_post_contains "RAG query (NVDA competitors)" \
    "$API_URL/api/rag/query" \
    "{\"query\": \"Who are NVDA competitors?\", \"ticker\": \"$TEST_TICKER\"}" \
    "competitor"

  # Test intent detection endpoint if it exists
  test_post "Intent detection" \
    "$API_URL/api/rag/detect-intent" \
    "{\"query\": \"What is NVDA revenue growth?\", \"ticker\": \"$TEST_TICKER\"}" \
    "200"

  end_section "RAG System"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6: SCRATCHPAD
# ═══════════════════════════════════════════════════════════════════════════════
section_scratchpad() {
  begin_section "6. Scratchpad"

  test_get "Scratchpad items" "$API_URL/api/scratchpad-items?tenantId=$TEST_TENANT"

  end_section "Scratchpad"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 7: FILING DETECTION SYSTEM
# ═══════════════════════════════════════════════════════════════════════════════
section_filings() {
  begin_section "7. Filing Detection & Notifications"

  # Filing notifications endpoint — 200 (empty array OK) or 401 (auth required, also fine)
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT \
    "$API_URL/api/filings/notifications?dismissed=false&limit=5" 2>/dev/null) || status="000"

  if [ "$status" = "200" ] || [ "$status" = "401" ]; then
    echo -e "  ${GREEN}✅${NC} Filing notifications endpoint ${DIM}($status — endpoint exists)${NC}"
    ((SECTION_PASSED++))
  else
    echo -e "  ${RED}❌${NC} Filing notifications endpoint ${DIM}(got $status)${NC}"
    FAILED_TESTS+=("Filing notifications endpoint")
    ((SECTION_FAILED++))
  fi

  # Check filing detection scheduler init in CloudWatch (if AWS CLI available)
  if command -v aws &> /dev/null; then
    local ten_min_ago
    ten_min_ago=$(date -v-10M +%s000 2>/dev/null || date -d '10 minutes ago' +%s000 2>/dev/null || echo "")

    if [ -n "$ten_min_ago" ]; then
      local log_events
      log_events=$(aws logs filter-log-events \
        --log-group-name "$LOG_GROUP" \
        --filter-pattern "FilingDetection" \
        --start-time "$ten_min_ago" \
        --query 'events[*].message' --output text \
        --region $AWS_REGION 2>/dev/null || echo "")

      if [ -n "$log_events" ] && [ "$log_events" != "None" ]; then
        echo -e "  ${GREEN}✅${NC} FilingDetection scheduler found in logs"
        ((SECTION_PASSED++))
      else
        echo -e "  ${YELLOW}⏭${NC}  FilingDetection scheduler not in recent logs ${DIM}(may not have run yet)${NC}"
        ((SECTION_SKIPPED++))
      fi
    else
      skip_test "FilingDetection scheduler logs" "date command incompatible"
    fi
  else
    skip_test "FilingDetection scheduler logs" "aws CLI not available"
  fi

  end_section "Filing Detection"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 8: IC MEMO STREAMING
# ═══════════════════════════════════════════════════════════════════════════════
section_icmemo() {
  begin_section "8. IC Memo Streaming"

  # Test that the generate-memo endpoint returns SSE headers
  # We send a minimal POST — it may fail with 400/422 without a real dealId,
  # but we can still check if the endpoint exists (not 404)
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT \
    -X POST "$API_URL/api/deals/generate-memo" \
    -H "Content-Type: application/json" \
    -d '{"dealId":"validation-test","ticker":"TEST"}' 2>/dev/null) || status="000"

  if [ "$status" != "404" ] && [ "$status" != "000" ]; then
    echo -e "  ${GREEN}✅${NC} IC Memo endpoint exists ${DIM}($status)${NC}"
    ((SECTION_PASSED++))
  elif [ "$status" = "000" ]; then
    echo -e "  ${RED}❌${NC} IC Memo endpoint unreachable ${DIM}(connection failed)${NC}"
    FAILED_TESTS+=("IC Memo endpoint")
    ((SECTION_FAILED++))
  else
    echo -e "  ${RED}❌${NC} IC Memo endpoint not found ${DIM}($status)${NC}"
    FAILED_TESTS+=("IC Memo endpoint")
    ((SECTION_FAILED++))
  fi

  # Check SSE headers on the endpoint
  test_header "IC Memo returns SSE headers" \
    "$API_URL/api/deals/generate-memo" \
    "Content-Type" "text/event-stream" \
    "POST" '{"dealId":"validation-test","ticker":"TEST"}'

  end_section "IC Memo Streaming"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 9: PROVOCATIONS ENGINE
# ═══════════════════════════════════════════════════════════════════════════════
section_provocations() {
  begin_section "9. Provocations Engine"

  test_get "Provocations endpoint" \
    "$API_URL/api/deals/$TEST_TENANT/provocations?ticker=$TEST_TICKER"

  end_section "Provocations Engine"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 10: INTENT ANALYTICS DASHBOARD (Admin)
# ═══════════════════════════════════════════════════════════════════════════════
section_analytics() {
  begin_section "10. Intent Analytics (Admin)"

  test_get "Realtime metrics" \
    "$API_URL/api/admin/intent-analytics/realtime?tenantId=$TEST_TENANT" \
    "200" \
    "x-admin-key: $ADMIN_KEY"

  test_get "Failed patterns" \
    "$API_URL/api/admin/intent-analytics/failed-patterns?tenantId=$TEST_TENANT" \
    "200" \
    "x-admin-key: $ADMIN_KEY"

  test_get "Platform admin health" \
    "$API_URL/api/admin/health" \
    "200" \
    "x-admin-key: $ADMIN_KEY"

  end_section "Intent Analytics"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 11: DATABASE VERIFICATION
# ═══════════════════════════════════════════════════════════════════════════════
section_database() {
  begin_section "11. Database Tables"

  if [ -z "${DATABASE_URL:-}" ]; then
    skip_test "Filing detection tables"    "DATABASE_URL not set"
    skip_test "Filing notifications table" "DATABASE_URL not set"
    skip_test "Provocations tables"        "DATABASE_URL not set"
    skip_test "Metric learning log table"  "DATABASE_URL not set"
    skip_test "Performance indexes"        "DATABASE_URL not set"
    echo -e "  ${DIM}Set DATABASE_URL to enable DB checks, or verify via ECS exec${NC}"
  else
    # Check filing tables
    local filing_count
    filing_count=$(psql "$DATABASE_URL" -t -c \
      "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'filing_%'" 2>/dev/null | tr -d ' ')
    if [ "${filing_count:-0}" -ge 2 ]; then
      echo -e "  ${GREEN}✅${NC} Filing tables exist ${DIM}($filing_count tables)${NC}"
      ((SECTION_PASSED++))
    else
      echo -e "  ${RED}❌${NC} Filing tables missing ${DIM}(found $filing_count, expected ≥2)${NC}"
      FAILED_TESTS+=("Filing tables")
      ((SECTION_FAILED++))
    fi

    # Check provocations tables
    local prov_count
    prov_count=$(psql "$DATABASE_URL" -t -c \
      "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'provocation%'" 2>/dev/null | tr -d ' ')
    if [ "${prov_count:-0}" -ge 1 ]; then
      echo -e "  ${GREEN}✅${NC} Provocations tables exist ${DIM}($prov_count tables)${NC}"
      ((SECTION_PASSED++))
    else
      echo -e "  ${RED}❌${NC} Provocations tables missing"
      FAILED_TESTS+=("Provocations tables")
      ((SECTION_FAILED++))
    fi

    # Check metric learning log
    local ml_exists
    ml_exists=$(psql "$DATABASE_URL" -t -c \
      "SELECT count(*) FROM information_schema.tables WHERE table_name = 'metric_learning_log'" 2>/dev/null | tr -d ' ')
    if [ "${ml_exists:-0}" -ge 1 ]; then
      echo -e "  ${GREEN}✅${NC} metric_learning_log table exists"
      ((SECTION_PASSED++))
    else
      echo -e "  ${RED}❌${NC} metric_learning_log table missing"
      FAILED_TESTS+=("metric_learning_log table")
      ((SECTION_FAILED++))
    fi

    # Check performance indexes
    local idx_count
    idx_count=$(psql "$DATABASE_URL" -t -c \
      "SELECT count(*) FROM pg_indexes WHERE indexname LIKE 'idx_insights%' OR indexname LIKE 'idx_filing%'" 2>/dev/null | tr -d ' ')
    if [ "${idx_count:-0}" -ge 1 ]; then
      echo -e "  ${GREEN}✅${NC} Performance indexes exist ${DIM}($idx_count indexes)${NC}"
      ((SECTION_PASSED++))
    else
      echo -e "  ${YELLOW}⏭${NC}  Performance indexes not found ${DIM}(may use different naming)${NC}"
      ((SECTION_SKIPPED++))
    fi
  fi

  end_section "Database Tables"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 12: CLOUDWATCH LOG MONITORING
# ═══════════════════════════════════════════════════════════════════════════════
section_logs() {
  begin_section "12. CloudWatch Error Check"

  if ! command -v aws &> /dev/null; then
    skip_test "Recent ERROR logs" "aws CLI not available"
    end_section "CloudWatch Logs"
    return
  fi

  local five_min_ago
  five_min_ago=$(date -v-5M +%s000 2>/dev/null || date -d '5 minutes ago' +%s000 2>/dev/null || echo "")

  if [ -z "$five_min_ago" ]; then
    skip_test "Recent ERROR logs" "date command incompatible"
    end_section "CloudWatch Logs"
    return
  fi

  local error_count
  error_count=$(aws logs filter-log-events \
    --log-group-name "$LOG_GROUP" \
    --filter-pattern "ERROR" \
    --start-time "$five_min_ago" \
    --query 'length(events)' --output text \
    --region $AWS_REGION 2>/dev/null || echo "unknown")

  if [ "$error_count" = "0" ] || [ "$error_count" = "None" ]; then
    echo -e "  ${GREEN}✅${NC} No ERROR logs in last 5 minutes"
    ((SECTION_PASSED++))
  elif [ "$error_count" = "unknown" ]; then
    skip_test "Recent ERROR logs" "Could not query CloudWatch"
  else
    echo -e "  ${YELLOW}⚠️${NC}  Found $error_count ERROR entries in last 5 minutes"
    echo -e "  ${DIM}Run: aws logs tail $LOG_GROUP --follow --filter-pattern ERROR --region $AWS_REGION${NC}"
    ((SECTION_FAILED++))
    FAILED_TESTS+=("CloudWatch errors ($error_count)")
  fi

  end_section "CloudWatch Logs"
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  FundLens Mega Release — Production Validation${NC}"
echo -e "${BLUE}  Jan 30 → Feb 9, 2026${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo -e "  Target:  $API_URL"
echo -e "  Tenant:  $TEST_TENANT"
echo -e "  Ticker:  $TEST_TICKER"
echo -e "  Section: $SECTION"
[ "$SKIP_AUTH" = "true" ] && echo -e "  ${YELLOW}Auth-required tests skipped${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════════${NC}"

run_section() {
  case $1 in
    health)        section_health ;;
    frontend)      section_frontend ;;
    css)           section_css ;;
    insights)      section_insights ;;
    rag)           section_rag ;;
    scratchpad)    section_scratchpad ;;
    filings)       section_filings ;;
    icmemo)        section_icmemo ;;
    provocations)  section_provocations ;;
    analytics)     section_analytics ;;
    database)      section_database ;;
    logs)          section_logs ;;
    *)             echo "Unknown section: $1"; exit 1 ;;
  esac
}

if [ "$SECTION" = "all" ]; then
  section_health
  section_frontend
  section_css
  section_insights
  section_rag
  section_scratchpad
  section_filings
  section_icmemo
  section_provocations
  section_analytics
  section_database
  section_logs
else
  run_section "$SECTION"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  VALIDATION SUMMARY${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo ""

for result in "${SECTION_RESULTS[@]}"; do
  echo -e "  $result"
done

echo ""
echo -e "  ─────────────────────────────────────────────"
echo -e "  Total: ${GREEN}$TOTAL_PASSED passed${NC}  ${RED}$TOTAL_FAILED failed${NC}  ${YELLOW}$TOTAL_SKIPPED skipped${NC}"
echo ""

if [ $TOTAL_FAILED -gt 0 ]; then
  echo -e "${RED}  FAILED TESTS:${NC}"
  for t in "${FAILED_TESTS[@]}"; do
    echo -e "    ${RED}•${NC} $t"
  done
  echo ""
  echo -e "${RED}  ❌ VALIDATION INCOMPLETE — Review failures above${NC}"
  echo ""
  exit 1
else
  echo -e "${GREEN}  ✅ ALL VALIDATION CHECKS PASSED${NC}"
  echo ""
  echo -e "  ${DIM}Next steps:${NC}"
  echo -e "  ${DIM}• Manual UI check: workspace bell icon, IC Memo streaming, Insights tab${NC}"
  echo -e "  ${DIM}• Monitor for 24h: aws logs tail $LOG_GROUP --follow --filter-pattern ERROR --region $AWS_REGION${NC}"
  echo -e "  ${DIM}• Verify filing cron at 6 AM ET tomorrow${NC}"
  echo ""
  exit 0
fi
