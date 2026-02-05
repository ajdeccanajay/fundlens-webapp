# Production Deployment Checklist

Use this checklist for every production deployment to ensure nothing is missed.

## Pre-Deployment (1-2 days before)

### Planning
- [ ] Read `DEPLOYMENT_PLAN_FEB_2026.md` completely
- [ ] Review what features are being deployed
- [ ] Review what features are excluded
- [ ] Identify database migrations to be applied
- [ ] Review `DEPLOYMENT_VERIFICATION_FEB4.md` for breaking changes
- [ ] Schedule deployment window (low-traffic time)
- [ ] Notify team of deployment schedule

### Infrastructure Check
- [ ] Check current Fargate vCPU usage
- [ ] Verify vCPU quota is sufficient (need 16+ vCPUs)
- [ ] Check RDS database status (db.t3.small, 2 vCPU, 2GB RAM)
- [ ] Verify ECS cluster health
- [ ] Check CloudWatch logs for existing errors
- [ ] Verify S3 bucket access
- [ ] Check ECR repository access

### Code Preparation
- [ ] All code changes committed to git
- [ ] Create git tag: `production-YYYY-MM-DD-vX.X.X`
- [ ] Run local tests: `npm test`
- [ ] Run pre-flight checks: `bash scripts/deploy/pre-flight-check.sh`
- [ ] Review environment variables in `.env.production.example`

## Deployment Day

### Step 1: Build Docker Images (CRITICAL)

**⚠️ MUST USE --platform linux/amd64 ON MAC**

- [ ] Login to ECR:
  ```bash
  aws ecr get-login-password --region us-east-1 | \
    docker login --username AWS --password-stdin 588082972864.dkr.ecr.us-east-1.amazonaws.com
  ```

- [ ] Build backend image with correct platform:
  ```bash
  docker buildx build --platform linux/amd64 \
    -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-backend:prod-TAG \
    -f Dockerfile . --push
  ```

- [ ] Build Python parser image with correct platform:
  ```bash
  docker buildx build --platform linux/amd64 \
    -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-python-parser:prod-TAG \
    -f python_parser/Dockerfile ./python_parser --push
  ```

- [ ] Verify images in ECR:
  ```bash
  aws ecr describe-images --repository-name fundlens-backend --region us-east-1
  aws ecr describe-images --repository-name fundlens-python-parser --region us-east-1
  ```

- [ ] Verify image platform is linux/amd64 (not ARM64)

### Step 2: Update ECS Task Definition

- [ ] Get current task definition:
  ```bash
  aws ecs describe-task-definition \
    --task-definition fundlens-production \
    --region us-east-1 > /tmp/current-task-def.json
  ```

- [ ] Create new task definition with updated image URIs
- [ ] Review environment variables
- [ ] Review resource allocation (4 vCPU, 8GB RAM recommended)
- [ ] Register new task definition:
  ```bash
  aws ecs register-task-definition \
    --cli-input-json file:///tmp/new-task-def.json \
    --region us-east-1
  ```

- [ ] Note new task definition revision number

### Step 3: Deploy to ECS

- [ ] Update ECS service:
  ```bash
  aws ecs update-service \
    --cluster fundlens-production \
    --service fundlens-production-service \
    --task-definition fundlens-production:NEW_REVISION \
    --force-new-deployment \
    --region us-east-1
  ```

- [ ] Monitor deployment:
  ```bash
  aws ecs describe-services \
    --cluster fundlens-production \
    --services fundlens-production-service \
    --region us-east-1 \
    --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount}'
  ```

- [ ] Wait for new tasks to start (5-10 minutes)
- [ ] Verify tasks are RUNNING
- [ ] Check task health status

### Step 4: Verify Deployment

- [ ] Check CloudWatch logs for errors:
  ```bash
  aws logs tail /ecs/fundlens-production/backend --follow --region us-east-1
  ```

- [ ] Verify ALB target health:
  ```bash
  aws elbv2 describe-target-health \
    --target-group-arn arn:aws:elasticloadbalancing:us-east-1:588082972864:targetgroup/fundlens-production-tg/4e1c61b60055f46f \
    --region us-east-1
  ```

- [ ] Test health endpoint:
  ```bash
  curl https://app.fundlens.ai/api/health
  ```

- [ ] Verify response is 200 OK

### Step 5: Database Migrations

- [ ] Connect to ECS task:
  ```bash
  aws ecs execute-command \
    --cluster fundlens-production \
    --task TASK_ID \
    --container backend \
    --interactive \
    --command "/bin/bash" \
    --region us-east-1
  ```

- [ ] Run migrations:
  ```bash
  npm run prisma:migrate:deploy
  ```

