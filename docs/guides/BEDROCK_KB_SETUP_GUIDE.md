# AWS Bedrock Knowledge Base Setup Guide

## Overview
This guide sets up AWS Bedrock Knowledge Base for semantic search of SEC filing narratives.

**Goal**: Enable natural language queries like "What are Apple's risk factors?" with semantic search.

## Prerequisites ✅

- ✅ AWS Account with Bedrock access
- ✅ AWS CLI configured
- ✅ 571 narrative chunks ready for upload
- ✅ Chunk exporter service working

## Phase 1: Create S3 Bucket for Chunks

### Step 1: Create S3 Bucket
```bash
# Create bucket for Bedrock chunks
aws s3 mb s3://fundlens-bedrock-chunks --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket fundlens-bedrock-chunks \
  --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
  --bucket fundlens-bedrock-chunks \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'
```

### Step 2: Upload Chunks to S3
```bash
# Test upload (dry run first)
curl -X POST "http://localhost:3000/api/rag/chunks/upload-s3" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "fundlens-bedrock-chunks",
    "ticker": "AAPL",
    "keyPrefix": "chunks",
    "dryRun": true
  }'

# Real upload (start with AAPL only)
curl -X POST "http://localhost:3000/api/rag/chunks/upload-s3" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "fundlens-bedrock-chunks",
    "ticker": "AAPL",
    "keyPrefix": "chunks",
    "dryRun": false
  }'
```

## Phase 2: Create OpenSearch Serverless Collection

### Step 1: Create Security Policies
```bash
# Create encryption policy
aws opensearchserverless create-security-policy \
  --name fundlens-encryption-policy \
  --type encryption \
  --policy '{
    "Rules": [{
      "ResourceType": "collection",
      "Resource": ["collection/fundlens-vectors"]
    }],
    "AWSOwnedKey": true
  }'

# Create network policy (public access for now)
aws opensearchserverless create-security-policy \
  --name fundlens-network-policy \
  --type network \
  --policy '[{
    "Rules": [{
      "ResourceType": "collection",
      "Resource": ["collection/fundlens-vectors"]
    }],
    "AllowFromPublic": true
  }]'

# Create data access policy
aws opensearchserverless create-access-policy \
  --name fundlens-data-policy \
  --type data \
  --policy '[{
    "Rules": [{
      "ResourceType": "collection",
      "Resource": ["collection/fundlens-vectors"],
      "Permission": ["aoss:*"]
    }, {
      "ResourceType": "index",
      "Resource": ["index/fundlens-vectors/*"],
      "Permission": ["aoss:*"]
    }],
    "Principal": ["arn:aws:iam::ACCOUNT_ID:root"]
  }]'
```

### Step 2: Create Collection
```bash
# Create OpenSearch Serverless collection
aws opensearchserverless create-collection \
  --name fundlens-vectors \
  --type VECTORSEARCH \
  --description "FundLens SEC filings vector search"

# Wait for collection to be active (takes 2-3 minutes)
aws opensearchserverless batch-get-collection \
  --names fundlens-vectors

# Get collection endpoint
export COLLECTION_ENDPOINT=$(aws opensearchserverless batch-get-collection \
  --names fundlens-vectors \
  --query 'collectionDetails[0].collectionEndpoint' \
  --output text)

echo "Collection Endpoint: $COLLECTION_ENDPOINT"
```

### Step 3: Create Vector Index
```bash
# Create index for embeddings
curl -X PUT \
  "$COLLECTION_ENDPOINT/fundlens-index" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:us-east-1:aoss" \
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
  }'
```

## Phase 3: Create Bedrock Knowledge Base

