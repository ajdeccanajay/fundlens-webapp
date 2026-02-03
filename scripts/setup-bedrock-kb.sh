#!/bin/bash

# AWS Bedrock Knowledge Base Setup Script
# This script automates the creation of AWS Bedrock KB for FundLens

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BUCKET_NAME="fundlens-bedrock-chunks"
COLLECTION_NAME="fundlens-vectors"
KB_NAME="fundlens-kb"
ROLE_NAME="BedrockKnowledgeBaseRole"
REGION="us-east-1"

echo -e "${BLUE}🚀 Starting AWS Bedrock Knowledge Base Setup${NC}"
echo -e "${BLUE}================================================${NC}"

# Check prerequisites
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Please install AWS CLI first.${NC}"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured. Please run 'aws configure' first.${NC}"
    exit 1
fi

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}✅ AWS Account ID: $ACCOUNT_ID${NC}"

# Check if backend is running
if ! curl -s http://localhost:3000/api/health > /dev/null; then
    echo -e "${RED}❌ Backend not running. Please start the backend first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# Phase 1: Create S3 Bucket
echo -e "\n${BLUE}📦 Phase 1: Creating S3 Bucket${NC}"

if aws s3 ls "s3://$BUCKET_NAME" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  S3 bucket $BUCKET_NAME already exists${NC}"
else
    echo -e "${YELLOW}📦 Creating S3 bucket: $BUCKET_NAME${NC}"
    aws s3 mb "s3://$BUCKET_NAME" --region $REGION
    
    # Enable versioning
    aws s3api put-bucket-versioning \
        --bucket "$BUCKET_NAME" \
        --versioning-configuration Status=Enabled
    
    # Enable encryption
    aws s3api put-bucket-encryption \
        --bucket "$BUCKET_NAME" \
        --server-side-encryption-configuration '{
            "Rules": [{
                "ApplyServerSideEncryptionByDefault": {
                    "SSEAlgorithm": "AES256"
                }
            }]
        }'
    
    echo -e "${GREEN}✅ S3 bucket created and configured${NC}"
fi

# Upload test chunks (AAPL only first)
echo -e "${YELLOW}📤 Uploading test chunks (AAPL only)...${NC}"
UPLOAD_RESULT=$(curl -s -X POST "http://localhost:3000/api/rag/chunks/upload-s3" \
    -H "Content-Type: application/json" \
    -d "{
        \"bucket\": \"$BUCKET_NAME\",
        \"ticker\": \"AAPL\",
        \"keyPrefix\": \"chunks\",
        \"dryRun\": false
    }")

if echo "$UPLOAD_RESULT" | grep -q '"success":true'; then
    UPLOADED_COUNT=$(echo "$UPLOAD_RESULT" | grep -o '"uploadedCount":[0-9]*' | cut -d':' -f2)
    echo -e "${GREEN}✅ Uploaded $UPLOADED_COUNT chunks to S3${NC}"
else
    echo -e "${RED}❌ Failed to upload chunks to S3${NC}"
    echo "$UPLOAD_RESULT"
    exit 1
fi

# Phase 2: Create OpenSearch Serverless Collection
echo -e "\n${BLUE}🔍 Phase 2: Creating OpenSearch Serverless Collection${NC}"

# Check if collection exists
if aws opensearchserverless batch-get-collection --names "$COLLECTION_NAME" 2>/dev/null | grep -q "$COLLECTION_NAME"; then
    echo -e "${YELLOW}⚠️  OpenSearch collection $COLLECTION_NAME already exists${NC}"
    COLLECTION_ENDPOINT=$(aws opensearchserverless batch-get-collection \
        --names "$COLLECTION_NAME" \
        --query 'collectionDetails[0].collectionEndpoint' \
        --output text)
    COLLECTION_ARN=$(aws opensearchserverless batch-get-collection \
        --names "$COLLECTION_NAME" \
        --query 'collectionDetails[0].arn' \
        --output text)
