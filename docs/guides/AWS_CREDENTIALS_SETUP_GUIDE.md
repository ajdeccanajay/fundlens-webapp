# AWS Credentials Setup Guide - Step by Step

## Your Current Situation

✅ You have AWS SSO configured in `~/.aws/sso/`  
⏳ Need to get credentials for Bedrock access  
⏳ Need to enable Bedrock in your AWS account  

---

## Option 1: Use AWS SSO (Recommended - You Already Have This!)

### Step 1: Install AWS CLI (if not installed)

```bash
# Check if AWS CLI is installed
aws --version

# If not installed, install it:
# On macOS:
brew install awscli

# Or download from: https://aws.amazon.com/cli/
```

### Step 2: Configure AWS SSO Profile

```bash
# Configure a new profile for Bedrock
aws configure sso

# You'll be prompted for:
# - SSO start URL: [your company's SSO URL]
# - SSO Region: us-east-1 (or your region)
# - Account: [select your account]
# - Role: [select a role with Bedrock permissions]
# - CLI default region: us-east-1
# - Profile name: bedrock (or any name you like)
```

### Step 3: Login to AWS SSO

```bash
# Login (opens browser)
aws sso login --profile bedrock

# Verify it works
aws sts get-caller-identity --profile bedrock
```

### Step 4: Update Your .env File

```bash
# Add to your .env file:
AWS_PROFILE=bedrock
AWS_REGION=us-east-1

# Note: When using AWS_PROFILE, you don't need AWS_ACCESS_KEY_ID/SECRET
```

---

## Option 2: Create IAM User with Access Keys (Alternative)

If you prefer traditional access keys or don't have SSO access:

### Step 1: Login to AWS Console

