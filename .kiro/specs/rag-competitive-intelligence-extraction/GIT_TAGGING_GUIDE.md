# Git Tagging and Rollback Guide

## Quick Reference

This guide provides step-by-step instructions for creating git tags and performing rollbacks for the RAG Competitive Intelligence Extraction feature.

---

## Git Tag Creation

### Before Starting Implementation

```bash
# 1. Create baseline tag (before any changes)
git add .
git commit -m "chore: create baseline for RAG extraction feature"
git tag -a rag-extraction-baseline -m "Baseline: System state before RAG extraction improvements"
git push origin rag-extraction-baseline
```

### After Completing Phase 1

```bash
# 1. Ensure all Phase 1 changes are committed
git add .
git commit -m "feat(rag): Phase 1 - Core subsection extraction and storage"

# 2. Run all Phase 1 tests
npm test -- --grep "Phase 1"

# 3. Verify success criteria
# - All new chunks have subsection_name populated
# - Existing chunks work without errors
# - Bedrock KB ingests chunks with subsection metadata
# - All tests pass

# 4. Update CHANGELOG
# Edit CHANGELOG-RAG-EXTRACTION.md and add deployment date for Phase 1

# 5. Create Phase 1 tag
git tag -a rag-extraction-phase1-v1.0.0 -m "Phase 1: Core subsection extraction and storage"
git push origin rag-extraction-phase1-v1.0.0
```

### After Completing Phase 2

```bash
# 1. Ensure all Phase 2 changes are committed
git add .
git commit -m "feat(rag): Phase 2 - Intent detection and subsection-aware retrieval"

# 2. Run all Phase 2 tests
npm test -- --grep "Phase 2"

# 3. Verify success criteria
# - Competitive intelligence success rate >95%
# - MD&A success rate >90%
# - Footnote success rate >90%
# - Multi-ticker separation working (0 mixing incidents)
# - All tests pass

# 4. Update CHANGELOG
# Edit CHANGELOG-RAG-EXTRACTION.md and add deployment date for Phase 2

# 5. Create Phase 2 tag
git tag -a rag-extraction-phase2-v1.0.0 -m "Phase 2: Intent detection and subsection-aware retrieval"
git push origin rag-extraction-phase2-v1.0.0
```

### After Completing Phase 3

```bash
# 1. Ensure all Phase 3 changes are committed
git add .
git commit -m "feat(rag): Phase 3 - Advanced retrieval techniques"

# 2. Run all Phase 3 tests
npm test -- --grep "Phase 3"

# 3. Verify success criteria
# - Reranking improves top-3 relevance by >10%
# - Latency p95 < 5 seconds
# - All advanced techniques working
# - All tests pass

# 4. Update CHANGELOG
# Edit CHANGELOG-RAG-EXTRACTION.md and add deployment date for Phase 3

# 5. Create Phase 3 tag
git tag -a rag-extraction-phase3-v1.0.0 -m "Phase 3: Advanced retrieval techniques"
git push origin rag-extraction-phase3-v1.0.0
```

### After Completing Phase 4

```bash
# 1. Ensure all Phase 4 changes are committed
git add .
git commit -m "feat(rag): Phase 4 - Dynamic calculations and multi-modal responses"

# 2. Run all Phase 4 tests
npm test -- --grep "Phase 4"

# 3. Verify success criteria
# - Dynamic calculations success rate >90%
# - Charts generate correctly
# - Code interpreter works safely
# - Latency targets met
# - All tests pass

# 4. Update CHANGELOG
# Edit CHANGELOG-RAG-EXTRACTION.md and add deployment date for Phase 4

# 5. Create Phase 4 tag
git tag -a rag-extraction-phase4-v1.0.0 -m "Phase 4: Dynamic calculations and multi-modal responses"
git push origin rag-extraction-phase4-v1.0.0
```

---

## Rollback Procedures

### Rollback from Phase 1 to Baseline

**When to use**: Phase 1 causes issues with subsection extraction or Bedrock KB ingestion

```bash
# 1. Stop services
pm2 stop all

# 2. Revert database schema
psql -d fundlens -c "ALTER TABLE narrative_chunks DROP COLUMN IF EXISTS subsection_name;"
psql -d fundlens -c "DROP INDEX IF EXISTS idx_narrative_chunks_subsection;"

# 3. Checkout baseline code
git checkout rag-extraction-baseline

# 4. Rebuild and restart
npm run build
pm2 restart all

# 5. Verify system is working
npm test
curl http://localhost:3000/health

# 6. Update CHANGELOG
# Add rollback entry with date and reason
```

