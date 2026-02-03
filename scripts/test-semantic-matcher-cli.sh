#!/bin/bash
# Quick CLI test for semantic matcher
# Usage: ./scripts/test-semantic-matcher-cli.sh

echo "╔═══════════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                               ║"
echo "║              SEMANTIC MATCHER CLI TEST                                        ║"
echo "║                                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════════════════════╝"
echo ""

PYTHON_MATCHER="python_parser/xbrl_parsing/semantic_matcher.py"

if [ ! -f "$PYTHON_MATCHER" ]; then
    echo "❌ Error: Semantic matcher not found at $PYTHON_MATCHER"
    exit 1
fi

echo "🧪 Test 1: Exact match"
echo "Query: 'revenue'"
python3 "$PYTHON_MATCHER" "revenue"
echo ""

echo "🧪 Test 2: Typo (missing letter)"
echo "Query: 'revenu'"
python3 "$PYTHON_MATCHER" "revenu"
echo ""

echo "🧪 Test 3: Typo (transposed letters)"
echo "Query: 'reveneu'"
python3 "$PYTHON_MATCHER" "reveneu"
echo ""

echo "🧪 Test 4: Paraphrase"
echo "Query: 'total sales'"
python3 "$PYTHON_MATCHER" "total sales"
echo ""

echo "🧪 Test 5: Natural language"
echo "Query: 'bottom line profit'"
python3 "$PYTHON_MATCHER" "bottom line profit"
echo ""

echo "🧪 Test 6: Banking metric"
echo "Query: 'net interest income'"
python3 "$PYTHON_MATCHER" "net interest income"
echo ""

echo "🧪 Test 7: COGS variations"
echo "Query: 'cost of goods sold'"
python3 "$PYTHON_MATCHER" "cost of goods sold"
echo ""

echo "🧪 Test 8: Cash variations"
echo "Query: 'cash and cash equivalents'"
python3 "$PYTHON_MATCHER" "cash and cash equivalents"
echo ""

echo "✅ All tests complete!"
