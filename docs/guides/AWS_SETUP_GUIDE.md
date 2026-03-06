# AWS Setup Guide for FundLens

## Development Options

### Option 1: Mock S3 (Easiest - No AWS Required) ✅ CURRENT

Files are stored locally in `local-s3-storage/` folder.

**Setup:**
```bash
# Already configured in .env
USE_MOCK_S3=true
```

**Pros:**
- No AWS account needed
- No costs
- Instant setup
- Perfect for development

**Cons:**
- Not real S3
- No Bedrock integration yet

---

### Option 2: LocalStack (Local AWS Emulator)

Run AWS services locally using Docker.

**Setup:**
```bash
# 1. Start LocalStack
docker-compose -f docker-compose.localstack.yml up -d

# 2. Create S3 bucket
aws --endpoint-url=http://localhost:4566 \
    s3 mb s3://fundlens-documents-dev \
    --region us-east-1

# 3. Update .env
USE_MOCK_S3=false
AWS_ENDPOINT=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

**Pros:**
- Real AWS SDK
- Test Bedrock locally (limited)
- No AWS costs

**Cons:**
- Requires Docker
- Some AWS features not supported

---

### Option 3: Real AWS (Production)

Use actual AWS services.

**Setup:**

#### 1. Create S3 Bucket
```bash
aws s3 mb s3://fundlens-documents-prod --region us-east-1

# Enable encryption
aws s3api put-bucket-encryption \
  --bucket fundlens-documents-prod \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket fundlens-documents-prod \
  --versioning-configuration Status=Enabled
```

#### 2. Create IAM Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::fundlens-documents-prod/*",
        "arn:aws:s3:::fundlens-documents-prod"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:CreateKnowledgeBase",
        "bedrock:CreateDataSource"
      ],
      "Resource": "*"
    }
  ]
}
```

#### 3. Create IAM User or Use IAM Role
```bash
# Option A: IAM User (for local development)
aws iam create-user --user-name fundlens-dev
aws iam attach-user-policy --user-name fundlens-dev --policy-arn arn:aws:iam::ACCOUNT_ID:policy/FundLensPolicy
aws iam create-access-key --user-name fundlens-dev

# Option B: IAM Role (for EC2/ECS)
# Attach the policy to your EC2/ECS task role
```

#### 4. Configure Credentials

**Option A: Environment Variables**
```bash
# Update .env
USE_MOCK_S3=false
AWS_REGION=us-east-1
S3_BUCKET_NAME=fundlens-documents-prod
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
```

**Option B: AWS CLI Credentials (Recommended)**
```bash
# Configure AWS CLI
aws configure

# .env only needs:
USE_MOCK_S3=false
AWS_REGION=us-east-1
S3_BUCKET_NAME=fundlens-documents-prod
```

**Option C: IAM Role (Production)**
```bash
# No credentials needed in .env
# EC2/ECS will use instance role
USE_MOCK_S3=false
AWS_REGION=us-east-1
S3_BUCKET_NAME=fundlens-documents-prod
```

---

## Testing Your Setup

### 1. Test Upload
```bash
# Via UI
open http://localhost:3000/upload.html

# Via API
curl -X POST http://localhost:3000/api/documents/upload \
  -F "file=@test.pdf" \
  -F "documentType=user_upload" \
  -F "ticker=AAPL"
```

### 2. Verify Storage

**Mock S3:**
```bash
ls -la local-s3-storage/fundlens-documents-dev/
```

**LocalStack:**
```bash
aws --endpoint-url=http://localhost:4566 s3 ls s3://fundlens-documents-dev/
```

**Real AWS:**
```bash
aws s3 ls s3://fundlens-documents-prod/
```

---

## Switching Between Options

### Mock → LocalStack
```bash
# 1. Start LocalStack
docker-compose -f docker-compose.localstack.yml up -d

# 2. Update .env
USE_MOCK_S3=false
AWS_ENDPOINT=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# 3. Restart server
npm run start:dev
```

### Mock → Real AWS
```bash
# 1. Configure AWS credentials
aws configure

# 2. Update .env
USE_MOCK_S3=false
AWS_REGION=us-east-1
S3_BUCKET_NAME=fundlens-documents-prod
# Remove AWS_ENDPOINT

# 3. Restart server
npm run start:dev
```

### Real AWS → Mock
```bash
# 1. Update .env
USE_MOCK_S3=true

# 2. Restart server
npm run start:dev
```

---

## Cost Estimates

### Mock S3
- **Cost**: $0
- **Storage**: Limited by disk space

### LocalStack
- **Cost**: $0 (open source)
- **Storage**: Limited by disk space

### Real AWS
- **S3 Storage**: $0.023/GB/month
- **S3 Requests**: $0.0004/1K PUT, $0.0004/1K GET
- **Bedrock**: Pay per use
  - Claude Opus 4: $15/1M input tokens, $75/1M output tokens
  - Titan Embeddings: $0.0001/1K tokens

**Example Monthly Cost:**
- 100GB storage: $2.30
- 100K requests: $0.40
- 1M Bedrock tokens: $15-75
- **Total**: ~$20-80/month

---

## Troubleshooting

### "Could not load credentials"
```bash
# Check AWS CLI configuration
aws configure list

# Or use mock S3
USE_MOCK_S3=true
```

### "Access Denied"
```bash
# Check IAM permissions
aws iam get-user-policy --user-name fundlens-dev --policy-name FundLensPolicy

# Verify bucket exists
aws s3 ls
```

### "Bucket does not exist"
```bash
# Create bucket
aws s3 mb s3://fundlens-documents-prod --region us-east-1
```

---

## Next Steps

Once S3 is working:
1. ✅ Upload documents via UI
2. ✅ Verify storage
3. 🔄 Phase 2: Document processing (Lambda)
4. 🔄 Phase 3: Bedrock Knowledge Base
5. 🔄 Phase 4: RAG with Claude Opus 4

Current setup: **Mock S3** (perfect for development!)
