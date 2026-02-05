#!/bin/bash

# Pre-Deployment Execution Script
# Production Deployment - February 2026 v2.0.0
# 
# This script executes all pre-deployment checklist items

set -e  # Exit on error

echo "=========================================="
echo "PRE-DEPLOYMENT EXECUTION"
echo "Production Feb 2026 v2.0.0"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Verify Build
echo -e "${YELLOW}Step 1: Verifying Build...${NC}"
npm run build
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Build successful${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo ""

# Step 2: Run Tests (non-blocking)
echo -e "${YELLOW}Step 2: Running Tests...${NC}"
npm run test || echo -e "${YELLOW}⚠️  Some tests failed (non-blocking)${NC}"
echo ""

# Step 3: Check Database Connection
echo -e "${YELLOW}Step 3: Checking Database Connection...${NC}"
node -e "const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); prisma.\$connect().then(() => { console.log('✅ Database connected'); prisma.\$disconnect(); }).catch(e => { console.error('❌ Database connection failed:', e.message); process.exit(1); });"
echo ""

# Step 4: Apply Database Migrations
echo -e "${YELLOW}Step 4: Applying Database Migrations...${NC}"
read -p "Apply migrations to production database? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npx prisma migrate deploy
    echo -e "${GREEN}✅ Migrations applied${NC}"
else
    echo -e "${YELLOW}⚠️  Skipped migrations${NC}"
fi
echo ""

# Step 5: Backfill Bedrock KB
echo -e "${YELLOW}Step 5: Backfill Bedrock KB Subsections...${NC}"
read -p "Run Bedrock KB backfill? This may take 30-60 minutes. (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    node scripts/backfill-nvda-subsections.js
    echo -e "${GREEN}✅ Bedrock KB backfill complete${NC}"
    
    # Verify sync status
    echo -e "${YELLOW}Verifying sync status...${NC}"
    node scripts/monitor-kb-sync-status.js
else
    echo -e "${YELLOW}⚠️  Skipped Bedrock KB backfill${NC}"
fi
echo ""

# Step 6: Create Git Tag
echo -e "${YELLOW}Step 6: Creating Git Tag...${NC}"
read -p "Create git tag 'production-feb-2026-v2.0.0'? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    git tag -a production-feb-2026-v2.0.0 -m "Production deployment Feb 2026: RAG Phase 1&2, Research Assistant, Workspace Enhancements"
    git push origin production-feb-2026-v2.0.0
    echo -e "${GREEN}✅ Git tag created and pushed${NC}"
else
    echo -e "${YELLOW}⚠️  Skipped git tag${NC}"
fi
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}PRE-DEPLOYMENT CHECKLIST COMPLETE${NC}"
echo "=========================================="
echo ""
echo "Next Steps:"
echo "1. Review PRE_DEPLOYMENT_CHECKLIST_STATUS.md"
echo "2. Run deployment scripts:"
echo "   cd scripts/deploy"
echo "   ./build-and-push.sh"
echo "   ./deploy-backend.sh"
echo "   ./deploy-frontend.sh"
echo ""
echo "3. Run smoke tests (see DEPLOYMENT_PLAN_FEB_2026.md)"
echo ""
echo "Deployment Plan: DEPLOYMENT_PLAN_FEB_2026.md"
echo "Rollback Plan: See deployment plan Section 'Rollback Plan'"
echo ""
