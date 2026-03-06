# Pipeline Ingestion Architecture

## Overview

This document describes the incremental data ingestion pipeline for FundLens, covering the complete flow from ticker input to LLM-generated responses.

## Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PIPELINE INGESTION FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. DEAL CREATION                                                            │
│     Input: Ticker (e.g., SHOP)                                               │
│     Output: Deal record in PostgreSQL                                        │
│     ↓                                                                        │
│  2. SEC FILING DOWNLOAD (Incremental)                                        │
│     - Check existing filings in filing_metadata table                        │
│     - Download only missing 10-K, 10-Q, 8-K from SEC EDGAR                   │
│     - Store raw filings in S3 data lake                                      │
│     ↓                                                                        │
│  3. METRICS PARSING                                                          │
│     - Python parser extracts XBRL/iXBRL metrics                              │
│     - Normalize metric labels (Revenue, NetIncome, etc.)                     │
│     - Validate no NaN values (>99.9999% accuracy)                            │
│     ↓                                                                        │
│  4. NARRATIVE CHUNKING                                                       │
│     - Extract qualitative sections (business, risk_factors, mda)             │
│     - Chunk content (500-2000 tokens per chunk)                              │
│     - Clean HTML/XBRL artifacts                                              │
│     ↓                                                                        │
│  5. RDS STORAGE (PostgreSQL)                                                 │
│     - financial_metrics: Raw and calculated metrics                          │
│     - narrative_chunks: Chunked qualitative content                          │
│     - filing_metadata: Track processed filings                               │
│     ↓                                                                        │
│  6. S3 STORAGE                                                               │
│     - Upload chunks as .txt files                                            │
│     - Create .metadata.json files for KB filtering                           │
│     - Bucket: fundlens-bedrock-chunks                                        │
│     ↓                                                                        │
│  7. BEDROCK KB SYNC (Event-Driven)                                           │
│     - S3 trigger → Lambda → StartIngestionJob                                │
│     - Automatic sync on new uploads                                          │
│     - Metadata filtering at KB level                                         │
│     ↓                                                                        │
│  8. RAG QUERY FLOW                                                           │
│     - Intent Detection → Quantitative/Qualitative/Hybrid                     │
│     - Structured Retriever → PostgreSQL for metrics                          │
│     - Semantic Retriever → Bedrock KB for narratives                         │
│     ↓                                                                        │
│  9. LLM RESPONSE                                                             │
│     - Combine metrics + narratives as context                                │
│     - Claude Opus 4.5 synthesis                                              │
│     - Include source citations                                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Event-Driven KB Sync Architecture

### Why Event-Driven?

The event-driven approach (S3 → Lambda → Bedrock KB) is superior to manual sync because:

1. **Near Real-Time**: Syncs start immediately when files are added
2. **Automatic**: No manual intervention required
3. **Efficient**: Only triggers when new content is added
4. **Reliable**: AWS manages retries and error handling
5. **Scalable**: Handles batch uploads with debouncing

### Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   NestJS    │────▶│     S3      │────▶│     Lambda      │────▶│  Bedrock KB │
│   Backend   │     │   Bucket    │     │  (Auto-Trigger) │     │  Ingestion  │
└─────────────┘     └─────────────┘     └─────────────────┘     └─────────────┘
      │                   │                     │                      │
      │  Upload chunks    │  S3:ObjectCreated   │  StartIngestionJob   │
      │  with metadata    │  event trigger      │  API call            │
      └───────────────────┴─────────────────────┴──────────────────────┘
```

### Lambda Function

Location: `infrastructure/lambda/bedrock-kb-sync/`

```typescript
// Triggered by S3 ObjectCreated events
export const handler = async (event: S3Event) => {
  // Extract tickers from uploaded files
  const tickers = extractTickersFromEvent(event);
  
  // Debounce to avoid multiple jobs for batch uploads
  if (shouldTriggerIngestion(tickers)) {
    await startIngestionJob();
  }
};
```

### CloudFormation Deployment

Location: `infrastructure/cloudformation/bedrock-kb-sync.yaml`

```bash
# Deploy the stack
aws cloudformation deploy \
  --template-file infrastructure/cloudformation/bedrock-kb-sync.yaml \
  --stack-name fundlens-kb-sync \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    BedrockKBId=NB5XNMHBQT \
    BedrockDataSourceId=OQMSFOE5SL \
    S3BucketName=fundlens-bedrock-chunks
