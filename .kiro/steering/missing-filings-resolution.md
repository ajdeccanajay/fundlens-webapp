---
inclusion: auto
---

# Missing Filings & Transcripts Resolution Protocol

When working on FundLens data pipeline issues — missing filings, incomplete narrative chunks, absent transcripts, or gaps in coverage — follow this systematic protocol. Never guess. Always diagnose first.

## 1. Diagnose Before Acting

Before triggering any pipeline re-run, query RDS to understand the actual state:

```sql
-- What filing types exist per ticker, with chunk counts and distinct filing dates?
SELECT ticker, filing_type, COUNT(*)::int as chunks,
       COUNT(DISTINCT filing_date) as distinct_dates
FROM narrative_chunks
GROUP BY ticker, filing_type
ORDER BY ticker, filing_type;

-- What does filing_metadata say was downloaded?
SELECT ticker, filing_type, filing_date, processed
FROM filing_metadata
ORDER BY ticker, filing_type, filing_date DESC;

-- Are there filings in metadata that have zero narrative chunks?
SELECT fm.ticker, fm.filing_type, fm.filing_date, 
       COUNT(nc.id)::int as chunk_count
FROM filing_metadata fm
LEFT JOIN narrative_chunks nc 
  ON nc.ticker = fm.ticker 
  AND nc.filing_type = fm.filing_type
GROUP BY fm.ticker, fm.filing_type, fm.filing_date
HAVING COUNT(nc.id) = 0;
```

## 2. Common Root Causes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Ticker has NO 10-K chunks | SEC pipeline didn't fetch 10-Ks for this ticker, or parsing failed | Re-run pipeline for that ticker via API |
| Ticker has 10-K in metadata but 0 chunks | Python parser failed during narrative extraction | Check ECS logs, re-trigger pipeline |
| Only 1 filing_date for a filing_type | Pipeline only fetched the most recent filing, not historical | Force refresh with `--execute` flag |
| No earnings transcripts | Transcript agent couldn't find free source, or agent timed out | Check orchestrator.agent.ts logs, may need manual IR page URL |
| Foreign filer missing 10-K | Company files 40-F instead of 10-K (e.g., SHOP is Canadian) | Verify filing_type includes 40-F, 6-K |
| DEF 14A missing | Proxy statement not in pipeline config | Verify DEF 14A is in filing types list |

## 3. Force-Fetch Missing Filings

Use the production API to trigger pipeline re-runs:

```bash
# Single ticker
node scripts/force-refresh-all-deals.js --ticker AAPL --execute

# All deals
node scripts/force-refresh-all-deals.js --execute

# Check coverage first (dry run)
node scripts/force-refresh-all-deals.js --coverage
```

The pipeline runs Steps A → A2 → B → C → D → E → G → H:
- Step A: Downloads SEC filings (10-K, 10-Q, 8-K, DEF 14A, Form 4, 40-F, 6-K, F-1, S-1)
- Step A2: Acquires earnings transcripts via agentic web search (free sources only)
- Step B: Parses filings via Python parser, stores metrics
- Step C: Chunks narratives, stores in RDS with filing_date
- Step D: Exports sections to S3, triggers Bedrock KB ingestion (non-blocking)
- Step E: Pre-computes qualitative analysis
- Step G/H: Builds metric hierarchies and links footnotes

## 4. After Fixing Missing Data

After new filings are ingested, you MUST re-sync the Bedrock Knowledge Base:

```bash
node scripts/clean-slate-kb-sync.js
```

This script:
1. Deletes old S3 objects under `chunks/` and `sections/` prefixes
2. Re-exports ALL sections from RDS using chunk-level `filing_date` for fiscal_period derivation
3. Triggers Bedrock KB ingestion
4. Monitors the ingestion job

## 5. Transcript-Specific Issues

Earnings transcripts are acquired via `src/agents/orchestrator.agent.ts` → `src/agents/transcript-acquisition.agent.ts` → `src/agents/ir-page-finder.agent.ts`. The agent uses free web search (DuckDuckGo) to find transcripts — NO paid APIs.

If transcripts are missing:
1. Check if the ticker has `earnings_transcript` section_type in narrative_chunks
2. Check ECS logs for the transcript agent: `/ecs/fundlens-production/backend`
3. The IR page finder has a 5-layer fallback strategy — if all fail, the transcript step completes with a warning (never fails the pipeline)
4. For stubborn cases, manually find the IR page URL and add it to the deal metadata

## 6. Expected Coverage Per Ticker

A well-populated ticker should have:
- 10-K: 3-5 years of annual reports (8-12 section types each)
- 10-Q: 12+ quarterly reports (fewer sections than 10-K)
- 8-K: 20-40 current reports (varies by company activity)
- DEF 14A: 2-4 proxy statements
- Earnings transcripts: 4-8 quarterly calls
- Form 4: Insider transactions (if available)
- Foreign filers (SHOP): 40-F instead of 10-K, 6-K instead of 8-K

## 7. Key Infrastructure Details

- DB: `postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db` (SSL required)
- S3 bucket: `fundlens-bedrock-chunks` (sections/ prefix for KB content)
- Bedrock KB: `NB5XNMHBQT`, data source: `OQMSFOE5SL`
- ECS cluster: `fundlens-production`, service: `fundlens-production-service`
- API host: `app.fundlens.ai`
- Cognito auth required for API calls (use IdToken, not AccessToken)