1. Go to [console.aws.amazon.com](https://console.aws.amazon.com)
2. Login with your credentials

### Step 2: Create IAM User

1. Go to **IAM** service
2. Click **Users** → **Create user**
3. User name: `fundlens-bedrock-user`
4. Click **Next**

### Step 3: Attach Permissions

1. Select **Attach policies directly**
2. Search and select:
   - `AmazonBedrockFullAccess` (for Bedrock access)
   - `AmazonS3FullAccess` (for S3 bucket)
3. Click **Next** → **Create user**

### Step 4: Create Access Keys

1. Click on the user you just created
2. Go to **Security credentials** tab
3. Scroll to **Access keys**
4. Click **Create access key**
5. Select **Application running outside AWS**
6. Click **Next** → **Create access key**
7. **IMPORTANT**: Copy both:
   - Access key ID (starts with `AKIA...`)
   - Secret access key (long random string)
8. Click **Done**

### Step 5: Add to .env File

```bash
# Add these to your .env file:
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...  # paste your access key ID
AWS_SECRET_ACCESS_KEY=...  # paste your secret access key
```

---

## Option 3: Quick Test with Temporary Credentials

If you just want to test quickly:

### Step 1: Get Temporary Credentials from AWS Console

1. Login to [console.aws.amazon.com](https://console.aws.amazon.com)
2. Click your username (top right) → **Security credentials**
3. Scroll to **Access keys**
4. Click **Create access key**
5. Copy the credentials

### Step 2: Add to .env (Valid for 12 hours)

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=ASIA...  # temporary key
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...  # also needed for temporary creds
```

---

## Enable AWS Bedrock in Your Account

### Step 1: Check Bedrock Availability

1. Login to AWS Console
2. Go to **Bedrock** service
3. Select region: **us-east-1** (top right)

### Step 2: Request Model Access

1. In Bedrock console, click **Model access** (left sidebar)
2. Click **Manage model access** (orange button)
3. Find **Anthropic** section
4. Check the box for:
   - ✅ **Claude Opus 4** (or latest Opus version)
   - ✅ **Claude 3.5 Sonnet** (backup)
5. Click **Request model access**
6. Wait 1-5 minutes for approval (usually instant)

### Step 3: Verify Access

```bash
# Test if you can access Bedrock
aws bedrock list-foundation-models --region us-east-1

# Should show list of available models including Claude
```

---

## Complete .env Configuration

Once you have credentials, your `.env` should look like this:

```bash
# Database
DATABASE_URL="postgresql://fundlens_user:fundlens_password@localhost:5432/fundlens_db?schema=public"
PORT=3000
NODE_ENV=development

# SEC API
SEC_USER_AGENT=FundLensAI/1.0 (contact: you@example.com)
REQUEST_DELAY_MS=150
CACHE_TTL_MS=86400000
PYTHON_PARSER_URL=http://localhost:8000

# AWS Configuration
AWS_REGION=us-east-1

# Option A: Using AWS SSO (recommended)
AWS_PROFILE=bedrock

# Option B: Using Access Keys
# AWS_ACCESS_KEY_ID=AKIA...
# AWS_SECRET_ACCESS_KEY=...

# S3 Configuration
S3_BUCKET_NAME=fundlens-documents-dev
USE_MOCK_S3=true  # Keep true for now

# Bedrock Configuration (leave empty until you create Knowledge Base)
# BEDROCK_KB_ID=
```

---

## Test Your AWS Connection

### Step 1: Test AWS Credentials

```bash
# If using SSO:
aws sso login --profile bedrock
aws sts get-caller-identity --profile bedrock

# If using access keys:
aws sts get-caller-identity
```

**Expected output**:
```json
{
    "UserId": "AIDA...",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/your-user"
}
```

### Step 2: Test Bedrock Access

```bash
# List available models
aws bedrock list-foundation-models --region us-east-1 | grep -i claude

# Should show Claude models
```

### Step 3: Test from Your Application

```bash
# Start your server
npm run start:dev

# In another terminal, test a query
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What are Apple'\''s main risk factors?"}'

# Check the logs - should say "Using PostgreSQL fallback"
# (because BEDROCK_KB_ID is not set yet)
```

---

## What You Need Before Using Bedrock

Right now, you can use the system with PostgreSQL fallback (no AWS needed). To use Bedrock, you need:

### Required (One-time Setup):
1. ✅ AWS credentials (this guide)
2. ⏳ Bedrock model access (request in console)
3. ⏳ S3 bucket for chunks
4. ⏳ OpenSearch Serverless collection
5. ⏳ Bedrock Knowledge Base
6. ⏳ Upload narrative chunks

### Cost Warning:
- **OpenSearch Serverless**: ~$175/month (always running)
- **Bedrock KB**: ~$0.10 per query
- **Total**: ~$180-200/month minimum

**Recommendation**: Start with PostgreSQL fallback (free) and only set up Bedrock when you're ready for production.

---

## Quick Decision Tree

### Do you want to use Bedrock NOW?
- **Yes** → Follow this guide to get credentials
- **No** → Keep using PostgreSQL fallback (works great!)

### Do you have budget for ~$180/month?
- **Yes** → Set up Bedrock Knowledge Base (see WEEK3_AWS_BEDROCK_PLAN.md)
- **No** → Use PostgreSQL fallback (free, good quality)

### Do you have AWS account admin access?
- **Yes** → Create IAM user with access keys (Option 2)
- **No** → Ask your AWS admin for credentials or use SSO (Option 1)

---

## Need Help?

### Common Issues:

**"Access Denied" error**:
- Your IAM user/role needs Bedrock permissions
- Add `AmazonBedrockFullAccess` policy

**"Model not found" error**:
- Request model access in Bedrock console
- Wait 1-5 minutes for approval

**"Region not supported" error**:
- Use `us-east-1` region
- Bedrock is not available in all regions

**"Credentials not found" error**:
- Check your .env file
- Make sure AWS_PROFILE or AWS_ACCESS_KEY_ID is set
- Try `aws sts get-caller-identity` to test

---

## Next Steps

1. **Now**: Get AWS credentials using one of the options above
2. **Test**: Verify credentials work with `aws sts get-caller-identity`
3. **Enable**: Request Bedrock model access in AWS console
4. **Later**: Set up Knowledge Base when ready (see WEEK3_AWS_BEDROCK_PLAN.md)

**Current Status**: Your system works perfectly with PostgreSQL fallback. AWS is optional for enhanced quality.
