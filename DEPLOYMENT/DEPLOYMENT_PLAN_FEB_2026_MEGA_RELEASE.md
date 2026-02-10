# FundLens Mega Release Deployment Plan
## Jan 30 → Feb 9, 2026 — All Changes

> **Goal**: Deploy 11 days of accumulated changes (13+ changelogs) to production with zero downtime and zero data loss.

---

## RELEASE INVENTORY

### What's Being Deployed

| # | Feature Area | Key Changes | Risk |
|---|-------------|-------------|------|
| 1 | Insights Tab Redesign | Anomaly detection, comp tables, change tracker, hierarchy, performance indexes | Medium — new DB indexes |
| 2 | RAG Competitive Intelligence | Subsection-aware retrieval, intent detection, HyDE, reranker, query decomposition, prompt library | Low — additive services |
| 3 | Scratchpad Data Fix | Data loading fix + new scratchpad_items table | Low — data fix |
| 4 | IC Memo Streaming + Styling | SSE streaming for memo generation, investment-grade CSS | Low — frontend + streaming |
| 5 | Filing Notification UI | Bell icon, dropdown, polling, toast notifications | Low — frontend only |
| 6 | Automatic Filing Detection | Detector, scheduler, download, notifications, distributed lock, rate limiter | High — new module, cron, DB tables |
| 7 | Provocations Engine | Semantic change detection, sentiment analysis, contradiction detection | Medium — new module |
| 8 | Intent Analytics Dashboard | Admin dashboard for RAG performance monitoring | Low — admin only |

### Infrastructure Summary

- **Backend**: ~20 new/modified TypeScript services
- **Frontend**: workspace.html, 5+ CSS files (filing-notifications, ic-memo, workspace-enhancements, research-scratchpad, design-system)
- **Database**: 6+ new migrations since last deploy (Feb 4)
- **New Module**: `FilingsModule` with scheduler, detector, downloader, notification services
- **New Module**: Provocations engine with sentiment, contradiction, credibility services
- **No new AWS services required** (uses existing RDS, S3, Bedrock)
- **One optional env var**: `SEC_MAX_REQUESTS_PER_SECOND` (defaults to 9)

---

## DEPLOYMENT PHASES

```
Phase 0: Pre-Flight Checks (10 min)       ← Local validation
Phase 1: Database Migrations (5 min)       ← Safe, additive only
Phase 2: Backend Deploy (15-20 min)        ← Docker build + ECS update
Phase 3: Frontend Deploy (5 min)           ← S3 sync + CloudFront invalidation
Phase 4: Smoke Tests + Validation (10 min)
```

**Total estimated time: ~45 minutes**

---

## PHASE 0: PRE-FLIGHT CHECKS

```bash
# 1. Run existing pre-flight script
bash scripts/deploy/pre-flight-check.sh

# 2. Verify TypeScript compiles clean
npx tsc --noEmit

# 3. Run unit tests
npx jest --config ./test/jest-unit.json --no-coverage 2>&1 | tail -10

# 4. Verify build works
npm run build

# 5. Check AWS credentials
aws sts get-caller-identity --region us-east-1

# 6. Create git tag
git tag -a "production-feb-2026-v3.0.0-mega" -m "Mega release: Jan 30 - Feb 9 changes"
git push origin "production-feb-2026-v3.0.0-mega"
```

**CHECKPOINT**: All checks pass. Ready to proceed.

---

## PHASE 1: DATABASE MIGRATIONS

> All migrations are **additive** (new tables, new indexes, new columns). No destructive changes. Safe to run while old version serves traffic.

### New Migrations Since Feb 4 Deploy

These migrations need to be applied (the Feb 4 deploy already applied earlier ones):

| Migration | Description | Risk |
|-----------|-------------|------|
| `20260208_add_provocations_engine_schema.sql` | Provocations tables | Low |
| `add_filing_detection_tables.sql` | Filing detection state + notifications | Low |
| `add_metric_learning_log.sql` | Metric learning log table | Low |
| `add_insights_performance_indexes.sql` | Performance indexes (may already exist) | Low |

