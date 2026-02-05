# Production Deployment Plan - February 2026

## Overview
This deployment includes all completed features from recent changelogs, up to and including Phase 2 of RAG Competitive Intelligence Extraction. The Insights tab has been removed as planned.

**Deployment Date**: February 4, 2026  
**Git Tag**: `production-feb-2026-v2.0.0`  
**Risk Level**: MEDIUM (significant new features, but well-tested)

## What's Included

### 1. RAG Competitive Intelligence Extraction (Phase 1 & 2) ✅
**Git Tags**: `rag-extraction-phase1-v1.0.0`, `rag-extraction-phase2-v1.0.0`

**Phase 1 - Core Subsection Extraction**:
- Subsection identification for Item 1 (Business), Item 7 (MD&A), Item 8 (Financial Statements), Item 1A (Risk Factors)
- Database schema updated with `subsection_name` column
- Bedrock KB metadata synchronization enhanced
- Backfilled existing chunks with subsection metadata

**Phase 2 - Intent Detection & Subsection-Aware Retrieval**:
- Enhanced intent detector with subsection identification
- Subsection-aware retrieval in Semantic Retriever
- Multi-ticker isolation
- Response Generator Service for structured extraction
- Prompt engineering and versioning
- Monitoring and observability (Intent Analytics dashboard)

**Files Modified**:
- `python_parser/narrative_extractor.py` - Subsection extraction
- `prisma/migrations/20260203_add_subsection_to_narrative_chunks.sql`
- `src/rag/chunk-exporter.service.ts` - Metadata export
- `src/rag/intent-detector.service.ts` - Enhanced intent detection
- `src/rag/semantic-retriever.service.ts` - Subsection filtering
- `src/rag/prompt-library.service.ts` - Prompt management
- `src/rag/intent-analytics.service.ts` - Monitoring
- `src/admin/intent-analytics.controller.ts` - Admin dashboard
- `public/internal/platform-admin.html` - Intent Analytics UI integration

### 2. Research Assistant with Document Upload ✅
**Changelog**: `CHANGELOG-2026-02-03-SCRATCHPAD-DATA-FIX.md`

- User document upload and processing
- Citation generation with source tracking
- Workspace integration
- Scratchpad items for research notes
- Export functionality

**Files Modified**:
- `src/documents/document-processing.service.ts`
- `src/documents/documents.service.ts`
- `src/rag/citation.service.ts`
- `src/deals/scratchpad-item.service.ts`
- `public/app/research/index.html`
- `prisma/migrations/20260203_add_scratchpad_items.sql`

### 3. Workspace Enhancements ✅
**Changelog**: `CHANGELOG-2026-02-02.md`

- Anomaly detection for financial metrics
- Comparative analysis tables
- Change tracker for period-over-period analysis
- Hierarchy and footnote enhancements
- Performance optimizations

**Files Modified**:
- `src/deals/anomaly-detection.service.ts`
- `src/deals/comp-table.service.ts`
- `src/deals/metric-hierarchy.service.ts`
- `src/deals/footnote-linking.service.ts`
- `prisma/migrations/20260202_add_hierarchy_and_footnotes_tables.sql`
- `prisma/migrations/add_insights_performance_indexes.sql`

### 4. Design System Uplift ✅
**Spec**: `.kiro/specs/design-system-uplift/`

- Consistent dark theme across all pages
- Improved typography and spacing
- Enhanced navigation
- Better mobile responsiveness

**Files Modified**:
- `public/css/design-system.css`
- `public/css/workspace-enhancements.css`
- `public/css/research-scratchpad.css`
- All HTML pages updated with new design system

### 5. Platform Admin Enhancements ✅
- Intent Analytics dashboard integrated
- Client and user management
- Monitoring and alerting

**Files Modified**:
- `public/internal/platform-admin.html`
- `src/admin/platform-admin.controller.ts`
- `src/admin/platform-admin.service.ts`
- `src/admin/intent-analytics.controller.ts`

## What's Excluded

### ❌ Insights Tab (REMOVED)
The Insights tab has been intentionally removed and moved to `FUTURE/insights-tab/` for potential future reimplementation. All related code has been cleaned up.

**Removed Files**:
- Frontend: Insights tab UI components
- Backend: Insights service endpoints (kept for backward compatibility but deprecated)

### ⏳ RAG Phase 3 & 4 (NOT YET IMPLEMENTED)
- Phase 3: Advanced retrieval techniques (reranking, HyDE, query decomposition)
- Phase 4: Dynamic calculations and multi-modal responses

These will be deployed in future releases.

## Pre-Deployment Checklist

### 1. Database Migrations ✅
```bash
# Run all pending migrations
npm run prisma:migrate:deploy

# Verify migrations applied
npm run prisma:migrate:status
```

**Required Migrations**:
- `20260203_add_subsection_to_narrative_chunks.sql`
- `20260203_add_scratchpad_items.sql`
- `20260202_add_hierarchy_and_footnotes_tables.sql`
- `20260204_add_intent_analytics.sql`
- `20260204_add_prompt_templates.sql`
- `add_insights_performance_indexes.sql`

### 2. Bedrock KB Sync ✅
```bash
# Backfill subsection metadata to Bedrock KB
node scripts/backfill-nvda-subsections.js

# Verify sync status
node scripts/monitor-kb-sync-status.js
```

### 3. Environment Variables
Verify all required environment variables are set in production:

```bash
# RAG & Bedrock
AWS_REGION=us-east-1
BEDROCK_KB_ID=<production-kb-id>
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0

# Database
DATABASE_URL=<production-rds-url>

# Admin
PLATFORM_ADMIN_KEY=<secure-admin-key>

# S3
S3_BUCKET_NAME=fundlens-documents-prod
```

