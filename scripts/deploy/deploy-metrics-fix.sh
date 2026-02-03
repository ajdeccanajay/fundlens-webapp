#!/bin/bash
set -e

echo "🚀 Starting Production Deployment - Software Company Metrics Fix"
echo "================================================================="

# Configuration
CLUSTER="fundlens-cluster"
BLUE_SERVICE="fundlens-service-blue"
GREEN_SERVICE="fundlens-service-green"
BLUE_TG_ARN="arn:aws:elasticloadbalancing:us-east-1:ACCOUNT:targetgroup/fundlens-blue/xxx"
GREEN_TG_ARN="arn:aws:elasticloadbalancing:us-east-1:ACCOUNT:targetgroup/fundlens-green/xxx"

# Phase 1: Build & Push
echo "📦 Phase 1: Building and pushing images..."
./scripts/deploy/build-and-push.sh

# Phase 2: Deploy GREEN
echo "🟢 Phase 2: Deploying GREEN environment..."
aws ecs register-task-definition --cli-input-json file://scripts/deploy/updated-task-definition.json
aws ecs create-service --cluster $CLUSTER --service-name $GREEN_SERVICE \
  --task-definition fundlens-backend:LATEST --desired-count 2 \
  --load-balancers targetGroupArn=$GREEN_TG_ARN \
  --health-check-grace-period-seconds 60

echo "⏳ Waiting for GREEN to be healthy..."
aws ecs wait services-stable --cluster $CLUSTER --services $GREEN_SERVICE

# Phase 3: Canary
echo "🐤 Phase 3: Starting canary (10% traffic)..."
aws elbv2 modify-target-group --target-group-arn $GREEN_TG_ARN --weight 10
aws elbv2 modify-target-group --target-group-arn $BLUE_TG_ARN --weight 90

echo "📊 Monitoring canary for 10 minutes..."
sleep 600

# Check error rate
ERROR_COUNT=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_Target_5XX_Count \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 600 --statistics Sum --query 'Datapoints[0].Sum' --output text)

if [ "$ERROR_COUNT" != "0.0" ] && [ "$ERROR_COUNT" != "None" ]; then
  echo "❌ Canary failed - Rolling back"
  aws elbv2 modify-target-group --target-group-arn $BLUE_TG_ARN --weight 100
  aws elbv2 modify-target-group --target-group-arn $GREEN_TG_ARN --weight 0
  exit 1
fi

# Phase 4: Full Cutover
echo "✅ Canary successful - Full cutover..."
aws elbv2 modify-target-group --target-group-arn $GREEN_TG_ARN --weight 100
aws elbv2 modify-target-group --target-group-arn $BLUE_TG_ARN --weight 0

echo "⏳ Monitoring for 5 minutes..."
sleep 300

# Phase 5: Cleanup
echo "🧹 Phase 5: Scaling down BLUE..."
aws ecs update-service --cluster $CLUSTER --service $BLUE_SERVICE --desired-count 0

echo "✅ Deployment Complete!"