### Rollback from Phase 2 to Phase 1

**When to use**: Phase 2 causes issues with intent detection or retrieval accuracy

```bash
# 1. Disable Phase 2 features via feature flags (quick rollback)
export FEATURE_SUBSECTION_FILTERING=false
export FEATURE_STRUCTURED_EXTRACTION=false
export FEATURE_CONFIDENCE_SCORING=false

# Restart services
pm2 restart all

# OR for full rollback:

# 2. Stop services
pm2 stop all

# 3. Checkout Phase 1 code
git checkout rag-extraction-phase1-v1.0.0

# 4. Rebuild and restart
npm run build
pm2 restart all

# 5. Verify system is working
npm test
curl http://localhost:3000/health

# 6. Update CHANGELOG
# Add rollback entry with date and reason
```

### Rollback from Phase 3 to Phase 2

**When to use**: Phase 3 causes latency issues or advanced retrieval failures

```bash
# 1. Disable Phase 3 features via feature flags (quick rollback)
export FEATURE_RERANKING=false
export FEATURE_HYDE=false
export FEATURE_QUERY_DECOMPOSITION=false
export FEATURE_CONTEXTUAL_EXPANSION=false
export FEATURE_ITERATIVE_RETRIEVAL=false

# Restart services
pm2 restart all

# OR for full rollback:

# 2. Stop services
pm2 stop all

# 3. Checkout Phase 2 code
git checkout rag-extraction-phase2-v1.0.0

# 4. Rebuild and restart
npm run build
pm2 restart all

# 5. Verify system is working
npm test
curl http://localhost:3000/health

# 6. Update CHANGELOG
# Add rollback entry with date and reason
```

### Rollback from Phase 4 to Phase 3

**When to use**: Phase 4 causes issues with dynamic calculations or multi-modal responses

```bash
# 1. Disable Phase 4 features via feature flags (quick rollback)
export FEATURE_DYNAMIC_CALCULATIONS=false
export FEATURE_FORMULA_CACHE=false
export FEATURE_CHART_GENERATION=false
export FEATURE_CODE_INTERPRETER=false
export FEATURE_MULTI_MODAL_RESPONSES=false

# Restart services
pm2 restart all

# OR for full rollback:

# 2. Stop services
pm2 stop all

# 3. Revert database schema
psql -d fundlens -c "DROP TABLE IF EXISTS formula_audit_log;"
psql -d fundlens -c "DROP TABLE IF EXISTS formula_cache;"

# 4. Checkout Phase 3 code
git checkout rag-extraction-phase3-v1.0.0

# 5. Rebuild and restart
npm run build
pm2 restart all

# 6. Verify system is working
npm test
curl http://localhost:3000/health

# 7. Update CHANGELOG
# Add rollback entry with date and reason
```

---

## Hotfix Procedures

### Creating a Hotfix for Phase 2

```bash
# 1. Create hotfix branch from Phase 2 tag
git checkout -b hotfix/rag-extraction-phase2-fix rag-extraction-phase2-v1.0.0

# 2. Make fixes
# ... edit files ...
git add .
git commit -m "fix(rag): Fix competitive intelligence extraction bug"

# 3. Test the fix
npm test

# 4. Tag the hotfix
git tag -a rag-extraction-phase2-hotfix-v1.0.1 -m "Hotfix: Fix competitive intelligence extraction bug"

# 5. Merge back to main
git checkout main
git merge hotfix/rag-extraction-phase2-fix

# 6. Push everything
git push origin main
git push origin rag-extraction-phase2-hotfix-v1.0.1

# 7. Update CHANGELOG
# Add hotfix entry with date and description
```

---

## Rollback Decision Criteria

### Immediate Rollback Required
- **Multi-ticker mixing detected**: Any incident where data from one ticker appears in another ticker's results
- **Data accuracy issues**: Incorrect competitor names, financial metrics, or accounting policies
- **Critical bugs**: System crashes, data corruption, or security vulnerabilities

### Rollback Recommended
- **Success rate drops below 80%**: For any intent type (competitive intelligence, MD&A, footnote)
- **Latency exceeds targets by >50%**: p95 latency significantly higher than expected
- **Formula validation failures >10%**: High rate of invalid formulas in Phase 4
- **User feedback**: Multiple reports of quality degradation