### Step 1.1: Connect to Production RDS

```bash
# Option A: Via ECS exec into running container
aws ecs execute-command \
  --cluster fundlens-production \
  --task $(aws ecs list-tasks --cluster fundlens-production --service fundlens-production-service --query 'taskArns[0]' --output text --region us-east-1) \
  --container backend \
  --interactive \
  --command "/bin/sh" \
  --region us-east-1

# Option B: Direct psql if you have RDS access
psql $DATABASE_URL
```

### Step 1.2: Apply Migrations

```bash
# Apply filing detection tables
psql $DATABASE_URL -f prisma/migrations/add_filing_detection_tables.sql

# Apply provocations engine schema
psql $DATABASE_URL -f prisma/migrations/20260208_add_provocations_engine_schema.sql

# Apply metric learning log
psql $DATABASE_URL -f prisma/migrations/add_metric_learning_log.sql

# Apply performance indexes (safe to re-run, uses IF NOT EXISTS)
psql $DATABASE_URL -f prisma/migrations/add_insights_performance_indexes.sql
```

### Step 1.3: Verify

```bash
# Check filing tables exist
psql $DATABASE_URL -c "\dt filing_*"
# Expected: filing_detection_state, filing_notifications

# Check provocations tables
psql $DATABASE_URL -c "\dt provocation*"

# Check indexes
psql $DATABASE_URL -c "\di" | grep -E "idx_filing|idx_insights"
```

**CHECKPOINT**: All tables and indexes exist. Old app version still running fine.

---

## PHASE 2: BACKEND DEPLOY

### Step 2.1: Build and Push Docker Images

**CRITICAL: MUST use `--platform linux/amd64` on Apple Silicon Mac**

```bash
# Set variables
export IMAGE_TAG="prod-mega-$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
export ECR_REPO="588082972864.dkr.ecr.us-east-1.amazonaws.com"

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_REPO

# Build and push backend (linux/amd64 for Fargate)
docker buildx build --platform linux/amd64 \
  -t $ECR_REPO/fundlens-backend:$IMAGE_TAG \
  -t $ECR_REPO/fundlens-backend:latest \
  -f Dockerfile . --push

# Build and push Python parser
docker buildx build --platform linux/amd64 \
  -t $ECR_REPO/fundlens-python-parser:$IMAGE_TAG \
  -t $ECR_REPO/fundlens-python-parser:latest \
  -f python_parser/Dockerfile ./python_parser --push

# Verify images in ECR
aws ecr describe-images --repository-name fundlens-backend --region us-east-1 \
  --query 'imageDetails | sort_by(@, &imagePushedAt) | [-1].{tag:imageTags[0],size:imageSizeInBytes,pushed:imagePushedAt}'
```

### Step 2.2: Update ECS Task Definition

```bash
# The existing task definition in scripts/deploy/updated-task-definition.json
# already has the correct structure. Just update image tags if needed.

# Register new task definition
aws ecs register-task-definition \
  --cli-input-json file://scripts/deploy/updated-task-definition.json \
  --region us-east-1

# Get the new revision
export NEW_REVISION=$(aws ecs describe-task-definition \
  --task-definition fundlens-production \
  --region us-east-1 \
  --query 'taskDefinition.revision' --output text)
echo "New task definition revision: $NEW_REVISION"
```

### Step 2.3: Rolling ECS Deployment

```bash
# Update service with rolling deployment (zero downtime)
aws ecs update-service \
  --cluster fundlens-production \
  --service fundlens-production-service \
  --task-definition fundlens-production:$NEW_REVISION \
  --force-new-deployment \
  --region us-east-1

# Monitor deployment (wait for stability)
echo "Waiting for ECS service to stabilize..."
aws ecs wait services-stable \
  --cluster fundlens-production \
  --services fundlens-production-service \
  --region us-east-1
echo "ECS deployment stable"
```

### Step 2.4: Verify Backend Health

