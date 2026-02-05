# Deployment Troubleshooting Guide

## Common Deployment Issues and Solutions

### 1. ⚠️ Docker Platform Architecture Mismatch (MOST COMMON)

**Error:**
```
CannotPullContainerError: pull image manifest has been retried 7 time(s): 
image Manifest does not contain descriptor matching platform 'linux/amd64'
```

**Cause:**
- Docker images were built on Apple Silicon (M1/M2/M3 Mac) without specifying platform
- Images are ARM64 architecture, but AWS Fargate requires linux/amd64

**Solution:**
Always use `--platform linux/amd64` when building images:

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 588082972864.dkr.ecr.us-east-1.amazonaws.com

# Build and push backend (CORRECT WAY)
docker buildx build --platform linux/amd64 \
  -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-backend:prod-TAG \
  -f Dockerfile . --push

# Build and push Python parser (CORRECT WAY)
docker buildx build --platform linux/amd64 \
  -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-python-parser:prod-TAG \
  -f python_parser/Dockerfile ./python_parser --push
```

**Important:**
- Use `--push` (not `--load`) when building for different platforms
- Building for linux/amd64 on Apple Silicon takes longer (emulation)
- Verify images in ECR after pushing

---

### 2. Fargate vCPU Limit Reached

**Error:**
```
You've reached the limit on the number of vCPUs you can run concurrently.
```

**Cause:**
- AWS account has default Fargate vCPU limit (usually 8 vCPUs)
- Multiple tasks running across clusters exceed limit

**Solution:**

#### Check Current Usage:
```bash
# List all tasks across all clusters
aws ecs list-clusters --region us-east-1

# For each cluster, check running tasks
aws ecs list-tasks --cluster CLUSTER_NAME --region us-east-1

# Get vCPU allocation for each task
aws ecs describe-tasks --cluster CLUSTER_NAME --tasks TASK_ARN --region us-east-1 \
  --query 'tasks[*].{cpu:cpu,memory:memory,taskDefinitionArn:taskDefinitionArn}'
```

#### Request Quota Increase:
```bash
# Request increase from 8 to 16 vCPUs (or higher)
aws service-quotas request-service-quota-increase \
  --service-code fargate \
  --quota-code L-3032A538 \
  --desired-value 16 \
  --region us-east-1

# Check request status
aws service-quotas get-requested-service-quota-change \
  --request-id REQUEST_ID \
  --region us-east-1
```

#### Temporary Workaround:
Stop non-essential tasks to free vCPU capacity:

```bash
# Stop a task
aws ecs stop-task --cluster CLUSTER_NAME --task TASK_ID --region us-east-1
```

**Recommended vCPU Allocation:**
- Production app: 4 vCPUs (2.5 backend + 1.5 parser)
- Knowledge base: 2 vCPUs
- RDS: 2 vCPUs (separate service, not counted in Fargate quota)
- **Minimum quota needed: 16 vCPUs**
- **Comfortable quota: 32 vCPUs**

---

### 3. ECS Service Circuit Breaker Triggered

**Error:**
```
deployment failed: tasks failed to start
rolloutState: FAILED
rolloutStateReason: ECS deployment circuit breaker: tasks failed to start
```

**Cause:**
- Tasks failed to start multiple times (usually 3 failures)
- ECS automatically rolls back to previous version

**Solution:**

#### Check Task Failure Reason:
```bash
# List recent stopped tasks
aws ecs list-tasks --cluster CLUSTER_NAME --desired-status STOPPED --region us-east-1

# Get failure details
aws ecs describe-tasks --cluster CLUSTER_NAME --tasks TASK_ARN --region us-east-1 \
  --query 'tasks[0].{stoppedReason:stoppedReason,stopCode:stopCode,containers:containers[*].{name:name,reason:reason,exitCode:exitCode}}'
```

#### Common Causes:
1. **Platform mismatch** (see issue #1 above)
2. **vCPU limit** (see issue #2 above)
3. **Health check failures** (see issue #4 below)
4. **Environment variable issues** (see issue #5 below)

#### Reset Circuit Breaker:
After fixing the root cause, update the service again:

```bash
aws ecs update-service \
  --cluster CLUSTER_NAME \
  --service SERVICE_NAME \
  --task-definition TASK_FAMILY:REVISION \
  --force-new-deployment \
  --region us-east-1
```

---

### 4. Health Check Failures

**Error:**
Tasks start but immediately fail health checks and get replaced.

**Cause:**
- Application not responding on health check endpoint
- Health check timeout too short
- Database connection issues

**Solution:**

#### Check Health Check Configuration:
```bash
# View target group health checks
aws elbv2 describe-target-health \
  --target-group-arn TARGET_GROUP_ARN \
  --region us-east-1
```

#### Test Health Endpoint Manually:
```bash
# Get task private IP
aws ecs describe-tasks --cluster CLUSTER_NAME --tasks TASK_ARN --region us-east-1 \
  --query 'tasks[0].attachments[0].details[?name==`privateIPv4Address`].value' --output text

