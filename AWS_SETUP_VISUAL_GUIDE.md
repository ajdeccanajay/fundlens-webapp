# AWS Setup - Visual Step-by-Step Guide

## 🎯 Goal
Get AWS credentials so you can use Claude Opus 4.5 for better responses.

## ⚡ Quick Start (Choose One Path)

```
┌─────────────────────────────────────────────────────────────┐
│                    Do you have AWS?                          │
└────────────┬────────────────────────────────┬───────────────┘
             │                                │
        ┌────▼────┐                      ┌────▼────┐
        │   YES   │                      │   NO    │
        └────┬────┘                      └────┬────┘
             │                                │
             ▼                                ▼
    ┌────────────────┐              ┌─────────────────┐
    │ Run setup      │              │ Create account  │
    │ script         │              │ at aws.amazon   │
    └────┬───────────┘              └────┬────────────┘
         │                                │
         ▼                                ▼
    Choose method:                   Then come back
    1. SSO (if you have it)          and run setup
    2. Access Keys                   script
    3. Skip (use free mode)
```

---

## 🚀 Method 1: Run the Setup Script (EASIEST)

### Step 1: Run the Script

```bash
./setup-aws-credentials.sh
```

### Step 2: Follow the Prompts

The script will guide you through:
- Choosing your setup method
- Configuring credentials
- Testing the connection
- Updating your .env file

**That's it!** The script does everything for you.

---

## 📋 Method 2: Manual Setup (If Script Doesn't Work)

### Option A: Using AWS SSO (If You Have It)

#### 1. Check if you have AWS SSO
```bash
ls ~/.aws/sso/
```
If you see files, you have SSO! ✅

#### 2. Configure SSO profile
```bash
aws configure sso --profile bedrock
```

#### 3. Login
```bash
aws sso login --profile bedrock
```

#### 4. Add to .env
```bash
AWS_PROFILE=bedrock
AWS_REGION=us-east-1
```

---

### Option B: Using Access Keys (Most Common)

#### 1. Login to AWS Console
Go to: https://console.aws.amazon.com

#### 2. Create IAM User

**Visual Steps:**
```
AWS Console
    ↓
IAM Service (search "IAM")
    ↓
Users (left sidebar)
    ↓
Create user (blue button)
    ↓
User name: fundlens-bedrock-user
    ↓
Next
    ↓
Attach policies directly
    ↓
Search: AmazonBedrockFullAccess
    ↓
☑ Check the box
    ↓
Next → Create user
```

#### 3. Create Access Keys

**Visual Steps:**
```
Click on user you just created
    ↓
Security credentials tab
    ↓
Scroll to "Access keys"
    ↓
Create access key (button)
    ↓
Select: Application running outside AWS
    ↓
Next → Create access key
    ↓
📋 COPY BOTH:
   - Access key ID (AKIA...)
   - Secret access key (long string)
    ↓
Done
```

#### 4. Add to .env File

Open `.env` and add:
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...  # paste your key here
AWS_SECRET_ACCESS_KEY=...  # paste your secret here
```

**Save the file!**

---

## 🔐 Enable Bedrock Model Access

### Step 1: Go to Bedrock Console
https://console.aws.amazon.com/bedrock/

### Step 2: Request Model Access

**Visual Steps:**
```
Bedrock Console
    ↓
Model access (left sidebar)
    ↓
Manage model access (orange button)
    ↓
Find "Anthropic" section
    ↓
☑ Check: Claude Opus 4
☑ Check: Claude 3.5 Sonnet
    ↓
Request model access (bottom right)
    ↓
Wait 1-5 minutes ⏱️
    ↓
✅ Access granted!
```

---

## ✅ Test Your Setup

### Test 1: Check AWS Connection

```bash
# If using SSO:
aws sso login --profile bedrock
aws sts get-caller-identity --profile bedrock

