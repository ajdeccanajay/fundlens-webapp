# FundLens Production Deployment Guide

**⚠️ CRITICAL: DO NOT DELETE THIS FOLDER**

This folder contains all essential documentation for deploying FundLens to production. Always refer to these documents before any deployment.

## 📁 Folder Contents

### Core Deployment Documents

1. **[DEPLOYMENT_PLAN_FEB_2026.md](./DEPLOYMENT_PLAN_FEB_2026.md)**
   - Complete deployment plan and strategy
   - What's included/excluded in the deployment
   - Feature breakdown and verification checklist
   - Database migration plan
   - **Use this**: Before planning any deployment

2. **[DEPLOYMENT_EXECUTION_FEB_2026.md](./DEPLOYMENT_EXECUTION_FEB_2026.md)**
   - Step-by-step execution guide
   - **⚠️ CRITICAL**: Docker platform architecture warnings
   - Deployment commands and procedures
   - Smoke test procedures
   - Rollback procedures
   - **Use this**: During actual deployment execution

3. **[DEPLOYMENT_VERIFICATION_FEB4.md](./DEPLOYMENT_VERIFICATION_FEB4.md)**
   - Verification that no functionality is lost
   - Feature preservation checklist
   - Breaking changes analysis
   - **Use this**: To verify deployment safety

4. **[DEPLOYMENT_TROUBLESHOOTING.md](./DEPLOYMENT_TROUBLESHOOTING.md)**
   - Common deployment issues and solutions
   - Docker platform architecture mismatch (MOST COMMON)
   - Fargate vCPU limits
   - ECS circuit breaker issues
   - Health check failures
   - Quick diagnostic commands
   - **Use this**: When deployment fails or issues occur

5. **[DEPLOYMENT_INSTRUCTIONS.md](./DEPLOYMENT_INSTRUCTIONS.md)**
   - General deployment instructions
   - Infrastructure status
   - Verification commands
   - Access information
   - **Use this**: For reference and general procedures

## 🚨 Critical Warnings

### 1. Docker Platform Architecture (MOST IMPORTANT)

**ALWAYS BUILD FOR linux/amd64 PLATFORM**

AWS Fargate ONLY supports `linux/amd64`. Building on Apple Silicon (M1/M2/M3 Mac) without `--platform linux/amd64` will create ARM64 images that **FAIL** in Fargate.

**Error you'll see:**
```
CannotPullContainerError: image Manifest does not contain descriptor matching platform 'linux/amd64'
```

**Correct build commands:**
```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 588082972864.dkr.ecr.us-east-1.amazonaws.com

# Build backend (CORRECT)
docker buildx build --platform linux/amd64 \
  -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-backend:prod-TAG \
  -f Dockerfile . --push

# Build Python parser (CORRECT)
docker buildx build --platform linux/amd64 \
  -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-python-parser:prod-TAG \
  -f python_parser/Dockerfile ./python_parser --push
```

**Key points:**
- Use `--push` (not `--load`) when building for different platforms
- This pushes directly to ECR without loading to local Docker
- Building for linux/amd64 on Apple Silicon takes longer (emulation)

### 2. Fargate vCPU Limits

Default AWS account limit: **8 vCPUs**

**Recommended allocation:**
- Production app: 4 vCPUs (2.5 backend + 1.5 parser)
- Knowledge base: 2 vCPUs
- RDS: 2 vCPUs (separate service, not counted in Fargate quota)
- **Minimum quota needed: 16 vCPUs**
- **Comfortable quota: 32 vCPUs**

**Request quota increase:**
```bash
aws service-quotas request-service-quota-increase \
  --service-code fargate \
  --quota-code L-3032A538 \
  --desired-value 16 \
  --region us-east-1
```

## 📋 Pre-Deployment Checklist

Before every deployment, verify:

- [ ] Build images with `--platform linux/amd64`
- [ ] Verify images in ECR after pushing
- [ ] Check Fargate vCPU quota and current usage
- [ ] Test database connectivity
- [ ] Review environment variables in task definition
- [ ] Run pre-flight checks: `bash scripts/deploy/pre-flight-check.sh`
- [ ] Have rollback plan ready
- [ ] Review what's included/excluded in deployment

## 🔄 Deployment Workflow

### 1. Planning Phase
Read: `DEPLOYMENT_PLAN_FEB_2026.md`
- Understand what's being deployed
- Review feature changes
- Check database migrations

### 2. Verification Phase
Read: `DEPLOYMENT_VERIFICATION_FEB4.md`
- Verify no functionality is lost
- Check for breaking changes

### 3. Execution Phase
Read: `DEPLOYMENT_EXECUTION_FEB_2026.md`
- Follow step-by-step instructions
- Build Docker images correctly
- Deploy to ECS
- Run database migrations
- Execute smoke tests

### 4. Troubleshooting Phase (if needed)
Read: `DEPLOYMENT_TROUBLESHOOTING.md`
- Diagnose issues
- Apply fixes
- Rollback if necessary

## 🛠️ Quick Reference Commands

### Check Deployment Status
```bash
# ECS service status
aws ecs describe-services \
  --cluster fundlens-production \
  --services fundlens-production-service \
  --region us-east-1 \
  --query 'services[0].{desired:desiredCount,running:runningCount,status:status}'

# Check task health
aws ecs list-tasks --cluster fundlens-production --region us-east-1

# Check logs
aws logs tail /ecs/fundlens-production/backend --follow --region us-east-1
```

### Rollback
```bash
# Update service to previous task definition
aws ecs update-service \
  --cluster fundlens-production \
  --service fundlens-production-service \
  --task-definition fundlens-production:PREVIOUS_REVISION \
  --force-new-deployment \
  --region us-east-1
```

## 📞 Support

If you encounter issues:

1. Check `DEPLOYMENT_TROUBLESHOOTING.md` first
2. Review CloudWatch logs: `/ecs/fundlens-production/*`
3. Check ECS service events
4. Verify task definition configuration
5. Review security groups and networking

## 🔐 AWS Resources

- **Region**: us-east-1
- **Account ID**: 588082972864
- **ECS Cluster**: fundlens-production
- **ECS Service**: fundlens-production-service
- **RDS Instance**: db.t3.small (2 vCPU, 2GB RAM)
- **ECR Repositories**:
  - fundlens-backend
  - fundlens-python-parser
- **CloudFront Distribution**: E2GDNAU8EH9JJ3
- **Domain**: app.fundlens.ai

## 📝 Document Maintenance

When updating deployment documentation:

1. Always update the relevant document in this folder
2. Keep the README.md in sync
3. Document any new issues in DEPLOYMENT_TROUBLESHOOTING.md
4. Update version numbers and dates
5. Never delete historical deployment records

---

**Last Updated**: February 4, 2026  
**Maintained By**: FundLens Engineering Team
