#!/bin/bash

# Backfill All Tickers - KB Sync
# Syncs all unsynced tickers to Bedrock KB with progress tracking

LOG_FILE="logs/kb-backfill-$(date +%Y%m%d-%H%M%S).log"
mkdir -p logs

echo "╔════════════════════════════════════════════════════════════╗" | tee -a "$LOG_FILE"
echo "║  KB Sync Backfill - All Tickers                           ║" | tee -a "$LOG_FILE"
echo "╚════════════════════════════════════════════════════════════╝" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "Log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Get list of tickers needing sync
TICKERS=(AMGN META PLTR AAPL INTU GOOG COST CMCSA INTC)
TOTAL_TICKERS=${#TICKERS[@]}
COMPLETED=0
FAILED=0

echo "Tickers to sync: ${TOTAL_TICKERS}" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

for TICKER in "${TICKERS[@]}"; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
  echo "Processing: $TICKER ($(($COMPLETED + $FAILED + 1))/${TOTAL_TICKERS})" | tee -a "$LOG_FILE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
  
  # Run sync script
  if node scripts/manual-kb-sync-ticker.js "$TICKER" 2>&1 | tee -a "$LOG_FILE"; then
    COMPLETED=$((COMPLETED + 1))
    echo "" | tee -a "$LOG_FILE"
    echo "✅ $TICKER completed successfully" | tee -a "$LOG_FILE"
  else
    FAILED=$((FAILED + 1))
    echo "" | tee -a "$LOG_FILE"
    echo "❌ $TICKER failed" | tee -a "$LOG_FILE"
  fi
  
  echo "" | tee -a "$LOG_FILE"
  
  # Wait between tickers to avoid rate limiting (except for last one)
  if [ $(($COMPLETED + $FAILED)) -lt $TOTAL_TICKERS ]; then
    echo "⏳ Waiting 30 seconds before next ticker..." | tee -a "$LOG_FILE"
    sleep 30
    echo "" | tee -a "$LOG_FILE"
  fi
done

echo "╔════════════════════════════════════════════════════════════╗" | tee -a "$LOG_FILE"
echo "║  Backfill Complete                                         ║" | tee -a "$LOG_FILE"
echo "╚════════════════════════════════════════════════════════════╝" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Completed: $COMPLETED" | tee -a "$LOG_FILE"
echo "Failed: $FAILED" | tee -a "$LOG_FILE"
echo "Total: $TOTAL_TICKERS" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Show final status
echo "Running final status check..." | tee -a "$LOG_FILE"
node scripts/monitor-kb-sync-status.js 2>&1 | head -30 | tee -a "$LOG_FILE"

echo "" | tee -a "$LOG_FILE"
echo "Full log saved to: $LOG_FILE" | tee -a "$LOG_FILE"