# If using access keys:
aws sts get-caller-identity
```

**Expected output:**
```json
{
    "UserId": "AIDA...",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/fundlens-bedrock-user"
}
```

✅ If you see this, your credentials work!

### Test 2: Check Bedrock Access

```bash
aws bedrock list-foundation-models --region us-east-1 | grep -i claude
```

**Expected output:**
```
"modelId": "anthropic.claude-opus-4-20250514"
"modelId": "anthropic.claude-3-5-sonnet-20241022"
```

✅ If you see Claude models, Bedrock access works!

### Test 3: Test Your Application

```bash
# Start server
npm run start:dev

# In another terminal:
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What are Apple'\''s main risk factors?"}'
```

**Check the logs** - should say:
- ✅ "Using PostgreSQL fallback" (if no BEDROCK_KB_ID)
- ✅ "Using AWS Bedrock Knowledge Base" (if BEDROCK_KB_ID is set)

---

## 🎓 What Each Variable Does

```bash
# Required for AWS
AWS_REGION=us-east-1
# ↑ Which AWS region to use (Bedrock is in us-east-1)

# Option 1: SSO (if you have it)
AWS_PROFILE=bedrock
# ↑ Name of your SSO profile

# Option 2: Access Keys (most common)
AWS_ACCESS_KEY_ID=AKIA...
# ↑ Your access key (like a username)

AWS_SECRET_ACCESS_KEY=...
# ↑ Your secret key (like a password)

# Optional: Only needed when you create Knowledge Base
BEDROCK_KB_ID=
# ↑ Leave empty for now (uses PostgreSQL fallback)
```

---

## 💰 Cost Information

### Current Setup (PostgreSQL Fallback)
- **Cost**: $0
- **Quality**: Good
- **Speed**: Fast
- **Setup**: None needed

### With Bedrock (After Setup)
- **Cost**: ~$0.10 per query
- **Quality**: Excellent
- **Speed**: 2-3 seconds
- **Setup**: Need Knowledge Base (~$180/month)

**Recommendation**: Start with PostgreSQL fallback (free), add Bedrock later when needed.

---

## 🆘 Troubleshooting

### "aws: command not found"

**Solution**: Install AWS CLI
```bash
# macOS:
brew install awscli

# Or download from:
# https://aws.amazon.com/cli/
```

### "Access Denied" error

**Solution**: Your IAM user needs permissions
1. Go to IAM Console
2. Click your user
3. Add policy: `AmazonBedrockFullAccess`

### "Model not found" error

**Solution**: Request model access
1. Go to Bedrock Console
2. Click "Model access"
3. Enable Claude models
4. Wait 1-5 minutes

### "Credentials not found" error

**Solution**: Check your .env file
```bash
# Make sure you have ONE of these:
AWS_PROFILE=bedrock
# OR
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

### Still not working?

1. Check `.env` file exists and has credentials
2. Restart your server: `npm run start:dev`
3. Check logs for error messages
4. Try: `aws sts get-caller-identity` to test credentials

---

## 📚 Summary

### What You Need:
1. ✅ AWS account (free to create)
2. ✅ AWS credentials (SSO or access keys)
3. ✅ Bedrock model access (request in console)
4. ⏳ Knowledge Base (optional, for production)

### What You Get:
- ✅ System works NOW with PostgreSQL (free)
- ✅ Can upgrade to Bedrock anytime
- ✅ Better responses with Claude Opus 4.5
- ✅ Professional-grade financial analysis

### Next Steps:
1. **Now**: Run `./setup-aws-credentials.sh`
2. **Test**: Verify credentials work
3. **Use**: System works with PostgreSQL fallback
4. **Later**: Set up Knowledge Base for production

---

## 🎉 You're Ready!

Your system works perfectly right now with PostgreSQL fallback. AWS credentials are optional for enhanced quality.

**Start using it:**
```bash
npm run start:dev
open http://localhost:3000/rag-query.html
```

**Questions?** See `AWS_CREDENTIALS_SETUP_GUIDE.md` for detailed instructions.
