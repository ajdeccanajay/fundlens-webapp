# 🚀 FundLens Deployment Quick Start

**⚠️ BEFORE YOU DEPLOY: Read this first!**

## 📁 All Deployment Documentation is in `/DEPLOYMENT` folder

**DO NOT DELETE THE DEPLOYMENT FOLDER**

## 🚨 Most Critical Issue: Docker Platform Architecture

If you're deploying from a Mac (M1/M2/M3), you **MUST** build Docker images with `--platform linux/amd64`:

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

**Without `--platform linux/amd64`, your deployment WILL FAIL in AWS Fargate!**

## 📚 Deployment Documents

Navigate to the `/DEPLOYMENT` folder and read:

1. **[DEPLOYMENT/README.md](./DEPLOYMENT/README.md)** - Start here for overview
2. **[DEPLOYMENT/DEPLOYMENT_PLAN_FEB_2026.md](./DEPLOYMENT/DEPLOYMENT_PLAN_FEB_2026.md)** - What's being deployed
3. **[DEPLOYMENT/DEPLOYMENT_EXECUTION_FEB_2026.md](./DEPLOYMENT/DEPLOYMENT_EXECUTION_FEB_2026.md)** - Step-by-step guide
4. **[DEPLOYMENT/DEPLOYMENT_TROUBLESHOOTING.md](./DEPLOYMENT/DEPLOYMENT_TROUBLESHOOTING.md)** - When things go wrong

## ⚡ Quick Deployment Steps

1. **Read the plan**: `DEPLOYMENT/DEPLOYMENT_PLAN_FEB_2026.md`
2. **Build images correctly**: Use `--platform linux/amd64`
3. **Push to ECR**: Verify images are there
4. **Deploy to ECS**: Follow execution guide
5. **Run migrations**: Apply database changes
6. **Smoke test**: Verify everything works
7. **Monitor**: Watch logs for 2 hours

## 🆘 If Deployment Fails

1. Open `DEPLOYMENT/DEPLOYMENT_TROUBLESHOOTING.md`
2. Find your error message
3. Follow the solution steps
4. If still stuck, rollback using the guide

## 📞 Need Help?

All documentation is in `/DEPLOYMENT` folder. Start with the README.md there.

---

**Remember**: Always build with `--platform linux/amd64` on Mac!