### Monitor and Decide
- **Success rate 80-90%**: Monitor closely, consider rollback if doesn't improve within 24 hours
- **Latency exceeds targets by 20-50%**: Investigate performance issues, optimize before rollback
- **Minor bugs**: Fix with hotfix rather than full rollback

---

## Monitoring After Deployment

### Phase 1 Monitoring (First 24 Hours)
```bash
# Check subsection identification rate
psql -d fundlens -c "
  SELECT 
    COUNT(*) FILTER (WHERE subsection_name IS NOT NULL) * 100.0 / COUNT(*) as subsection_rate
  FROM narrative_chunks
  WHERE created_at > NOW() - INTERVAL '24 hours';
"

# Check Bedrock KB ingestion
aws logs tail /aws/bedrock/knowledge-base/fundlens-kb --follow
```

### Phase 2 Monitoring (First 24 Hours)
```bash
# Check extraction success rates
curl http://localhost:3000/api/rag/metrics | jq '.success_rates'

# Check for multi-ticker mixing incidents
psql -d fundlens -c "
  SELECT COUNT(*) as mixing_incidents
  FROM rag_audit_log
  WHERE created_at > NOW() - INTERVAL '24 hours'
  AND ticker_mixing_detected = true;
"

# Check average confidence scores
curl http://localhost:3000/api/rag/metrics | jq '.avg_confidence_by_intent'
```

### Phase 3 Monitoring (First 24 Hours)
```bash
# Check reranking improvement
curl http://localhost:3000/api/rag/metrics | jq '.reranking_improvement'

# Check latency p95
curl http://localhost:3000/api/rag/metrics | jq '.latency_p95'

# Check advanced technique usage
curl http://localhost:3000/api/rag/metrics | jq '.advanced_techniques_usage'
```

### Phase 4 Monitoring (First 24 Hours)
```bash
# Check dynamic calculation success rate
curl http://localhost:3000/api/rag/metrics | jq '.dynamic_calc_success_rate'

# Check formula validation failure rate
curl http://localhost:3000/api/rag/metrics | jq '.formula_validation_failure_rate'

# Check chart generation success rate
curl http://localhost:3000/api/rag/metrics | jq '.chart_generation_success_rate'

# Check code interpreter success rate
curl http://localhost:3000/api/rag/metrics | jq '.code_interpreter_success_rate'
```

---

## Emergency Contacts

**Feature Owner**: TBD
**Technical Lead**: TBD
**On-Call Engineer**: Check PagerDuty
**Slack Channel**: #rag-extraction-feature
**Incident Response**: #incidents

---

## Useful Commands

### List All Tags
```bash
git tag -l "rag-extraction-*"
```

### View Tag Details
```bash
git show rag-extraction-phase2-v1.0.0
```

### Compare Tags
```bash
git diff rag-extraction-phase1-v1.0.0 rag-extraction-phase2-v1.0.0
```

### Delete a Tag (if needed)
```bash
# Delete local tag
git tag -d rag-extraction-phase2-v1.0.0

# Delete remote tag
git push origin :refs/tags/rag-extraction-phase2-v1.0.0
```

### Verify Current Version
```bash
git describe --tags --abbrev=0
```

---

## Checklist for Each Phase

### Pre-Deployment
- [ ] All tests pass
- [ ] Code review completed
- [ ] Database migrations tested on staging
- [ ] Feature flags configured
- [ ] Monitoring dashboards updated
- [ ] Rollback procedure documented and tested
- [ ] CHANGELOG updated with deployment date

### Deployment
- [ ] Create git tag
- [ ] Run database migrations
- [ ] Deploy code changes
- [ ] Restart services
- [ ] Verify feature flags
- [ ] Run smoke tests

### Post-Deployment (First 24 Hours)
- [ ] Monitor success rates
- [ ] Monitor latency metrics
- [ ] Monitor error rates
- [ ] Check for multi-ticker mixing incidents
- [ ] Collect user feedback
- [ ] Update documentation

### Post-Deployment (First Week)
- [ ] Review metrics trends
- [ ] Analyze user feedback
- [ ] Identify optimization opportunities
- [ ] Plan next phase or improvements
- [ ] Update team on results

---

## Notes

- Always test rollback procedures on staging before production deployment
- Keep feature flags enabled for at least 1 week after deployment for quick rollback
- Document any issues encountered during deployment or rollback
- Update this guide if rollback procedures change
- Communicate rollback decisions to all stakeholders immediately
