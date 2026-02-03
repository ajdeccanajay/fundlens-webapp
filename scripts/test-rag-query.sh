#!/bin/bash

echo "🤖 Testing RAG Query Functionality"
echo "===================================="
echo ""

BASE_URL="https://app.fundlens.ai"

# Test 1: Structured Query (Financial Metrics)
echo "1️⃣  Testing Structured Query (META revenue)..."
response=$(curl -s -X POST "$BASE_URL/api/rag/test-structured" \
  -H "Content-Type: application/json" \
  -d '{
    "tickers": ["META"],
    "metrics": ["revenue"],
    "periods": ["2023-Q4"]
  }')

if echo "$response" | grep -q "revenue"; then
    echo "✅ Structured query working"
    echo "Sample: $(echo "$response" | head -c 200)..."
else
    echo "⚠️  Structured query response: $response"
fi
echo ""

# Test 2: Semantic Query (Bedrock KB)
echo "2️⃣  Testing Semantic Query (Bedrock KB)..."
response=$(curl -s -X POST "$BASE_URL/api/rag/test-semantic" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are META'\''s main revenue sources?",
    "ticker": "META"
  }')

if echo "$response" | grep -q "results\|answer\|chunks"; then
    echo "✅ Semantic query working"
    echo "Sample: $(echo "$response" | head -c 200)..."
else
    echo "⚠️  Semantic query response: $response"
fi
echo ""

# Test 3: Hybrid Query
echo "3️⃣  Testing Hybrid Query..."
response=$(curl -s -X POST "$BASE_URL/api/rag/query" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What was META'\''s revenue in 2023?",
    "ticker": "META"
  }')

if echo "$response" | grep -q "answer\|response\|result"; then
    echo "✅ Hybrid query working"
    echo "Sample: $(echo "$response" | head -c 200)..."
else
    echo "⚠️  Hybrid query response: $response"
fi
echo ""

echo "✅ RAG testing complete!"