### Step 1: Create IAM Role for Bedrock
```bash
# Create trust policy
cat > bedrock-trust-policy.json << EOF
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
  --role-name BedrockKnowledgeBaseRole \
  --assume-role-policy-document file://bedrock-trust-policy.json

# Create permission policy
cat > bedrock-permissions-policy.json << EOF
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
        "arn:aws:s3:::fundlens-bedrock-chunks",
        "arn:aws:s3:::fundlens-bedrock-chunks/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "aoss:APIAccessAll"
      ],
      "Resource": "arn:aws:aoss:us-east-1:*:collection/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0"
    }
  ]
}
EOF

# Attach policy to role
aws iam put-role-policy \
  --role-name BedrockKnowledgeBaseRole \
  --policy-name BedrockKnowledgeBasePolicy \
  --policy-document file://bedrock-permissions-policy.json

# Get role ARN
export ROLE_ARN=$(aws iam get-role \
  --role-name BedrockKnowledgeBaseRole \
  --query 'Role.Arn' \
  --output text)

echo "Role ARN: $ROLE_ARN"
```

### Step 2: Create Knowledge Base
```bash
# Get collection ARN
export COLLECTION_ARN=$(aws opensearchserverless batch-get-collection \
  --names fundlens-vectors \
  --query 'collectionDetails[0].arn' \
  --output text)

# Create Knowledge Base
aws bedrock-agent create-knowledge-base \
  --name fundlens-kb \
  --description "FundLens SEC filings knowledge base" \
  --role-arn "$ROLE_ARN" \
  --knowledge-base-configuration '{
    "type": "VECTOR",
    "vectorKnowledgeBaseConfiguration": {
      "embeddingModelArn": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0"
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
  }'

# Get Knowledge Base ID
export KB_ID=$(aws bedrock-agent list-knowledge-bases \
  --query 'knowledgeBaseSummaries[?name==`fundlens-kb`].knowledgeBaseId' \
  --output text)

echo "Knowledge Base ID: $KB_ID"

# Save to .env file
echo "BEDROCK_KB_ID=$KB_ID" >> .env
```

### Step 3: Create Data Source
```bash
# Create S3 data source
aws bedrock-agent create-data-source \
  --knowledge-base-id "$KB_ID" \
  --name fundlens-s3-source \
  --description "FundLens S3 chunks data source" \
  --data-source-configuration '{
    "type": "S3",
    "s3Configuration": {
      "bucketArn": "arn:aws:s3:::fundlens-bedrock-chunks",
      "inclusionPrefixes": ["chunks/"]
    }
  }'

# Get Data Source ID
export DS_ID=$(aws bedrock-agent list-data-sources \
  --knowledge-base-id "$KB_ID" \
  --query 'dataSourceSummaries[0].dataSourceId' \
  --output text)

echo "Data Source ID: $DS_ID"
```

### Step 4: Start Ingestion Job
```bash
# Start ingestion (creates embeddings)
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id "$KB_ID" \
  --data-source-id "$DS_ID"

# Monitor progress
watch -n 10 "aws bedrock-agent list-ingestion-jobs \
  --knowledge-base-id $KB_ID \
  --data-source-id $DS_ID \
  --query 'ingestionJobSummaries[0].status'"

# Wait for COMPLETE status (takes 5-10 minutes)
```

## Phase 4: Test Bedrock Knowledge Base

### Step 1: Test Retrieval
```bash
# Test semantic search
aws bedrock-agent-runtime retrieve \
  --knowledge-base-id "$KB_ID" \
  --retrieval-query '{"text": "What are Apple'\''s main risk factors?"}' \
  --retrieval-configuration '{
    "vectorSearchConfiguration": {
      "numberOfResults": 5
    }
  }'
```

### Step 2: Test with Metadata Filters
```bash
# Test with ticker filter
aws bedrock-agent-runtime retrieve \
  --knowledge-base-id "$KB_ID" \
  --retrieval-query '{"text": "business segments"}' \
  --retrieval-configuration '{
    "vectorSearchConfiguration": {
      "numberOfResults": 3,
      "filter": {
        "equals": {
          "key": "ticker",
          "value": "AAPL"
        }
      }
    }
  }'
```