```bash
# Check health endpoint
for i in {1..30}; do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' https://app.fundlens.ai/api/health --max-time 10)
  if [ "$STATUS" = "200" ]; then
    echo "Backend healthy after $i attempts"
    break
  fi
  echo "Waiting... ($i/30) - Status: $STATUS"
  sleep 10
done

# Check ECS task status
aws ecs describe-services \
  --cluster fundlens-production \
  --services fundlens-production-service \
  --region us-east-1 \
  --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount}'
```

**CHECKPOINT**: Backend running new code. Health check passes.

---

## PHASE 3: FRONTEND DEPLOY

### Step 3.1: Sync Static Assets to S3

```bash
# Sync all non-HTML files with long cache
aws s3 sync public/ s3://fundlens-production-frontend/ \
  --delete \
  --cache-control "max-age=31536000" \
  --exclude "*.html" \
  --exclude "*.md" \
  --exclude "LOGO_*" \
  --exclude "ICON_*" \
  --region us-east-1

# Sync HTML files with short cache
aws s3 sync public/ s3://fundlens-production-frontend/ \
  --exclude "*" \
  --include "*.html" \
  --cache-control "max-age=3600" \
  --region us-east-1

# Sync CSS with medium cache for quick iteration
aws s3 sync public/css/ s3://fundlens-production-frontend/css/ \
  --cache-control "max-age=300" \
  --region us-east-1
```

### Step 3.2: CloudFront Cache Invalidation

```bash
# Invalidate all changed paths
aws cloudfront create-invalidation \
  --distribution-id E2GDNAU8EH9JJ3 \
  --paths "/*" \
  --region us-east-1

# Wait for invalidation
INVALIDATION_ID=$(aws cloudfront list-invalidations \
  --distribution-id E2GDNAU8EH9JJ3 \
  --query 'InvalidationList.Items[0].Id' --output text \
  --region us-east-1)

echo "Waiting for CloudFront invalidation $INVALIDATION_ID..."
aws cloudfront wait invalidation-completed \
  --distribution-id E2GDNAU8EH9JJ3 \
  --id $INVALIDATION_ID \
  --region us-east-1
echo "CloudFront invalidation complete"
```

**CHECKPOINT**: Frontend serving new files.

---

## PHASE 4: SMOKE TESTS + VALIDATION

### Step 4.1: Automated Smoke Tests

```bash
# Run existing smoke test script
API_URL="https://app.fundlens.ai" bash scripts/post-deployment-smoke-tests.sh
```

### Step 4.2: Filing Detection System

```bash
# Verify filing notification endpoint exists
curl -s -o /dev/null -w '%{http_code}' \
  "https://app.fundlens.ai/api/filings/notifications?dismissed=false&limit=5"
# Expected: 200 (empty array is fine) or 401 (auth required — also fine)

# Check logs for filing scheduler initialization
aws logs filter-log-events \
  --log-group-name /ecs/fundlens-production/backend \
  --filter-pattern "FilingDetection" \
  --start-time $(date -v-10M +%s000) \
  --query 'events[*].message' --output text \
  --region us-east-1
```

### Step 4.3: Workspace UI Manual Check

```
1. Open https://app.fundlens.ai/app/deals/workspace.html?dealId=<test-deal>
2. Verify notification bell icon appears in header
3. Click bell → dropdown should appear (empty is fine)
4. Verify IC Memo tab styling looks correct (investment-grade)
5. Generate IC Memo → verify streaming progress updates appear
6. Verify Insights tab loads with anomaly detection, comp tables
7. Verify Research chat works with streaming
8. Check Scratchpad tab loads saved items
```

### Step 4.4: RAG System

```bash
# Test a RAG query (requires auth token)
curl -s -X POST https://app.fundlens.ai/api/deals/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dealId": "<test-deal-id>", "message": "What is the revenue?"}' | head -c 200
```

**CHECKPOINT**: All smoke tests pass. Production is live.

---

## ROLLBACK PLAN