else
    echo -e "${YELLOW}🔐 Creating security policies...${NC}"
    
    # Create encryption policy
    aws opensearchserverless create-security-policy \
        --name fundlens-encryption-policy \
        --type encryption \
        --policy '{
            "Rules": [{
                "ResourceType": "collection",
                "Resource": ["collection/'$COLLECTION_NAME'"]
            }],
            "AWSOwnedKey": true
        }' || echo "Encryption policy may already exist"
    
    # Create network policy
    aws opensearchserverless create-security-policy \
        --name fundlens-network-policy \
        --type network \
        --policy '[{
            "Rules": [{
                "ResourceType": "collection",
                "Resource": ["collection/'$COLLECTION_NAME'"]
            }],
            "AllowFromPublic": true
        }]' || echo "Network policy may already exist"
    
    # Create data access policy
    aws opensearchserverless create-access-policy \
        --name fundlens-data-policy \
        --type data \
        --policy '[{
            "Rules": [{
                "ResourceType": "collection",
                "Resource": ["collection/'$COLLECTION_NAME'"],
                "Permission": ["aoss:*"]
            }, {
                "ResourceType": "index",
                "Resource": ["index/'$COLLECTION_NAME'/*"],
                "Permission": ["aoss:*"]
            }],
            "Principal": ["arn:aws:iam::'$ACCOUNT_ID':root"]
        }]' || echo "Data access policy may already exist"
    
    echo -e "${YELLOW}🏗️  Creating OpenSearch collection (this takes 2-3 minutes)...${NC}"
    aws opensearchserverless create-collection \
        --name "$COLLECTION_NAME" \
        --type VECTORSEARCH \
        --description "FundLens SEC filings vector search"
    
    # Wait for collection to be active
    echo -e "${YELLOW}⏳ Waiting for collection to be active...${NC}"
    while true; do
        STATUS=$(aws opensearchserverless batch-get-collection \
            --names "$COLLECTION_NAME" \
            --query 'collectionDetails[0].status' \
            --output text 2>/dev/null || echo "CREATING")
        
        if [ "$STATUS" = "ACTIVE" ]; then
            echo -e "${GREEN}✅ Collection is active${NC}"
            break
        elif [ "$STATUS" = "FAILED" ]; then
            echo -e "${RED}❌ Collection creation failed${NC}"
            exit 1
        else
            echo -e "${YELLOW}⏳ Collection status: $STATUS (waiting...)${NC}"
            sleep 30
        fi
    done
    
    # Get collection details
    COLLECTION_ENDPOINT=$(aws opensearchserverless batch-get-collection \
        --names "$COLLECTION_NAME" \
        --query 'collectionDetails[0].collectionEndpoint' \
        --output text)
    COLLECTION_ARN=$(aws opensearchserverless batch-get-collection \
        --names "$COLLECTION_NAME" \
        --query 'collectionDetails[0].arn' \
        --output text)
fi

echo -e "${GREEN}✅ Collection Endpoint: $COLLECTION_ENDPOINT${NC}"

# Create vector index
echo -e "${YELLOW}📊 Creating vector index...${NC}"
INDEX_RESPONSE=$(curl -s -X PUT \
    "$COLLECTION_ENDPOINT/fundlens-index" \
    -H "Content-Type: application/json" \
    --aws-sigv4 "aws:amz:$REGION:aoss" \
    -d '{
        "settings": {
            "index.knn": true
        },
        "mappings": {
            "properties": {
                "bedrock-knowledge-base-default-vector": {
                    "type": "knn_vector",
                    "dimension": 1024,
                    "method": {
                        "name": "hnsw",
                        "engine": "faiss"
                    }
                },
                "AMAZON_BEDROCK_TEXT_CHUNK": {
                    "type": "text"
                },
                "AMAZON_BEDROCK_METADATA": {
                    "type": "object"
                }
            }
        }
    }')

if echo "$INDEX_RESPONSE" | grep -q '"acknowledged":true'; then
    echo -e "${GREEN}✅ Vector index created successfully${NC}"
else
    echo -e "${YELLOW}⚠️  Index may already exist or creation in progress${NC}"
fi

# Phase 3: Create Bedrock Knowledge Base
echo -e "\n${BLUE}🧠 Phase 3: Creating Bedrock Knowledge Base${NC}"

# Check if role exists
if aws iam get-role --role-name "$ROLE_NAME" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  IAM role $ROLE_NAME already exists${NC}"
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
else
    echo -e "${YELLOW}🔐 Creating IAM role for Bedrock...${NC}"
    
    # Create trust policy
    cat > /tmp/bedrock-trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "bedrock.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