```

### Alternative: Agent-Based Sync

For more complex scenarios, an agent-based approach could be used:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│   NestJS    │────▶│  SQS Queue  │────▶│  Bedrock Agent  │
│   Backend   │     │  (Buffer)   │     │  (Orchestrator) │
└─────────────┘     └─────────────┘     └─────────────────┘
```

**When to use Agent-Based:**
- Complex multi-step workflows
- Need for human-in-the-loop approval
- Cross-service orchestration
- Conditional processing logic

**When to use Event-Driven (Recommended):**
- Simple trigger → action patterns
- Low latency requirements
- High volume processing
- Cost efficiency

## Incremental Processing

### Filing Tracking

```sql
-- Check existing filings before download
SELECT filing_type, COUNT(*)::int as count 
FROM filing_metadata 
WHERE ticker = 'SHOP' AND processed = true
GROUP BY filing_type;
```

### Chunk Deduplication

```typescript
// Only upload new chunks
const getNewChunks = (allChunks, existingKeys) => {
  return allChunks.filter(chunk => {
    const key = `chunks/${chunk.ticker}/chunk-${chunk.chunkIndex}.txt`;
    return !existingKeys.includes(key);
  });
};
```

### Delta Sync

```typescript
// Calculate sync delta
const calculateDelta = (rdsCount, s3Count, kbCount) => ({
  needsS3Upload: rdsCount > s3Count,
  needsKBSync: s3Count > kbCount,
  s3Delta: rdsCount - s3Count,
  kbDelta: s3Count - kbCount,
});
```

## Metadata Format for Bedrock KB

### Content File (chunk-0.txt)
```
Shopify is a commerce platform that provides tools for merchants to 
start, grow, and manage their businesses across multiple channels...
```

### Metadata File (chunk-0.txt.metadata.json)
```json
{
  "metadataAttributes": {
    "ticker": "SHOP",
    "document_type": "sec_filing",
    "filing_type": "10-K",
    "section_type": "business",
    "fiscal_period": "FY2024",
    "chunk_index": "0"
  }
}
```

**Critical Requirements:**
- `chunk_index` must be a string (not number)
- No empty string values
- All values must be strings, numbers, or booleans

## Testing

### Unit Tests
```bash
npm run test:unit:pipeline
```

### Integration Tests
```bash
npm run test:pipeline:ingestion
```

### Full E2E Tests
```bash
npm run test:e2e
```

## API Endpoints

### KB Sync Status
```
GET /api/rag/kb/status?ticker=SHOP
```

### Start KB Sync
```
POST /api/rag/kb/sync
{ "ticker": "SHOP" }
```

### Get Job Status
```
GET /api/rag/kb/job/{jobId}
```

### Full Sync (Upload + Ingest + Wait)
```
POST /api/rag/kb/full-sync
{ "ticker": "SHOP" }
```

## Configuration

### Environment Variables
```env
BEDROCK_KB_ID=NB5XNMHBQT
BEDROCK_DATA_SOURCE_ID=OQMSFOE5SL
BEDROCK_CHUNKS_BUCKET=fundlens-bedrock-chunks
AWS_REGION=us-east-1
```

### Lambda Environment
```env
BEDROCK_KB_ID=NB5XNMHBQT
BEDROCK_DATA_SOURCE_ID=OQMSFOE5SL
DEBOUNCE_SECONDS=30
WAIT_FOR_COMPLETION=false
```

## Error Handling

### Ingestion Failures
- Invalid metadata attributes → Fix format, re-upload
- Rate limiting → Exponential backoff
- Timeout → Increase Lambda timeout

### Recovery
```typescript
// Retry failed chunks
const retryFailedChunks = async (failedKeys) => {
  for (const key of failedKeys) {
    await validateAndReupload(key);
  }
  await triggerIngestion();
};
```

## Monitoring

### CloudWatch Metrics
- Lambda invocations
- Ingestion job duration
- Documents indexed/failed

### Alerts
- Ingestion failures > 0
- Lambda errors
- High latency

## Best Practices

1. **Always filter by ticker** - Prevents mixing company data
2. **Validate before upload** - Check chunk quality
3. **Use debouncing** - Avoid multiple jobs for batch uploads
4. **Monitor ingestion** - Track success/failure rates
5. **Incremental processing** - Only process new data