# Test from within VPC (use EC2 instance or Cloud9)
curl http://PRIVATE_IP:3000/api/health
```

#### Check Application Logs:
```bash
aws logs tail /ecs/fundlens-production/backend --follow --region us-east-1
```

#### Common Fixes:
- Increase health check grace period in task definition
- Verify DATABASE_URL environment variable is correct
- Check security group allows ALB to reach tasks on port 3000

---

### 5. Environment Variable Issues

**Error:**
Application crashes on startup with configuration errors.

**Cause:**
- Missing required environment variables
- Incorrect AWS Secrets Manager references
- Wrong database connection string

**Solution:**

#### Verify Environment Variables in Task Definition:
```bash
aws ecs describe-task-definition \
  --task-definition TASK_FAMILY:REVISION \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[*].{name:name,environment:environment,secrets:secrets}'
```

#### Check Secrets Manager:
```bash
# List secrets
aws secretsmanager list-secrets --region us-east-1

# Get secret value
aws secretsmanager get-secret-value \
  --secret-id fundlens/production/database \
  --region us-east-1 \
  --query 'SecretString' --output text
```

#### Required Environment Variables:
- `NODE_ENV=production`
- `DATABASE_URL` (from Secrets Manager)
- `AWS_REGION=us-east-1`
- `BEDROCK_KB_ID`
- `COGNITO_USER_POOL_ID`
- `COGNITO_CLIENT_ID`

---

### 6. Database Migration Failures

**Error:**
Migrations fail during deployment or application startup.

**Cause:**
- Database connection issues
- Migration conflicts
- Missing migration files

**Solution:**

#### Check Database Connectivity:
```bash
# Test from local machine (requires VPN or bastion)
psql "$DATABASE_URL"

# Or use Node script
node scripts/check-tables.js
```

#### Run Migrations Manually:
```bash
# From ECS task
aws ecs execute-command \
  --cluster CLUSTER_NAME \
  --task TASK_ID \
  --container backend \
  --interactive \
  --command "/bin/bash" \
  --region us-east-1

# Inside container
npm run prisma:migrate:deploy
```

#### Check Migration Status:
```bash
# List applied migrations
npm run prisma:migrate:status
```

---

### 7. CloudFront Cache Issues

**Error:**
Frontend shows old version after deployment.

**Cause:**
- CloudFront cache not invalidated
- Browser cache

**Solution:**

#### Invalidate CloudFront Cache:
```bash
aws cloudfront create-invalidation \
  --distribution-id DISTRIBUTION_ID \
  --paths "/*" \
  --region us-east-1
```

#### Check Invalidation Status:
```bash
aws cloudfront get-invalidation \
  --distribution-id DISTRIBUTION_ID \
  --id INVALIDATION_ID \
  --region us-east-1
```

#### Force Browser Refresh:
- Chrome/Firefox: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
- Safari: Cmd+Option+R

---

### 8. ALB Target Registration Issues

**Error:**
Tasks start but don't receive traffic.

**Cause:**
- Tasks not registered with target group
- Security group blocking ALB → Task communication
- Wrong port mapping

**Solution:**

#### Check Target Health:
```bash
aws elbv2 describe-target-health \
  --target-group-arn TARGET_GROUP_ARN \
  --region us-east-1
```

#### Verify Security Groups:
```bash
# Task security group must allow inbound from ALB security group on port 3000
aws ec2 describe-security-groups \
  --group-ids TASK_SG_ID \
  --region us-east-1
```

#### Check Service Configuration:
```bash
aws ecs describe-services \
  --cluster CLUSTER_NAME \
  --services SERVICE_NAME \
  --region us-east-1 \
  --query 'services[0].loadBalancers'
```

---

## Quick Diagnostic Commands

### Full System Health Check:
```bash
# 1. Check ECS service
aws ecs describe-services \
  --cluster fundlens-production \
  --services fundlens-production-service \
  --region us-east-1 \
  --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount,status:status}'

# 2. Check task health
aws ecs list-tasks --cluster fundlens-production --region us-east-1
aws ecs describe-tasks --cluster fundlens-production --tasks TASK_ARN --region us-east-1

# 3. Check ALB targets
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:588082972864:targetgroup/fundlens-production-tg/4e1c61b60055f46f \
  --region us-east-1

# 4. Check application logs
aws logs tail /ecs/fundlens-production/backend --follow --region us-east-1

# 5. Test API endpoint
curl https://app.fundlens.ai/api/health
```

### Rollback to Previous Version:
```bash
# Get previous task definition
aws ecs describe-task-definition \
  --task-definition fundlens-production:PREVIOUS_REVISION \
  --region us-east-1

# Update service
aws ecs update-service \
  --cluster fundlens-production \
  --service fundlens-production-service \
  --task-definition fundlens-production:PREVIOUS_REVISION \
  --force-new-deployment \
  --region us-east-1
```

---

## Prevention Checklist

Before every deployment:

- [ ] Build images with `--platform linux/amd64`
- [ ] Verify images in ECR after pushing
- [ ] Check Fargate vCPU quota and current usage
- [ ] Test database connectivity
- [ ] Review environment variables in task definition
- [ ] Run pre-flight checks: `bash scripts/deploy/pre-flight-check.sh`
- [ ] Have rollback plan ready
- [ ] Monitor CloudWatch logs during deployment

---

## Support Resources

- **Deployment Plan**: `DEPLOYMENT_PLAN_FEB_2026.md`
- **Deployment Execution**: `DEPLOYMENT_EXECUTION_FEB_2026.md`
- **Deployment Verification**: `DEPLOYMENT_VERIFICATION_FEB4.md`
- **AWS Documentation**: https://docs.aws.amazon.com/ecs/
- **CloudWatch Logs**: `/ecs/fundlens-production/*`

---

**Last Updated**: February 4, 2026