EOF
    
    # Create IAM role
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document file:///tmp/bedrock-trust-policy.json
    
    # Create permission policy
    cat > /tmp/bedrock-permissions-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::$BUCKET_NAME",
                "arn:aws:s3:::$BUCKET_NAME/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "aoss:APIAccessAll"
            ],
            "Resource": "arn:aws:aoss:$REGION:*:collection/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModel"
            ],
            "Resource": "arn:aws:bedrock:$REGION::foundation-model/amazon.titan-embed-text-v2:0"
        }
    ]
}
EOF
    
    # Attach policy to role
    aws iam put-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-name BedrockKnowledgeBasePolicy \
        --policy-document file:///tmp/bedrock-permissions-policy.json
    
    # Get role ARN
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
    
    echo -e "${GREEN}✅ IAM role created: $ROLE_ARN${NC}"
    
    # Wait for role to propagate
    echo -e "${YELLOW}⏳ Waiting for IAM role to propagate (30 seconds)...${NC}"
    sleep 30
fi

# Check if Knowledge Base exists
KB_ID=$(aws bedrock-agent list-knowledge-bases \
    --query "knowledgeBaseSummaries[?name=='$KB_NAME'].knowledgeBaseId" \
    --output text 2>/dev/null || echo "")

if [ -n "$KB_ID" ] && [ "$KB_ID" != "None" ]; then
    echo -e "${YELLOW}⚠️  Knowledge Base $KB_NAME already exists with ID: $KB_ID${NC}"
else
    echo -e "${YELLOW}🧠 Creating Bedrock Knowledge Base...${NC}"
    
    KB_RESPONSE=$(aws bedrock-agent create-knowledge-base \
        --name "$KB_NAME" \
        --description "FundLens SEC filings knowledge base" \
        --role-arn "$ROLE_ARN" \
        --knowledge-base-configuration '{
            "type": "VECTOR",
            "vectorKnowledgeBaseConfiguration": {
                "embeddingModelArn": "arn:aws:bedrock:'$REGION'::foundation-model/amazon.titan-embed-text-v2:0"
            }
        }' \
        --storage-configuration '{
            "type": "OPENSEARCH_SERVERLESS",
            "opensearchServerlessConfiguration": {
                "collectionArn": "'$COLLECTION_ARN'",
                "vectorIndexName": "fundlens-index",
                "fieldMapping": {
                    "vectorField": "bedrock-knowledge-base-default-vector",
                    "textField": "AMAZON_BEDROCK_TEXT_CHUNK",
                    "metadataField": "AMAZON_BEDROCK_METADATA"
                }
            }
        }')
    
    KB_ID=$(echo "$KB_RESPONSE" | grep -o '"knowledgeBaseId":"[^"]*"' | cut -d'"' -f4)
    echo -e "${GREEN}✅ Knowledge Base created with ID: $KB_ID${NC}"
fi

# Create data source
echo -e "${YELLOW}📂 Creating S3 data source...${NC}"

DS_ID=$(aws bedrock-agent list-data-sources \
    --knowledge-base-id "$KB_ID" \
    --query 'dataSourceSummaries[0].dataSourceId' \
    --output text 2>/dev/null || echo "")

if [ -n "$DS_ID" ] && [ "$DS_ID" != "None" ]; then
    echo -e "${YELLOW}⚠️  Data source already exists with ID: $DS_ID${NC}"
else
    DS_RESPONSE=$(aws bedrock-agent create-data-source \
        --knowledge-base-id "$KB_ID" \
        --name fundlens-s3-source \
        --description "FundLens S3 chunks data source" \
        --data-source-configuration '{
            "type": "S3",
            "s3Configuration": {
                "bucketArn": "arn:aws:s3:::'$BUCKET_NAME'",
                "inclusionPrefixes": ["chunks/"]
            }
        }')
    
    DS_ID=$(echo "$DS_RESPONSE" | grep -o '"dataSourceId":"[^"]*"' | cut -d'"' -f4)
    echo -e "${GREEN}✅ Data source created with ID: $DS_ID${NC}"
fi

# Start ingestion job
echo -e "${YELLOW}🔄 Starting ingestion job...${NC}"

INGESTION_RESPONSE=$(aws bedrock-agent start-ingestion-job \
    --knowledge-base-id "$KB_ID" \
    --data-source-id "$DS_ID")

INGESTION_JOB_ID=$(echo "$INGESTION_RESPONSE" | grep -o '"ingestionJobId":"[^"]*"' | cut -d'"' -f4)
echo -e "${GREEN}✅ Ingestion job started with ID: $INGESTION_JOB_ID${NC}"

