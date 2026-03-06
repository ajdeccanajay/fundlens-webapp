#!/bin/bash
# Run pipelines for all 10 tickers on production ECS, then trigger clean-slate KB sync.
# Usage: bash scripts/run-all-pipelines-and-kb-sync.sh

BASE_URL="https://fundlens-production-alb-931926615.us-east-1.elb.amazonaws.com/api"

TICKERS=("AAPL" "ABNB" "AMGN" "AMZN" "ETSY" "GOOGL" "MSFT" "NVDA" "SHOP" "TSLA")

echo "🚀 FundLens Pipeline Runner — All 10 Tickers"
echo "   Base URL: $BASE_URL"
echo ""

TOTAL_FILINGS=0
TOTAL_NARRATIVES=0
SUCCEEDED=0
FAILED=0

for TICKER in "${TICKERS[@]}"; do
  echo "═══════════════════════════════════════════════════════"
  echo "🔄 Starting pipeline for $TICKER..."
  echo "═══════════════════════════════════════════════════════"
  
  START=$(date +%s)
  
  RESULT=$(curl -sk -X POST "$BASE_URL/comprehensive-sec-pipeline/execute-company/$TICKER" \
    -H "Content-Type: application/json" \
    -d '{
      "years": [2021, 2022, 2023, 2024, 2025, 2026],
      "filingTypes": ["10-K", "10-Q", "8-K", "DEF 14A", "4", "S-1", "40-F", "6-K", "F-1"],
      "skipExisting": false,
      "syncToKnowledgeBase": false
    }' \
    --max-time 900 2>&1)
  
  END=$(date +%s)
  ELAPSED=$((END - START))
  
  # Parse result
  SUCCESS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success', False))" 2>/dev/null)
  PROCESSED=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('processedFilings', 0))" 2>/dev/null)
  NARRATIVES=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('totalNarratives', 0))" 2>/dev/null)
  MSG=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message', 'unknown'))" 2>/dev/null)
  
  if [ "$SUCCESS" = "True" ] || [ "$SUCCESS" = "true" ]; then
    echo "✅ $TICKER: $PROCESSED filings, $NARRATIVES narratives (${ELAPSED}s)"
    SUCCEEDED=$((SUCCEEDED + 1))
    TOTAL_FILINGS=$((TOTAL_FILINGS + PROCESSED))
    TOTAL_NARRATIVES=$((TOTAL_NARRATIVES + NARRATIVES))
  else
    echo "⚠️  $TICKER: $MSG (${ELAPSED}s)"
    # Still count as succeeded if we got some data
    if [ "$PROCESSED" -gt 0 ] 2>/dev/null; then
      SUCCEEDED=$((SUCCEEDED + 1))
      TOTAL_FILINGS=$((TOTAL_FILINGS + PROCESSED))
      TOTAL_NARRATIVES=$((TOTAL_NARRATIVES + NARRATIVES))
    else
      FAILED=$((FAILED + 1))
    fi
  fi
  
  # Rate limit between tickers
  if [ "$TICKER" != "TSLA" ]; then
    echo "⏳ Waiting 5s (SEC rate limit)..."
    sleep 5
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════"
echo "📊 PIPELINE SUMMARY"
echo "═══════════════════════════════════════════════════════"
echo "Succeeded: $SUCCEEDED / ${#TICKERS[@]}"
echo "Failed: $FAILED"
echo "Total filings: $TOTAL_FILINGS"
echo "Total narratives: $TOTAL_NARRATIVES"
echo ""

if [ $SUCCEEDED -gt 0 ]; then
  echo "═══════════════════════════════════════════════════════"
  echo "🔄 STEP 2: Clean-Slate KB Sync"
  echo "═══════════════════════════════════════════════════════"
  node scripts/clean-slate-kb-sync.js
fi

echo ""
echo "🏁 Done!"
