#!/bin/bash

# Quick status check for backfill process

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  Backfill Status Check                                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check if process is still running
if ps aux | grep -v grep | grep "backfill-hierarchy-footnotes.js" > /dev/null; then
    echo "✅ Backfill process is RUNNING"
else
    echo "⚠️  Backfill process is NOT running (may have completed or failed)"
fi

echo ""

# Check database counts
echo "Database Counts:"
echo "================"
node -e "const { PrismaClient } = require('@prisma/client'); \
  const prisma = new PrismaClient(); \
  prisma.\$queryRaw\`SELECT COUNT(*)::int as count FROM metric_hierarchy \
  WHERE deal_id = '52be3858-e723-4c27-a7c4-a61122ce0ba7'::uuid\`.then(r => { \
  console.log('Hierarchy nodes:', r[0].count); \
  return prisma.\$queryRaw\`SELECT COUNT(*)::int as count FROM footnote_references \
  WHERE deal_id = '52be3858-e723-4c27-a7c4-a61122ce0ba7'::uuid\`; \
  }).then(r => { \
  console.log('Footnote references:', r[0].count); \
  prisma.\$disconnect(); });"

echo ""

# Show last 10 lines of log
echo "Last 10 lines of log:"
echo "====================="
tail -10 /tmp/backfill-amzn.log

echo ""
echo "To monitor in real-time: tail -f /tmp/backfill-amzn.log"
