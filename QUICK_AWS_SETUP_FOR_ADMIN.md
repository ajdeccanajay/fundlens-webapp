# Quick AWS Setup for Admin Users

## You Have: AWS Admin Credentials ✅

Since you already have AWS admin access, setup is super simple!

---

## Step 1: Configure AWS Credentials (2 minutes)

You have **two options** - choose the easiest for you:

### Option A: Use AWS SSO (You Already Have This!)

```bash
# 1. Check your SSO configuration
ls ~/.aws/sso/

# 2. If you see files, you're good! Just add to .env:
echo "AWS_PROFILE=default" >> .env
echo "AWS_REGION=us-east-1" >> .env

# 3. Login (if needed)
aws sso login

# 4. Test it works
aws sts get-caller-identity
```

### Option B: Use Access Keys (Alternative)

If SSO doesn't work or you prefer access keys:

```bash
# 1. Get your access keys from AWS Console:
# https://console.aws.amazon.com/iam/home#/security_credentials

# 2. Add to .env:
echo "AWS_REGION=us-east-1" >> .env
echo "AWS_ACCESS_KEY_ID=your-key-here" >> .env
echo "AWS_SECRET_ACCESS_KEY=your-secret-here" >> .env

# 3. Test it works
aws sts get-caller-identity
```

---

## Step 2: Enable Bedrock Models (1 minute)

### Quick Method (CLI):

```bash
# Enable Claude Opus 4 access
aws bedrock put-model-invocation-logging-configuration \
  --region us-east-1 \
  --logging-config '{}'

# This automatically enables model access for admin users
```

### Visual Method (Console):

1. Go to: https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess
2. Click **"Manage model access"** (orange button)
3. Find **Anthropic** section
4. Check boxes:
   - ✅ Claude Opus 4
   - ✅ Claude 3.5 Sonnet (backup)
5. Click **"Request model access"**
6. Wait 30 seconds - usually instant for admin users

---

## Step 3: Test Your Setup (30 seconds)

```bash
# Test AWS credentials
aws sts get-caller-identity

# Test Bedrock access
aws bedrock list-foundation-models --region us-east-1 | grep -i opus

# Should show: "anthropic.claude-opus-4-20250514"
```

---

## Step 4: Update Your .env File

Your `.env` should have:

```bash
# AWS Configuration (choose ONE option)

# Option A: SSO (if you use SSO)
AWS_PROFILE=default
AWS_REGION=us-east-1

# Option B: Access Keys (if you prefer keys)
# AWS_REGION=us-east-1
# AWS_ACCESS_KEY_ID=AKIA...
# AWS_SECRET_ACCESS_KEY=...

# Bedrock KB (leave empty for now - uses PostgreSQL fallback)
# BEDROCK_KB_ID=
```

---

## Step 5: Test Your Application

```bash
# Restart your server
npm run start:dev

# Test a query
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What are Apple'\''s main risk factors?"}'

# Check logs - should say "Using PostgreSQL fallback"
# (This is correct - you don't have Knowledge Base yet)
```

---

## What You Have Now

✅ AWS credentials configured  
✅ Bedrock model access enabled  
✅ System working with PostgreSQL fallback  
⏳ Knowledge Base (optional - see below)

---

## Next: Create Bedrock Knowledge Base (Optional)

If you want to use AWS Bedrock for semantic search (instead of PostgreSQL):

### Quick Decision:

**Cost**: ~$180/month (OpenSearch Serverless + queries)  
**Benefit**: Better semantic search, natural language responses  
**Alternative**: PostgreSQL fallback works great and is free

### If You Want to Proceed:

See detailed guide: `WEEK3_AWS_BEDROCK_PLAN.md`

**Quick summary:**
1. Create S3 bucket for chunks
2. Create OpenSearch Serverless collection (~$175/month)
3. Create Bedrock Knowledge Base
4. Upload narrative chunks
5. Add `BEDROCK_KB_ID` to .env

**Time**: 30-60 minutes  
**Cost**: ~$180/month ongoing

---

## Recommended Approach

### For Development/Testing (Now):
- ✅ Use PostgreSQL fallback (free, works great)
- ✅ Test all features
- ✅ Validate system works

### For Production (Later):
- ⭐ Set up Bedrock Knowledge Base
- ⭐ Get better semantic search
- ⭐ Natural language responses with Claude Opus 4.5

---

## Troubleshooting

### "Access Denied" when testing Bedrock

```bash
# Check your permissions
aws iam get-user

# If you're admin, you should have full access
# If not, add this policy to your user:
# AmazonBedrockFullAccess
```

### "Model not available"

```bash
# Check model access status
aws bedrock list-foundation-models --region us-east-1 | grep -i claude

# If empty, go to console and request access:
# https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess
```

### "Credentials not found"

```bash
# Check your .env file
cat .env | grep AWS

# Should show either:
# AWS_PROFILE=default
# OR
# AWS_ACCESS_KEY_ID=AKIA...
```

---

## Summary

Since you're an admin, you just need to:

1. ✅ Add AWS credentials to .env (2 min)
2. ✅ Enable Bedrock models in console (1 min)
3. ✅ Test it works (30 sec)

**Total time**: ~5 minutes

Your system will work immediately with PostgreSQL fallback. You can add Bedrock Knowledge Base later if you want enhanced quality.

---

## Quick Commands

```bash
# 1. Add credentials to .env
echo "AWS_PROFILE=default" >> .env
echo "AWS_REGION=us-east-1" >> .env

# 2. Test credentials
aws sts get-caller-identity

# 3. Enable Bedrock (open in browser)
open https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess

# 4. Test Bedrock
aws bedrock list-foundation-models --region us-east-1 | grep opus

# 5. Start your app
npm run start:dev

# 6. Test a query
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What are Tesla'\''s main risks?"}'
```

Done! 🎉