### Backend Rollback (Quick — 5 min)

```bash
# Get previous task definition revision
PREV_REVISION=$((NEW_REVISION - 1))

aws ecs update-service \
  --cluster fundlens-production \
  --service fundlens-production-service \
  --task-definition fundlens-production:$PREV_REVISION \
  --force-new-deployment \
  --region us-east-1

aws ecs wait services-stable \
  --cluster fundlens-production \
  --services fundlens-production-service \
  --region us-east-1
```

### Database Rollback (Only if needed)

The new tables are additive — old code simply ignores them. No rollback needed for DB unless there's a specific issue.

```bash
# If you must drop the new tables:
psql $DATABASE_URL -c "DROP TABLE IF EXISTS filing_notifications CASCADE;"
psql $DATABASE_URL -c "DROP TABLE IF EXISTS filing_detection_state CASCADE;"
```

### Frontend Rollback

```bash
git checkout <previous-commit> -- public/
aws s3 sync public/ s3://fundlens-production-frontend/ --delete --region us-east-1
aws cloudfront create-invalidation --distribution-id E2GDNAU8EH9JJ3 --paths "/*" --region us-east-1
```

---

## RISK ASSESSMENT

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Filing cron fires on all containers | Low | Low | Distributed lock via pg_advisory_lock |
| New DB tables cause Prisma issues | Very Low | Medium | Tables are raw SQL, not in Prisma schema |
| RAG service regressions | Low | High | No RAG core changes, only additive services |
| Frontend CSS conflicts | Low | Low | Filing CSS uses `filing-notif-*` namespace |
| ECS rolling deploy fails | Low | Medium | Automatic rollback via ECS circuit breaker |
| IC Memo streaming breaks | Low | Medium | Non-streaming fallback still available |

---

## POST-DEPLOY CHECKLIST

- [ ] Phase 1: Database migrations applied and verified
- [ ] Phase 2: Docker images built with `--platform linux/amd64`
- [ ] Phase 2: ECS task definition updated
- [ ] Phase 2: ECS service stable (desired = running)
- [ ] Phase 2: Health check passing at app.fundlens.ai/api/health
- [ ] Phase 3: Frontend synced to S3
- [ ] Phase 3: CloudFront invalidated
- [ ] Phase 4: Automated smoke tests pass
- [ ] Phase 4: Filing notification API returns 200
- [ ] Phase 4: Workspace UI loads correctly
- [ ] Phase 4: Notification bell visible in header
- [ ] Phase 4: IC Memo generation works with streaming
- [ ] Phase 4: Insights tab loads
- [ ] Phase 4: RAG query returns answer
- [ ] Next day: Filing detection cron runs at 6 AM ET (check logs)
- [ ] Next day: Only one container runs cron (distributed lock)

---

## RECOMMENDED DEPLOYMENT WINDOW

**Best**: Weekday, 10 AM - 2 PM ET
- Users active → catch issues quickly
- Filing detection cron runs at 6 AM ET → won't interfere
- Full team available

**Alternative**: Weekend morning
- Apply DB migrations Friday evening
- Deploy backend + frontend Saturday morning
- Monitor through Monday 6 AM cron run

---

## METRICS TO MONITOR (First 24 Hours)

1. **ECS Task Health**: All tasks healthy, no restarts
2. **Error Rate**: CloudWatch error logs should not spike
3. **API Latency**: P95 should remain under 2s
4. **Filing Detection Cron**: First run at 6 AM ET — verify in logs
5. **Memory Usage**: New modules shouldn't increase memory significantly
6. **Database Connections**: Advisory locks use existing connections

```bash
# Monitor errors
aws logs tail /ecs/fundlens-production/backend --follow --filter-pattern "ERROR" --region us-east-1

# Monitor service health
watch -n 30 'aws ecs describe-services \
  --cluster fundlens-production \
  --services fundlens-production-service \
  --region us-east-1 \
  --query "services[0].{running:runningCount,desired:desiredCount}"'
```
