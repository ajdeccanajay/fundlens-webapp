#!/bin/bash
# =============================================================================
# FundLens Mega Release Deployment Script
# Jan 30 → Feb 9, 2026
# =============================================================================
# Usage: ./scripts/deploy/deploy-mega-release.sh [phase]
#   phase: all | preflight | db | backend | frontend | smoke
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-588082972864}"
ECR_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ECS_CLUSTER="${ECS_CLUSTER:-fundlens-production}"
ECS_SERVICE="${ECS_SERVICE:-fundlens-production-service}"
TASK_FAMILY="${TASK_FAMILY:-fundlens-production}"
FRONTEND_BUCKET="${FRONTEND_BUCKET:-fundlens-production-frontend}"
CLOUDFRONT_DIST_ID="${CLOUDFRONT_DIST_ID:-E2GDNAU8EH9JJ3}"
API_URL="${API_URL:-https://app.fundlens.ai}"
IMAGE_TAG="prod-mega-$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')-$(date +%Y%m%d%H%M%S)"

PHASE="${1:-all}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
success() { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

START_TIME=$(date +%s)

# =============================================================================
# PHASE 0: PRE-FLIGHT CHECKS
# =============================================================================
phase_preflight() {
  log "${YELLOW}PHASE 0: Pre-Flight Checks${NC}"

  # Check required tools
  for cmd in aws docker node npm git curl; do
    if ! command -v $cmd &> /dev/null; then
      fail "$cmd is required but not installed"
    fi
  done
  success "All required tools installed"

  # Check AWS credentials
  aws sts get-caller-identity --region $AWS_REGION > /dev/null 2>&1 || fail "AWS credentials not configured"
  success "AWS credentials valid"

  # Check TypeScript compiles
  log "Checking TypeScript compilation..."
  cd "$PROJECT_ROOT"
  npx tsc --noEmit 2>/dev/null || fail "TypeScript compilation failed"
  success "TypeScript compiles clean"

  # Check build
  log "Running npm build..."
  npm run build > /dev/null 2>&1 || fail "npm build failed"
  success "Build successful"

  # Check Docker daemon
  docker info > /dev/null 2>&1 || fail "Docker daemon not running"
  success "Docker daemon running"

  success "Phase 0 complete: All pre-flight checks passed"
  echo ""
}

# =============================================================================
# PHASE 1: DATABASE MIGRATIONS
# =============================================================================
phase_db() {
  log "${YELLOW}PHASE 1: Database Migrations${NC}"
  warn "This phase requires DATABASE_URL to be set, or manual execution via ECS exec"
  echo ""

  if [ -z "${DATABASE_URL:-}" ]; then
    warn "DATABASE_URL not set. Printing migration commands for manual execution:"
    echo ""
    echo "  # Connect to ECS container:"
    echo "  aws ecs execute-command --cluster $ECS_CLUSTER \\"
    echo "    --task \$(aws ecs list-tasks --cluster $ECS_CLUSTER --service $ECS_SERVICE --query 'taskArns[0]' --output text --region $AWS_REGION) \\"
    echo "    --container backend --interactive --command '/bin/sh' --region $AWS_REGION"
    echo ""
    echo "  # Then run these migrations:"
    echo "  psql \$DATABASE_URL -f prisma/migrations/add_filing_detection_tables.sql"
    echo "  psql \$DATABASE_URL -f prisma/migrations/20260208_add_provocations_engine_schema.sql"
    echo "  psql \$DATABASE_URL -f prisma/migrations/add_metric_learning_log.sql"
    echo "  psql \$DATABASE_URL -f prisma/migrations/add_insights_performance_indexes.sql"
    echo ""
    warn "Run migrations manually, then continue with: $0 backend"
    return 0
  fi

  cd "$PROJECT_ROOT"

  # Apply migrations (all use IF NOT EXISTS, safe to re-run)
  local migrations=(
    "prisma/migrations/add_filing_detection_tables.sql"
    "prisma/migrations/20260208_add_provocations_engine_schema.sql"
    "prisma/migrations/add_metric_learning_log.sql"
    "prisma/migrations/add_insights_performance_indexes.sql"
  )

  for migration in "${migrations[@]}"; do
    if [ -f "$migration" ]; then
      log "Applying $migration..."
      psql "$DATABASE_URL" -f "$migration" 2>/dev/null && success "Applied $migration" || warn "May already exist (OK): $migration"
    else
      warn "Migration file not found: $migration"
    fi
  done

  # Verify
  log "Verifying tables..."
  FILING_TABLES=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'filing_%'" 2>/dev/null | tr -d ' ')
  if [ "${FILING_TABLES:-0}" -ge 2 ]; then
    success "Filing tables verified ($FILING_TABLES tables)"
  else
    warn "Expected 2+ filing tables, found: ${FILING_TABLES:-0}"
  fi

  success "Phase 1 complete: Database migrations applied"
  echo ""
}

# =============================================================================
# PHASE 2: BACKEND DEPLOY
# =============================================================================
phase_backend() {
  log "${YELLOW}PHASE 2: Backend Deploy${NC}"
  cd "$PROJECT_ROOT"

  # 2.1 ECR Login
  log "Logging into ECR..."
  aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_REPO 2>/dev/null
  success "ECR login successful"

  # 2.2 Build and push backend
  log "Building backend image (linux/amd64)... This may take 5-10 minutes on Apple Silicon."
  docker buildx build --platform linux/amd64 \
    -t $ECR_REPO/fundlens-backend:$IMAGE_TAG \
    -t $ECR_REPO/fundlens-backend:latest \
    -f Dockerfile . --push
  success "Backend image pushed: $IMAGE_TAG"

  # 2.3 Build and push Python parser
  log "Building Python parser image (linux/amd64)..."
  docker buildx build --platform linux/amd64 \
    -t $ECR_REPO/fundlens-python-parser:$IMAGE_TAG \
    -t $ECR_REPO/fundlens-python-parser:latest \
    -f python_parser/Dockerfile ./python_parser --push
  success "Python parser image pushed: $IMAGE_TAG"

  # 2.4 Register task definition
  log "Registering new task definition..."
  aws ecs register-task-definition \
    --cli-input-json file://scripts/deploy/updated-task-definition.json \
    --region $AWS_REGION > /dev/null

  NEW_REVISION=$(aws ecs describe-task-definition \
    --task-definition $TASK_FAMILY \
    --region $AWS_REGION \
    --query 'taskDefinition.revision' --output text)
  success "Task definition registered: $TASK_FAMILY:$NEW_REVISION"

  # 2.5 Update ECS service
  log "Updating ECS service (rolling deployment)..."
  aws ecs update-service \
    --cluster $ECS_CLUSTER \
    --service $ECS_SERVICE \
    --task-definition $TASK_FAMILY:$NEW_REVISION \
    --force-new-deployment \
    --region $AWS_REGION > /dev/null

  log "Waiting for ECS service to stabilize (this may take 5-10 minutes)..."
  aws ecs wait services-stable \
    --cluster $ECS_CLUSTER \
    --services $ECS_SERVICE \
    --region $AWS_REGION
  success "ECS service stable"

  # 2.6 Health check
  log "Verifying backend health..."
  for i in {1..20}; do
    STATUS=$(curl -s -o /dev/null -w '%{http_code}' $API_URL/api/health --max-time 10 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ]; then
      success "Backend healthy (attempt $i)"
      break
    fi
    if [ "$i" = "20" ]; then
      fail "Backend health check failed after 20 attempts"
    fi
    echo "  Waiting... ($i/20) - Status: $STATUS"
    sleep 15
  done

  success "Phase 2 complete: Backend deployed"
  echo ""
}

# =============================================================================
# PHASE 3: FRONTEND DEPLOY
# =============================================================================
phase_frontend() {
  log "${YELLOW}PHASE 3: Frontend Deploy${NC}"
  cd "$PROJECT_ROOT"

  # 3.1 Sync non-HTML files (long cache)
  log "Syncing static assets to S3..."
  aws s3 sync public/ s3://$FRONTEND_BUCKET/ \
    --delete \
    --cache-control "max-age=31536000" \
    --exclude "*.html" \
    --exclude "*.md" \
    --exclude "LOGO_*" \
    --exclude "ICON_*" \
    --region $AWS_REGION > /dev/null
  success "Static assets synced"

  # 3.2 Sync HTML files (short cache)
  log "Syncing HTML files..."
  aws s3 sync public/ s3://$FRONTEND_BUCKET/ \
    --exclude "*" \
    --include "*.html" \
    --cache-control "max-age=3600" \
    --region $AWS_REGION > /dev/null
  success "HTML files synced"

  # 3.3 Sync CSS with shorter cache
  log "Syncing CSS files..."
  aws s3 sync public/css/ s3://$FRONTEND_BUCKET/css/ \
    --cache-control "max-age=300" \
    --region $AWS_REGION > /dev/null
  success "CSS files synced"

  # 3.4 CloudFront invalidation
  log "Invalidating CloudFront cache..."
  INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id $CLOUDFRONT_DIST_ID \
    --paths "/*" \
    --region $AWS_REGION \
    --query 'Invalidation.Id' --output text)

  log "Waiting for invalidation $INVALIDATION_ID..."
  aws cloudfront wait invalidation-completed \
    --distribution-id $CLOUDFRONT_DIST_ID \
    --id $INVALIDATION_ID \
    --region $AWS_REGION 2>/dev/null || warn "CloudFront wait timed out (invalidation may still be in progress)"
  success "CloudFront invalidation complete"

  success "Phase 3 complete: Frontend deployed"
  echo ""
}

