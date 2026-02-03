#!/bin/bash

# Setup LocalStack S3 bucket for local development

echo "🚀 Setting up LocalStack S3 bucket..."

# Wait for LocalStack to be ready
echo "⏳ Waiting for LocalStack to start..."
sleep 5

# Create S3 bucket
aws --endpoint-url=http://localhost:4566 \
    s3 mb s3://fundlens-documents-dev \
    --region us-east-1

# Verify bucket was created
aws --endpoint-url=http://localhost:4566 \
    s3 ls

echo "✅ LocalStack S3 bucket created: fundlens-documents-dev"
echo ""
echo "📝 Update your .env file with:"
echo "AWS_ENDPOINT=http://localhost:4566"
echo "AWS_ACCESS_KEY_ID=test"
echo "AWS_SECRET_ACCESS_KEY=test"
