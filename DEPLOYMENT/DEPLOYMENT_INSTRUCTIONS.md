# FundLens Production Deployment Instructions

## ✅ DEPLOYMENT COMPLETE - SYSTEM OPERATIONAL

**Production URL:** https://app.fundlens.ai
**Status:** All systems operational
**Last Updated:** January 20, 2026

## Infrastructure Status ✅

All AWS infrastructure has been successfully deployed:

| Stack | Status |
|-------|--------|
| fundlens-vpc-production | ✅ CREATE_COMPLETE |
| fundlens-sg-production | ✅ CREATE_COMPLETE |
| fundlens-secrets-production | ✅ CREATE_COMPLETE |
| fundlens-ecs-production | ✅ CREATE_COMPLETE |
| fundlens-alb-production | ✅ CREATE_COMPLETE |
| fundlens-frontend-production | ✅ CREATE_COMPLETE |
| fundlens-service-production | ✅ CREATE_COMPLETE |

## System Health ✅

### Backend (ECS Fargate)
- **Status:** ACTIVE
- **Running Tasks:** 2/2 healthy
- **Health Check:** ✅ Passing
- **Python Parser:** ✅ Healthy

### Database (RDS PostgreSQL)
- **Connection:** ✅ Connected
- **Tenants:** 1 (Default Tenant - Enterprise)
- **Users:** 2 (Cognito + TenantUser)
- **Deals:** 12
- **SEC Filings:** 1,153
- **Financial Metrics:** 105,034
- **Narrative Chunks:** 73,987

### Frontend (CloudFront + S3)
- **Distribution:** E2GDNAU8EH9JJ3
- **Status:** ✅ Deployed
- **HTTPS:** ✅ Enabled
- **Domain:** app.fundlens.ai

### Authentication (Cognito)
- **User Pool:** us-east-1_4OYqnpE18
- **Users:** 4 (3 confirmed, 1 pending password change)
- **Status:** ✅ Operational

## Verification Commands

### 1. Health Check
```bash
curl https://app.fundlens.ai/api/health
```

### 2. List Clients (Admin API)
```bash
curl "https://app.fundlens.ai/api/v1/internal/ops/clients" \
  -H "x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06"
```

### 3. Check ECS Service
```bash
aws ecs describe-services \
  --cluster fundlens-production \
  --services fundlens-production-service \
  --region us-east-1 \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'
```

### 4. Check Database
```bash
node scripts/check-production-data.js
```

## Access Information

### Production URLs
- **Main App:** https://app.fundlens.ai
- **API Health:** https://app.fundlens.ai/api/health
- **API Docs:** https://app.fundlens.ai/docs
- **Admin API:** https://app.fundlens.ai/api/v1/internal/ops/*

### Admin API Key
```
x-admin-key: c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06
```

### Cognito Users
- ajay.swamy@fundlens.ai (CONFIRMED)
- admin@fundlens-test.com (CONFIRMED)
- ajay.swamy+admin@fundlens.ai (CONFIRMED)
- ajay.swamy@gmail.com (FORCE_CHANGE_PASSWORD)

## Next Steps

### Optional: Deploy Monitoring Stack
```bash
aws cloudformation create-stack \
    --stack-name fundlens-monitoring-production \
    --template-body file://infrastructure/cloudformation/monitoring.yaml \
    --parameters \
        ParameterKey=Environment,ParameterValue=production \
        ParameterKey=ECSClusterStackName,ParameterValue=fundlens-ecs-production \
        ParameterKey=ECSServiceStackName,ParameterValue=fundlens-service-production \
        ParameterKey=ALBStackName,ParameterValue=fundlens-alb-production \
        ParameterKey=AlertEmail,ParameterValue=cloudwatchnotifications@fundlens.ai \
    --region us-east-1
```

### Update Frontend (if needed)
```bash
# Sync frontend files to S3
aws s3 sync public/ s3://fundlens-production-frontend/ \
    --delete \
    --cache-control "max-age=31536000" \
    --exclude "*.html" \
    --region us-east-1

# Sync HTML files with shorter cache
aws s3 sync public/ s3://fundlens-production-frontend/ \
    --exclude "*" \
    --include "*.html" \
    --cache-control "max-age=3600" \
    --region us-east-1

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
    --distribution-id E2GDNAU8EH9JJ3 \
    --paths "/*" \
    --region us-east-1
```

### Deploy New Backend Version

⚠️ **CRITICAL: ALWAYS BUILD FOR linux/amd64 PLATFORM**

AWS Fargate ONLY supports `linux/amd64`. Building on Apple Silicon without `--platform linux/amd64` will create ARM64 images that **FAIL** in Fargate with:
```
CannotPullContainerError: image Manifest does not contain descriptor matching platform 'linux/amd64'
```

```bash
# 1. Build and push new images
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 588082972864.dkr.ecr.us-east-1.amazonaws.com

# ✅ CORRECT: Build backend for linux/amd64 and push directly
docker buildx build --platform linux/amd64 \
  -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-backend:latest \
  -f Dockerfile . --push

# ✅ CORRECT: Build Python parser for linux/amd64 and push directly
docker buildx build --platform linux/amd64 \
  -t 588082972864.dkr.ecr.us-east-1.amazonaws.com/fundlens-python-parser:latest \
  -f python_parser/Dockerfile ./python_parser --push

# Note: Use --push (not --load) when building for different platforms
# This pushes directly to ECR without loading to local Docker

# 2. Force ECS service update
aws ecs update-service \
    --cluster fundlens-production \
    --service fundlens-production-service \
    --force-new-deployment \
    --region us-east-1
```

## Troubleshooting

### Check ECS Task Logs
```bash
# Backend logs
aws logs tail /ecs/fundlens-production/backend --follow --region us-east-1

# Python parser logs
aws logs tail /ecs/fundlens-production/python-parser --follow --region us-east-1
```

### Check ALB Target Health
```bash
aws elbv2 describe-target-health \
    --target-group-arn arn:aws:elasticloadbalancing:us-east-1:588082972864:targetgroup/fundlens-production-tg/4e1c61b60055f46f \
    --region us-east-1
```

### Test API Directly via ALB (bypass CloudFront)
```bash
curl -k "https://fundlens-production-alb-931926615.us-east-1.elb.amazonaws.com/api/health"
```

## Architecture Summary

```
Internet
    ↓
Route53 (app.fundlens.ai)
    ↓
CloudFront (E2GDNAU8EH9JJ3)
    ├─→ S3 (fundlens-production-frontend) - Static assets
    └─→ ALB (fundlens-production-alb) - /api/* requests
            ↓
        ECS Fargate (fundlens-production)
            ├─→ NestJS Backend (port 3000)
            └─→ Python Parser (port 8000)
                    ↓
                RDS PostgreSQL (fundlens-db)
                    ↓
                AWS Bedrock KB (NB5XNMHBQT)
```

## Support

For issues or questions:
- Check CloudWatch logs: `/ecs/fundlens-production/*`
- Review diagnostic report: `PRODUCTION_DIAGNOSTIC_REPORT.md`
- Run verification: `bash scripts/verify-production.sh`