- [ ] Verify migrations applied successfully
- [ ] Check migration status:
  ```bash
  npm run prisma:migrate:status
  ```

### Step 6: Data Backfill (if needed)

- [ ] Run backfill scripts:
  ```bash
  node scripts/backfill-nvda-subsections.js
  ```

- [ ] Monitor backfill progress
- [ ] Verify data in database

### Step 7: Smoke Tests

Run all smoke tests from `scripts/post-deployment-smoke-tests.sh`:

- [ ] Test 1: Health endpoint responds
- [ ] Test 2: Authentication works
- [ ] Test 3: Deal workspace loads
- [ ] Test 4: Research assistant loads
- [ ] Test 5: Platform admin loads
- [ ] Test 6: RAG query works
- [ ] Test 7: Financial data displays correctly
- [ ] Test 8: Export functionality works

### Step 8: Frontend Deployment (if needed)

- [ ] Sync frontend to S3:
  ```bash
  aws s3 sync public/ s3://fundlens-production-frontend/ \
    --delete --cache-control "max-age=31536000" \
    --exclude "*.html" --region us-east-1
  ```

- [ ] Sync HTML files:
  ```bash
  aws s3 sync public/ s3://fundlens-production-frontend/ \
    --exclude "*" --include "*.html" \
    --cache-control "max-age=3600" --region us-east-1
  ```

- [ ] Invalidate CloudFront cache:
  ```bash
  aws cloudfront create-invalidation \
    --distribution-id E2GDNAU8EH9JJ3 \
    --paths "/*" --region us-east-1
  ```

- [ ] Wait for invalidation to complete (5-10 minutes)
- [ ] Test frontend pages load correctly

## Post-Deployment (First 2 hours)

### Monitoring

- [ ] Watch CloudWatch logs for errors:
  ```bash
  aws logs tail /ecs/fundlens-production/backend --follow --filter-pattern "ERROR" --region us-east-1
  ```

- [ ] Monitor ECS service health:
  ```bash
  watch -n 30 'aws ecs describe-services \
    --cluster fundlens-production \
    --services fundlens-production-service \
    --region us-east-1 \
    --query "services[0].{running:runningCount,desired:desiredCount}"'
  ```

- [ ] Check error rate (target: <1%)
- [ ] Check API latency (target: p95 <2s)
- [ ] Verify all tasks remain healthy
- [ ] Monitor database connection pool usage

### User Testing

- [ ] Test login flow
- [ ] Test deal creation
- [ ] Test financial data display
- [ ] Test RAG queries
- [ ] Test research assistant
- [ ] Test export functionality
- [ ] Test workspace features

### Metrics to Watch

- [ ] Error rate < 1%
- [ ] API latency p95 < 2s
- [ ] All ECS tasks running (desired = running)
- [ ] No errors in CloudWatch logs
- [ ] Database connections stable
- [ ] Memory usage normal
- [ ] CPU usage normal

## Rollback (If Issues Detected)

If any critical issues are found:

- [ ] Stop monitoring
- [ ] Identify issue in `DEPLOYMENT_TROUBLESHOOTING.md`
- [ ] If unfixable, initiate rollback:
  ```bash
  aws ecs update-service \
    --cluster fundlens-production \
    --service fundlens-production-service \
    --task-definition fundlens-production:PREVIOUS_REVISION \
    --force-new-deployment \
    --region us-east-1
  ```

- [ ] Monitor rollback completion
- [ ] Verify old version is working
- [ ] Document issue for future reference
- [ ] Plan fix for next deployment

## Post-Deployment (Next Day)

### Verification

- [ ] Check overnight logs for errors
- [ ] Verify all features working
- [ ] Check user feedback
- [ ] Review metrics from past 24 hours

### Documentation

- [ ] Update deployment log with results
- [ ] Document any issues encountered
- [ ] Update `DEPLOYMENT_TROUBLESHOOTING.md` if new issues found
- [ ] Update team on deployment status

### Cleanup

- [ ] Remove old Docker images from ECR (keep last 3)
- [ ] Archive old task definitions (keep last 5)
- [ ] Update deployment documentation if process changed

## Success Criteria

Deployment is successful when:

- ✅ All ECS tasks are running (desired = running)
- ✅ No errors in CloudWatch logs
- ✅ All smoke tests pass
- ✅ API endpoints respond correctly
- ✅ Frontend pages load without errors
- ✅ Database migrations applied successfully
- ✅ No increase in error rate
- ✅ API latency within acceptable range
- ✅ User testing passes
- ✅ No rollback required

---

**Remember**: Always build with `--platform linux/amd64` on Mac!

**Last Updated**: February 4, 2026