# Monitor ingestion progress
echo -e "${YELLOW}⏳ Monitoring ingestion progress (this takes 5-10 minutes)...${NC}"
while true; do
    STATUS=$(aws bedrock-agent list-ingestion-jobs \
        --knowledge-base-id "$KB_ID" \
        --data-source-id "$DS_ID" \
        --query 'ingestionJobSummaries[0].status' \
        --output text 2>/dev/null || echo "IN_PROGRESS")
    
    if [ "$STATUS" = "COMPLETE" ]; then
        echo -e "${GREEN}✅ Ingestion completed successfully${NC}"
        break
    elif [ "$STATUS" = "FAILED" ]; then
        echo -e "${RED}❌ Ingestion failed${NC}"
        aws bedrock-agent list-ingestion-jobs \
            --knowledge-base-id "$KB_ID" \
            --data-source-id "$DS_ID"
        exit 1
    else
        echo -e "${YELLOW}⏳ Ingestion status: $STATUS (waiting...)${NC}"
        sleep 30
    fi
done

# Update .env file
echo -e "${YELLOW}📝 Updating .env file...${NC}"
if grep -q "BEDROCK_KB_ID=" .env; then
    sed -i.bak "s/BEDROCK_KB_ID=.*/BEDROCK_KB_ID=$KB_ID/" .env
else
    echo "BEDROCK_KB_ID=$KB_ID" >> .env
fi

# Phase 4: Test the setup
echo -e "\n${BLUE}🧪 Phase 4: Testing Bedrock Knowledge Base${NC}"

echo -e "${YELLOW}🔍 Testing semantic search...${NC}"
TEST_RESULT=$(aws bedrock-agent-runtime retrieve \
    --knowledge-base-id "$KB_ID" \
    --retrieval-query '{"text": "What are Apple'\''s main risk factors?"}' \
    --retrieval-configuration '{
        "vectorSearchConfiguration": {
            "numberOfResults": 3
        }
    }' 2>/dev/null || echo "Test failed")

if echo "$TEST_RESULT" | grep -q "retrievalResults"; then
    RESULT_COUNT=$(echo "$TEST_RESULT" | grep -o '"retrievalResults":\[' | wc -l)
    echo -e "${GREEN}✅ Semantic search working! Retrieved results.${NC}"
else
    echo -e "${RED}❌ Semantic search test failed${NC}"
    echo "$TEST_RESULT"
fi

# Test application integration
echo -e "${YELLOW}🔗 Testing application integration...${NC}"
APP_TEST=$(curl -s -X POST "http://localhost:3000/api/rag/query" \
    -H "Content-Type: application/json" \
    -d '{"query": "What are Apple'\''s main business segments?"}' || echo "App test failed")

if echo "$APP_TEST" | grep -q '"answer"'; then
    echo -e "${GREEN}✅ Application integration working!${NC}"
else
    echo -e "${YELLOW}⚠️  Application integration needs configuration${NC}"
    echo "Make sure BEDROCK_KB_ID is set in .env and restart the backend"
fi

# Summary
echo -e "\n${GREEN}🎉 AWS Bedrock Knowledge Base Setup Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}✅ S3 Bucket: $BUCKET_NAME${NC}"
echo -e "${GREEN}✅ OpenSearch Collection: $COLLECTION_NAME${NC}"
echo -e "${GREEN}✅ Knowledge Base ID: $KB_ID${NC}"
echo -e "${GREEN}✅ Data Source ID: $DS_ID${NC}"
echo -e "${GREEN}✅ Ingestion: Complete${NC}"

echo -e "\n${BLUE}📋 Next Steps:${NC}"
echo -e "${YELLOW}1. Restart your backend to load the new BEDROCK_KB_ID${NC}"
echo -e "${YELLOW}2. Test semantic queries: 'What are Apple's risk factors?'${NC}"
echo -e "${YELLOW}3. Upload more companies with: curl -X POST localhost:3000/api/rag/chunks/upload-s3${NC}"
echo -e "${YELLOW}4. Monitor costs in AWS Console (OpenSearch Serverless ~\$175/month)${NC}"

echo -e "\n${BLUE}💰 Estimated Monthly Costs:${NC}"
echo -e "${YELLOW}• OpenSearch Serverless: ~\$175/month${NC}"
echo -e "${YELLOW}• S3 Storage: ~\$0.01/month${NC}"
echo -e "${YELLOW}• Bedrock Queries: ~\$0.0004 per query${NC}"
echo -e "${YELLOW}• Total: ~\$175/month + query costs${NC}"

echo -e "\n${GREEN}🚀 Bedrock Knowledge Base is ready for semantic search!${NC}"

# Clean up temp files
rm -f /tmp/bedrock-trust-policy.json /tmp/bedrock-permissions-policy.json

exit 0