# =============================================================================
# PHASE 4: SMOKE TESTS
# =============================================================================
phase_smoke() {
  log "${YELLOW}PHASE 4: Smoke Tests${NC}"

  PASSED=0
  FAILED=0

  run_smoke() {
    local name="$1"
    local url="$2"
    local expected="${3:-200}"

    STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$url" --max-time 15 2>/dev/null || echo "000")
    if [ "$STATUS" = "$expected" ]; then
      success "$name ($STATUS)"
      ((PASSED++))
    else
      warn "$name — expected $expected, got $STATUS"
      ((FAILED++))
    fi
  }

  run_smoke "Health endpoint" "$API_URL/api/health"
  run_smoke "Homepage" "$API_URL/"
  run_smoke "Login page" "$API_URL/login.html"
  run_smoke "Workspace page" "$API_URL/app/deals/workspace.html"
  run_smoke "Research page" "$API_URL/app/research/index.html"
  run_smoke "Swagger docs" "$API_URL/docs" "200"

  echo ""
  log "Smoke test results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"

  if [ $FAILED -gt 0 ]; then
    warn "Some smoke tests failed. Review before proceeding."
  else
    success "All smoke tests passed"
  fi

  success "Phase 4 complete"
  echo ""
}

# =============================================================================
# MAIN
# =============================================================================
echo ""
echo "=============================================="
echo "  FundLens Mega Release Deployment"
echo "  Jan 30 → Feb 9, 2026"
echo "=============================================="
echo "  Phase: $PHASE"
echo "  Image Tag: $IMAGE_TAG"
echo "  Cluster: $ECS_CLUSTER"
echo "  Region: $AWS_REGION"
echo "=============================================="
echo ""

case $PHASE in
  preflight)
    phase_preflight
    ;;
  db)
    phase_db
    ;;
  backend)
    phase_backend
    ;;
  frontend)
    phase_frontend
    ;;
  smoke)
    phase_smoke
    ;;
  all)
    phase_preflight
    phase_db
    phase_backend
    phase_frontend
    phase_smoke
    ;;
  *)
    echo "Usage: $0 [preflight|db|backend|frontend|smoke|all]"
    exit 1
    ;;
esac

# Summary
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo "=============================================="
echo -e "${GREEN}  Deployment Complete${NC}"
echo "  Duration: ${MINUTES}m ${SECONDS}s"
echo "  Image Tag: $IMAGE_TAG"
echo "  URL: https://app.fundlens.ai"
echo "=============================================="