### Step 3: Test Application Integration
```bash
# Test RAG query with Bedrock
curl -X POST "http://localhost:3000/api/rag/query" \
  -H "Content-Type: application/json" \
  -d '{"query": "What are Apple'\''s main risk factors?"}'

# Should return semantic results from Bedrock KB
```

## Phase 5: Scale to All Companies

### Step 1: Upload All Chunks
```bash
# Upload all companies (571 chunks)
curl -X POST "http://localhost:3000/api/rag/chunks/upload-s3" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "fundlens-bedrock-chunks",
    "keyPrefix": "chunks",
    "dryRun": false
  }'
```

### Step 2: Re-run Ingestion
```bash
# Start new ingestion job for all data
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id "$KB_ID" \
  --data-source-id "$DS_ID"

# Monitor progress (takes 10-15 minutes for 571 chunks)
```

## Cost Estimation

### Setup Costs (One-time)
- S3 Storage (6MB): ~$0.00
- OpenSearch Serverless: ~$0.24/hour = ~$175/month
- Bedrock KB Ingestion: ~$0.10 per 1000 chunks = ~$0.06
- **Total Setup**: ~$0.06

### Monthly Costs
- S3 Storage: ~$0.01/month
- OpenSearch Serverless: ~$175/month (2 OCUs minimum)
- Bedrock Retrieval: ~$0.0004 per query
- **Total Monthly**: ~$175/month

### Query Costs
- 1,000 queries/month: ~$0.40
- 10,000 queries/month: ~$4.00
- 100,000 queries/month: ~$40.00

## Monitoring & Alerts

### CloudWatch Alarms
```bash
# Create cost alarm
aws cloudwatch put-metric-alarm \
  --alarm-name fundlens-bedrock-cost-alarm \
  --alarm-description "Alert when Bedrock costs exceed $200" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 21600 \
  --evaluation-periods 1 \
  --threshold 200 \
  --comparison-operator GreaterThanThreshold
```

### Usage Monitoring
```bash
# Check ingestion job status
aws bedrock-agent list-ingestion-jobs \
  --knowledge-base-id "$KB_ID" \
  --data-source-id "$DS_ID"

# Check collection metrics
aws opensearchserverless get-collection \
  --id fundlens-vectors
```

## Troubleshooting

### Common Issues

1. **Ingestion Fails**
   - Check S3 bucket permissions
   - Verify chunk format (JSON with content field)
   - Check IAM role permissions

2. **No Search Results**
   - Verify index mapping is correct
   - Check metadata filters
   - Ensure ingestion completed successfully

3. **High Costs**
   - Monitor OpenSearch OCUs (2 minimum)
   - Set up billing alarms
   - Consider using smaller collection

### Rollback Plan
```bash
# Delete resources to stop costs
aws opensearchserverless delete-collection --id fundlens-vectors
aws bedrock-agent delete-knowledge-base --knowledge-base-id "$KB_ID"
aws s3 rb s3://fundlens-bedrock-chunks --force
```

## Success Criteria

### Phase 1 ✅
- [ ] S3 bucket created
- [ ] AAPL chunks uploaded (20 chunks)
- [ ] No upload errors

### Phase 2 ✅
- [ ] OpenSearch collection active
- [ ] Vector index created
- [ ] Security policies configured

### Phase 3 ✅
- [ ] Knowledge Base created
- [ ] Data source configured
- [ ] Ingestion job completed

### Phase 4 ✅
- [ ] Semantic search working
- [ ] Metadata filters working
- [ ] Application integration working

### Phase 5 ✅
- [ ] All 571 chunks ingested
- [ ] Multi-company queries working
- [ ] Costs under $200/month

## Next Steps

After successful setup:
1. **Integrate with RAG Service**: Update semantic retriever to use Bedrock KB
2. **Add Claude Opus 4.5**: For response generation
3. **Optimize Costs**: Monitor and adjust OCUs
4. **Scale Testing**: Test with more complex queries
5. **Production Deployment**: Container deployment with Bedrock integration

Ready to start? Begin with Phase 1! 🚀