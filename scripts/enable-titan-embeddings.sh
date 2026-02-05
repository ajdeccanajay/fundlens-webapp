#!/bin/bash

# Enable Amazon Titan Embeddings model in AWS Bedrock
# This model is required for document processing and semantic search

echo "🔧 Enabling Amazon Titan Embeddings model..."
echo ""

MODEL_ID="amazon.titan-embed-text-v2:0"

# Test if model is already enabled
echo "Testing current model access..."
TEST_RESULT=$(aws bedrock-runtime invoke-model \
  --model-id "$MODEL_ID" \
  --body '{"inputText":"test"}' \
  --content-type application/json \
  /tmp/test-embed.json 2>&1)

if echo "$TEST_RESULT" | grep -q "Operation not allowed"; then
  echo "❌ Model is not enabled"
  echo ""
  echo "To enable the Amazon Titan Embeddings model:"
  echo "1. Go to AWS Console → Bedrock → Model access"
  echo "2. Click 'Manage model access' or 'Edit'"
  echo "3. Find 'Titan Text Embeddings V2' and check the box"
  echo "4. Click 'Save changes'"
  echo ""
  echo "Model ID: $MODEL_ID"
  echo ""
  echo "Note: Amazon models typically don't require agreements,"
  echo "they just need to be enabled in the Model Access page."
  exit 1
elif echo "$TEST_RESULT" | grep -q "contentType"; then
  echo "✅ Model is already enabled and working!"
  cat /tmp/test-embed.json 2>/dev/null
  exit 0
else
  echo "⚠️  Unexpected response:"
  echo "$TEST_RESULT"
  exit 1
fi