### 4. Build & Test
```bash
# Run all tests
npm run test
npm run test:e2e

# Build production bundle
npm run build

# Verify build
npm run start:prod
```

### 5. Smoke Tests
After deployment, run these smoke tests:

1. **RAG Subsection Retrieval**:
   ```bash
   curl -X POST https://api.fundlens.com/api/rag/query \
     -H "Content-Type: application/json" \
     -d '{"query": "Who are NVDA competitors?", "ticker": "NVDA"}'
   ```

2. **Research Assistant**:
   - Upload a test document
   - Ask a question about the document
   - Verify citations are generated

3. **Platform Admin**:
   - Access Intent Analytics dashboard
   - Verify metrics are loading
   - Check failed patterns list

4. **Workspace Features**:
   - Test anomaly detection
   - Test comparative analysis
   - Test change tracker

## Deployment Steps

### Step 1: Create Git Tag
```bash
git tag -a production-feb-2026-v2.0.0 -m "Production deployment Feb 2026: RAG Phase 1&2, Research Assistant, Workspace Enhancements"
git push origin production-feb-2026-v2.0.0
```

### Step 2: Build Docker Images
```bash
cd scripts/deploy
./build-and-push.sh
```

### Step 3: Deploy Infrastructure (if needed)
```bash
./deploy-infrastructure.sh
```

### Step 4: Deploy Backend
```bash
./deploy-backend.sh
```

### Step 5: Deploy Frontend
```bash
./deploy-frontend.sh
```

### Step 6: Run Database Migrations
```bash
# SSH into ECS task or run via AWS Systems Manager
npm run prisma:migrate:deploy
```

### Step 7: Backfill Data
```bash
# Backfill subsection metadata
node scripts/backfill-nvda-subsections.js

# Verify Bedrock KB sync
node scripts/monitor-kb-sync-status.js
```

### Step 8: Smoke Tests
Run all smoke tests listed above.

### Step 9: Monitor
- Check CloudWatch logs for errors
- Monitor Intent Analytics dashboard
- Check application metrics (latency, error rates)

## Rollback Plan

### If Issues Detected:

**Option 1: Quick Rollback (Recommended)**
```bash
# Revert to previous ECS task definition
aws ecs update-service \
  --cluster fundlens-prod \
  --service fundlens-backend \
  --task-definition fundlens-backend:PREVIOUS_VERSION

# Revert frontend
aws s3 sync s3://fundlens-frontend-backup/ s3://fundlens-frontend-prod/
```

**Option 2: Git Rollback**
```bash
# Revert to previous production tag
git checkout production-jan-2026-v1.0.0
./scripts/deploy/deploy-all.sh
```

**Option 3: Database Rollback**
```bash
# Revert specific migrations if needed
npm run prisma:migrate:resolve --rolled-back 20260203_add_subsection_to_narrative_chunks
```

## Post-Deployment Monitoring

### Key Metrics to Watch (First 24 Hours):

1. **RAG Performance**:
   - Intent detection success rate (target: >95%)
   - Subsection retrieval accuracy
   - Query latency (target: p95 < 3s)

2. **Research Assistant**:
   - Document upload success rate
   - Citation generation accuracy
   - User engagement metrics

3. **System Health**:
   - Error rates (target: <1%)
   - API latency (target: p95 < 2s)
   - Database connection pool usage

4. **User Experience**:
   - Page load times
   - JavaScript errors
   - User feedback

### Monitoring Dashboards:
- CloudWatch: `fundlens-prod-metrics`
- Intent Analytics: `https://app.fundlens.com/internal/platform-admin.html`
- Application Logs: CloudWatch Logs Insights

## Success Criteria

Deployment is considered successful if:

✅ All smoke tests pass  
✅ Error rate < 1% for 24 hours  
✅ RAG intent detection success rate > 95%  
✅ No critical bugs reported  
✅ User feedback is positive  
✅ Performance metrics within targets  

## Communication Plan

### Pre-Deployment:
- [ ] Notify team of deployment window
- [ ] Schedule deployment during low-traffic period
- [ ] Prepare rollback team on standby

### During Deployment:
- [ ] Post status updates in #engineering channel
- [ ] Monitor metrics dashboard
- [ ] Be ready to rollback if issues detected

### Post-Deployment:
- [ ] Announce successful deployment
- [ ] Share new features with users
- [ ] Document any issues encountered
- [ ] Schedule retrospective

## Known Issues / Limitations

1. **RAG Phase 3 & 4 Not Included**: Advanced retrieval techniques and dynamic calculations will come in future releases.

2. **Insights Tab Removed**: Users who bookmarked the Insights tab will see a 404. Consider adding a redirect or notice.

3. **Bedrock KB Sync**: Initial backfill may take 30-60 minutes. During this time, subsection filtering may return fewer results.

4. **Intent Analytics**: Historical data only available from deployment date forward.

## Next Steps (Post-Deployment)

1. **Monitor for 48 hours** - Watch metrics and user feedback
2. **Gather user feedback** - Survey users on new features
3. **Plan Phase 3** - Begin RAG Phase 3 implementation (advanced retrieval)
4. **Optimize performance** - Based on production metrics
5. **Documentation** - Update user documentation with new features

## Team Contacts

- **Deployment Lead**: [Name]
- **Backend Lead**: [Name]
- **Frontend Lead**: [Name]
- **DevOps**: [Name]
- **On-Call**: [Name]

## Approval

- [ ] Engineering Lead Approval
- [ ] Product Manager Approval
- [ ] DevOps Approval
- [ ] QA Sign-off

---

**Prepared by**: Kiro AI Assistant  
**Date**: February 4, 2026  
**Version**: 2.0.0
