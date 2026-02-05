# Deployment Execution Guide - February 4, 2026

## Status: READY TO DEPLOY ✅

**Time**: 3:37 PM EST  
**Git Tag**: `production-feb-2026-v2.0.0`  
**Commit**: `5abd76e`

**Docker Images**: ✅ Both images built with linux/amd64 and pushed to ECR

## ⚠️ CRITICAL: Docker Platform Architecture

**ALWAYS BUILD FOR linux/amd64 PLATFORM**

AWS Fargate ONLY supports `linux/amd64` architecture. If you build Docker images on Apple Silicon (M1/M2/M3 Mac) without specifying the platform, the images will be ARM64 and will **FAIL** to start in Fargate with this error:

```
CannotPullContainerError: image Manifest does not contain descriptor matching platform 'linux/amd64'
```

### ✅ CORRECT Way to Build Images

**ALWAYS use `--platform linux/amd64` flag:**

```bash
# Login to ECR first
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 588082972864.dkr.ecr.us-east-1.amazonaws.com

# Backend image - BUILD AND PUSH IN ONE COMMAND
docker buildx build --platform linux/amd64 \
  -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-backend:prod-TAG \
  -f Dockerfile . --push

# Python parser image - BUILD AND PUSH IN ONE COMMAND
docker buildx build --platform linux/amd64 \
  -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-python-parser:prod-TAG \
  -f python_parser/Dockerfile ./python_parser --push
```

**Important Notes:**
- Use `--push` (not `--load`) when building for different platforms
- This pushes directly to ECR without loading to local Docker
- Building for `linux/amd64` on Apple Silicon takes longer (emulation)
- Verify images in ECR after pushing

### ❌ WRONG Way (Will Fail in Fargate)

```bash
# This builds for your local architecture (ARM64 on Mac)
docker build -t image:tag .  # ❌ NO PLATFORM FLAG
docker push image:tag         # ❌ WILL FAIL IN FARGATE
```

## Docker Images Ready ✅

**✅ ISSUE RESOLVED**: Images rebuilt with correct `--platform linux/amd64` flag for AWS Fargate compatibility.

**Status**: ✅ READY FOR DEPLOYMENT

Correct images (linux/amd64):
1. **Backend Image**:
   - `588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-backend:prod-5abd76e-20260204115053`
   - Size: 279MB
   - Pushed: 12:11 PM EST
   - ✅ Platform: linux/amd64

2. **Python Parser Image**:
   - `588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-python-parser:prod-5abd76e-20260204-amd64`
   - Size: 3.35GB
   - Pushed: 3:36 PM EST
   - ✅ Platform: linux/amd64
   - ✅ Digest: `sha256:90311ff325e17dc146fc93d37eaabd2ad63f117d4725b63ac3f2230132635108`

**Note**: Use the `-amd64` tagged Python parser image for deployment.

## Deployment Steps

### Step 1: Verify Current ECS Setup

First, check what ECS cluster and service names you're using:

```bash
# List ECS clusters
aws ecs list-clusters --region us-east-1

# List services in your cluster (replace cluster name)
aws ecs list-services --cluster YOUR_CLUSTER_NAME --region us-east-1
```

### Step 2: Update Task Definition

You have two options:

#### Option A: Use Existing Script (Recommended)
```bash
cd scripts/deploy
./deploy-backend.sh
```

#### Option B: Manual Update
```bash
# Get current task definition
aws ecs describe-task-definition \
  --task-definition YOUR_TASK_FAMILY \
  --region us-east-1 > current-task-def.json

# Edit the task definition to update image URIs:
# - Backend container: 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-backend:prod-5abd76e-20260204115053
# - Python parser container: 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-python-parser:prod-5abd76e-20260204115053

# Register new task definition
aws ecs register-task-definition \
  --cli-input-json file://updated-task-def.json \
  --region us-east-1
```

### Step 3: Update ECS Service

```bash
# Update service to use new task definition
aws ecs update-service \
  --cluster YOUR_CLUSTER_NAME \
  --service YOUR_SERVICE_NAME \
  --task-definition YOUR_TASK_FAMILY:NEW_REVISION \
  --force-new-deployment \
  --region us-east-1
```

### Step 4: Monitor Deployment

```bash
# Watch service status
aws ecs describe-services \
  --cluster YOUR_CLUSTER_NAME \
  --services YOUR_SERVICE_NAME \
  --region us-east-1 \
  --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount,deployments:deployments[*].{status:status,desired:desiredCount,running:runningCount,taskDef:taskDefinition}}'

# Watch task logs (get task ID first)
aws ecs list-tasks --cluster YOUR_CLUSTER_NAME --service YOUR_SERVICE_NAME --region us-east-1
aws logs tail /ecs/YOUR_LOG_GROUP --follow
```

### Step 5: Run Database Migrations

Once the new tasks are running:

```bash
# Option A: SSH into ECS task
aws ecs execute-command \
  --cluster YOUR_CLUSTER_NAME \
  --task TASK_ID \
  --container backend \
  --interactive \
  --command "/bin/bash"

# Then inside the container:
npm run prisma:migrate:deploy

# Option B: Run via Systems Manager (if configured)
# Or run migrations from your local machine pointing to production DB
```

**Required Migrations** (will be applied):
- `20260203_add_subsection_to_narrative_chunks.sql`
- `20260203_add_scratchpad_items.sql`
- `20260202_add_hierarchy_and_footnotes_tables.sql`
- `20260204_add_intent_analytics.sql`
- `20260204_add_prompt_templates.sql`
- `add_insights_performance_indexes.sql`

**Excluded Migration** (do NOT apply):
- `20260127_add_user_documents_and_citations.sql` ❌

### Step 6: Backfill Data

```bash
# Backfill subsection metadata to Bedrock KB
node scripts/backfill-nvda-subsections.js

# Monitor sync status
node scripts/monitor-kb-sync-status.js
```

### Step 7: Run Smoke Tests

```bash
# Run automated smoke tests
./scripts/post-deployment-smoke-tests.sh

# Or manual tests:
```

#### Test 1: RAG Subsection Retrieval
```bash
curl -X POST https://YOUR_DOMAIN/api/rag/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"query": "Who are NVDA competitors?", "ticker": "NVDA"}'
```

#### Test 2: Research Assistant
- Navigate to: `https://YOUR_DOMAIN/app/research/index.html`
- Create a scratchpad item
- Verify export functionality

#### Test 3: Platform Admin
- Navigate to: `https://YOUR_DOMAIN/internal/platform-admin.html`
- Check Intent Analytics dashboard
- Verify metrics are loading

#### Test 4: Workspace Features
- Navigate to: `https://YOUR_DOMAIN/app/deals/workspace.html`
- Test anomaly detection
- Test comparative analysis
- Test change tracker

### Step 8: Monitor Production

Watch these metrics for the first 2 hours:

```bash
# CloudWatch Logs
aws logs tail /ecs/YOUR_LOG_GROUP --follow --filter-pattern "ERROR"

# Service health
watch -n 30 'aws ecs describe-services \
  --cluster YOUR_CLUSTER_NAME \
  --services YOUR_SERVICE_NAME \
  --region us-east-1 \
  --query "services[0].{running:runningCount,desired:desiredCount}"'
```

**Key Metrics to Watch**:
- Error rate (target: <1%)
- API latency (target: p95 <2s)
- Task health (all tasks running)
- Database connection pool usage

## Rollback Plan

If issues are detected:

### Quick Rollback
```bash
# Get previous task definition revision
aws ecs describe-task-definition \
  --task-definition YOUR_TASK_FAMILY:PREVIOUS_REVISION \
  --region us-east-1

# Update service to use previous revision
aws ecs update-service \
  --cluster YOUR_CLUSTER_NAME \
  --service YOUR_SERVICE_NAME \
  --task-definition YOUR_TASK_FAMILY:PREVIOUS_REVISION \
  --force-new-deployment \
  --region us-east-1
```

### Database Rollback (if needed)
```bash
# Revert specific migrations
npm run prisma:migrate:resolve --rolled-back MIGRATION_NAME
```

## Success Criteria

Deployment is successful when:

✅ All ECS tasks are running (desired = running)  
✅ No errors in CloudWatch logs  
✅ All smoke tests pass  
✅ API endpoints respond correctly  
✅ Frontend pages load without errors  
✅ Database migrations applied successfully  

## Testing URLs

Once deployed, test these URLs:

- **Dashboard**: `https://YOUR_DOMAIN/`
- **Deal Workspace**: `https://YOUR_DOMAIN/app/deals/workspace.html`
- **Research Assistant**: `https://YOUR_DOMAIN/app/research/index.html`
- **Platform Admin**: `https://YOUR_DOMAIN/internal/platform-admin.html`
- **Intent Analytics**: `https://YOUR_DOMAIN/internal/intent-analytics.html`

## What's New in This Deployment

### ✨ New Features
1. **RAG Phase 1 & 2** - Subsection-aware retrieval, intent detection
2. **Workspace Enhancements** - Anomaly detection, comparative tables
3. **Design System** - Consistent dark theme, better UX
4. **Intent Analytics Dashboard** - Monitor RAG performance

### ✅ Preserved Features
- All existing deal management functionality
- SEC data pipeline
- Financial analysis workspace
- Multi-tenancy and security
- Research assistant (basic scratchpad)

### ❌ Excluded (Not Yet Ready)
- Document upload in research assistant (will come in future release)
- Insights tab (intentionally removed)

## Support

If you encounter issues:

1. Check CloudWatch logs for errors
2. Verify all tasks are running
3. Check database connection
4. Review rollback plan above
5. Contact team if needed

---

**Prepared by**: Kiro AI Assistant  
**Date**: February 4, 2026, 1:14 PM EST  
**Status**: READY TO DEPLOY ✅
