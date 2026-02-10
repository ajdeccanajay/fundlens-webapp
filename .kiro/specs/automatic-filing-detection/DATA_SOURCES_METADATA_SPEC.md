# Data Sources Metadata Specification

## Overview

This document defines the expected structure and fields for the `metadata` JSONB column in the `data_sources` table when storing SEC filing information. The metadata field is used by the FilingDetectorService to track which filings have been processed and to store filing-specific information.

## Purpose

The `data_sources.metadata` field serves multiple purposes:
1. **Filing Identification**: Uniquely identifies the SEC filing with ticker, filing type, and accession number
2. **Processing Tracking**: Tracks whether the filing has been processed (metrics extracted, narratives chunked)
3. **Temporal Information**: Stores filing date and report date for chronological queries
4. **Incremental Detection**: Enables the FilingDetectorService to skip already-downloaded filings
5. **Audit Trail**: Records when the filing was downloaded and processed

## Schema Definition

### Required Fields

All SEC filing records in `data_sources` MUST include the following metadata fields:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `ticker` | string | Stock ticker symbol (uppercase) | `"AAPL"` |
| `filingType` | string | SEC form type (10-K, 10-Q, 8-K) | `"10-K"` |
| `accessionNumber` | string | SEC accession number (unique identifier) | `"0000320193-24-000123"` |
| `filingDate` | string (ISO 8601) | Date the filing was submitted to SEC | `"2024-11-01"` |
| `reportDate` | string (ISO 8601) | Period end date covered by the filing | `"2024-09-30"` |
| `processed` | boolean | Whether metrics and narratives have been extracted | `false` |
| `downloadedAt` | string (ISO 8601) | Timestamp when the filing was downloaded | `"2024-11-02T06:15:00Z"` |

### Optional Fields

The following fields MAY be included for additional context:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `form` | string | Alternative name for filing type | `"10-K"` |
| `size` | number | File size in bytes | `1234567` |
| `processedAt` | string (ISO 8601) | Timestamp when processing completed | `"2024-11-02T06:20:00Z"` |
| `cik` | string | Central Index Key (SEC company identifier) | `"0000320193"` |
| `primaryDocument` | string | Name of the primary document file | `"aapl-20240930.htm"` |
| `url` | string | SEC EDGAR URL for the filing | `"https://www.sec.gov/..."` |

## Complete Example

```json
{
  "ticker": "AAPL",
  "filingType": "10-K",
  "accessionNumber": "0000320193-24-000123",
  "filingDate": "2024-11-01",
  "reportDate": "2024-09-30",
  "processed": false,
  "downloadedAt": "2024-11-02T06:15:00.000Z",
  "form": "10-K",
  "size": 1234567,
  "cik": "0000320193",
  "primaryDocument": "aapl-20240930.htm",
  "url": "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240930.htm"
}
```

## Field Specifications

### ticker
- **Format**: Uppercase string, 1-5 characters
- **Validation**: Must match `^[A-Z]{1,5}$`
- **Purpose**: Primary identifier for company, used for filtering and querying
- **Example**: `"AAPL"`, `"MSFT"`, `"GOOGL"`

### filingType
- **Format**: String, one of: `"10-K"`, `"10-Q"`, `"8-K"`
- **Validation**: Must be a valid SEC form type
- **Purpose**: Categorizes the filing type for filtering
- **Example**: `"10-K"` (annual report), `"10-Q"` (quarterly report), `"8-K"` (current report)

### accessionNumber
- **Format**: String, format `XXXXXXXXXX-XX-XXXXXX` (20 characters with dashes)
- **Validation**: Must match SEC accession number format
- **Purpose**: Unique identifier for the filing, used for deduplication
- **Example**: `"0000320193-24-000123"`
- **Note**: This is the primary key for detecting duplicate filings

### filingDate
- **Format**: ISO 8601 date string (`YYYY-MM-DD`)
- **Validation**: Must be a valid date, typically not in the future
- **Purpose**: Date the filing was submitted to SEC, used for chronological ordering
- **Example**: `"2024-11-01"`
- **Note**: This is different from `reportDate` (the period covered by the filing)

### reportDate
- **Format**: ISO 8601 date string (`YYYY-MM-DD`)
- **Validation**: Must be a valid date, typically before or equal to `filingDate`
- **Purpose**: Period end date covered by the filing (fiscal period end)
- **Example**: `"2024-09-30"` (for a 10-K covering fiscal year ending Sept 30, 2024)
- **Note**: For 8-K filings, this may be the same as `filingDate`

### processed
- **Format**: Boolean
- **Validation**: Must be `true` or `false`
- **Purpose**: Tracks whether the filing has been processed (metrics extracted, narratives chunked)
- **Default**: `false` (set to `true` after successful processing)
- **Usage**: 
  - Set to `false` when filing is first downloaded
  - Set to `true` after SECProcessingService completes successfully
  - Used to identify unprocessed filings for batch processing

### downloadedAt
- **Format**: ISO 8601 timestamp string with timezone (`YYYY-MM-DDTHH:mm:ss.sssZ`)
- **Validation**: Must be a valid timestamp
- **Purpose**: Records when the filing was downloaded from SEC EDGAR
- **Example**: `"2024-11-02T06:15:00.000Z"`
- **Note**: Always stored in UTC timezone

### processedAt (Optional)
- **Format**: ISO 8601 timestamp string with timezone (`YYYY-MM-DDTHH:mm:ss.sssZ`)
- **Validation**: Must be a valid timestamp, should be after `downloadedAt`
- **Purpose**: Records when processing completed successfully
- **Example**: `"2024-11-02T06:20:00.000Z"`
- **Note**: Only set after successful processing

## Usage Patterns

### 1. Creating a New Filing Record

When downloading a new filing, create a `data_source` record with:

```typescript
await prisma.dataSource.create({
  data: {
    type: 'sec_filing',
    sourceId: `${ticker}-${filingType}-${accessionNumber}`,
    visibility: 'public',
    ownerTenantId: null, // Public data, no tenant ownership
    s3Path: `public/sec-filings/${ticker}/${filingType}/${accessionNumber}/`,
    metadata: {
      ticker,
      filingType,
      accessionNumber,
      filingDate,
      reportDate,
      processed: false,
      downloadedAt: new Date().toISOString(),
    },
  },
});
```

### 2. Checking for Existing Filings

To detect if a filing already exists (avoid duplicate downloads):

```typescript
const existingFiling = await prisma.dataSource.findFirst({
  where: {
    type: 'sec_filing',
    metadata: {
      path: ['ticker'],
      equals: ticker,
    },
  },
});

// Check if accession number exists
const existingAccessions = new Set(
  existingFilings.map(f => (f.metadata as any).accessionNumber)
);

const isNew = !existingAccessions.has(filing.accessionNumber);
```

### 3. Finding Unprocessed Filings

To find filings that need processing:

```typescript
const unprocessedFilings = await prisma.dataSource.findMany({
  where: {
    type: 'sec_filing',
    metadata: {
      path: ['processed'],
      equals: false,
    },
  },
});
```

### 4. Marking a Filing as Processed

After successful processing:

```typescript
await prisma.dataSource.update({
  where: { id: filingId },
  data: {
    metadata: {
      ...existingMetadata,
      processed: true,
      processedAt: new Date().toISOString(),
    },
  },
});
```

### 5. Querying by Ticker and Filing Type

To find all 10-K filings for a specific ticker:

```typescript
const filings = await prisma.dataSource.findMany({
  where: {
    type: 'sec_filing',
    metadata: {
      path: ['ticker'],
      equals: 'AAPL',
    },
  },
});

// Filter by filing type in application code
const tenKs = filings.filter(f => 
  (f.metadata as any).filingType === '10-K'
);
```

## Validation Rules

### Type Safety

When accessing metadata in TypeScript, use type assertions:

```typescript
interface SECFilingMetadata {
  ticker: string;
  filingType: string;
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  processed: boolean;
  downloadedAt: string;
  processedAt?: string;
  form?: string;
  size?: number;
  cik?: string;
  primaryDocument?: string;
  url?: string;
}

const metadata = dataSource.metadata as SECFilingMetadata;
```

### Required Field Validation

Before creating a `data_source` record, validate that all required fields are present:

```typescript
function validateSECFilingMetadata(metadata: any): void {
  const required = [
    'ticker',
    'filingType',
    'accessionNumber',
    'filingDate',
    'reportDate',
    'processed',
    'downloadedAt',
  ];

  for (const field of required) {
    if (!(field in metadata)) {
      throw new Error(`Missing required metadata field: ${field}`);
    }
  }

  // Validate filing type
  const validTypes = ['10-K', '10-Q', '8-K'];
  if (!validTypes.includes(metadata.filingType)) {
    throw new Error(`Invalid filing type: ${metadata.filingType}`);
  }

  // Validate ticker format
  if (!/^[A-Z]{1,5}$/.test(metadata.ticker)) {
    throw new Error(`Invalid ticker format: ${metadata.ticker}`);
  }

  // Validate dates
  if (isNaN(Date.parse(metadata.filingDate))) {
    throw new Error(`Invalid filing date: ${metadata.filingDate}`);
  }

  if (isNaN(Date.parse(metadata.reportDate))) {
    throw new Error(`Invalid report date: ${metadata.reportDate}`);
  }
}
```

## Integration with Filing Detection System

### FilingDetectorService Usage

The FilingDetectorService uses metadata to:

1. **Detect New Filings**: Query existing `data_sources` records and compare accession numbers
2. **Skip Duplicates**: Avoid re-downloading filings that already exist
3. **Track Processing**: Identify unprocessed filings for batch processing

Example from FilingDetectorService:

```typescript
async filterNewFilings(
  ticker: string,
  filings: SECFiling[],
): Promise<SECFiling[]> {
  const existingAccessions = await this.prisma.dataSource.findMany({
    where: {
      type: 'sec_filing',
      metadata: {
        path: ['ticker'],
        equals: ticker,
      },
    },
    select: {
      metadata: true,
    },
  });

  const existingSet = new Set(
    existingAccessions.map(ds => (ds.metadata as any).accessionNumber),
  );

  return filings.filter(f => !existingSet.has(f.accessionNumber));
}
```

### SECProcessingService Usage

The SECProcessingService updates metadata after processing:

```typescript
async processFiling(
  ticker: string,
  filingType: string,
  accessionNumber: string,
): Promise<ProcessingResult> {
  // ... processing logic ...

  // Update metadata to mark as processed
  await this.prisma.dataSource.updateMany({
    where: {
      type: 'sec_filing',
      metadata: {
        path: ['accessionNumber'],
        equals: accessionNumber,
      },
    },
    data: {
      metadata: {
        ...existingMetadata,
        processed: true,
        processedAt: new Date().toISOString(),
      },
    },
  });
}
```

## Best Practices

### 1. Always Use UTC Timestamps
Store all timestamps in UTC timezone (ISO 8601 format with 'Z' suffix):
```typescript
downloadedAt: new Date().toISOString() // "2024-11-02T06:15:00.000Z"
```

### 2. Normalize Ticker Symbols
Always store tickers in uppercase:
```typescript
ticker: ticker.toUpperCase() // "AAPL" not "aapl"
```

### 3. Validate Before Storing
Always validate metadata before creating records:
```typescript
validateSECFilingMetadata(metadata);
await prisma.dataSource.create({ ... });
```

### 4. Use Upsert for Idempotency
Use `upsert` to handle re-downloads gracefully:
```typescript
await prisma.dataSource.upsert({
  where: {
    type_sourceId: {
      type: 'sec_filing',
      sourceId: `${ticker}-${filingType}-${accessionNumber}`,
    },
  },
  create: { ... },
  update: { ... },
});
```

### 5. Preserve Existing Metadata on Updates
When updating metadata, preserve existing fields:
```typescript
const existing = await prisma.dataSource.findUnique({ ... });
const existingMetadata = existing.metadata as SECFilingMetadata;

await prisma.dataSource.update({
  data: {
    metadata: {
      ...existingMetadata, // Preserve existing fields
      processed: true,     // Update specific fields
      processedAt: new Date().toISOString(),
    },
  },
});
```

## Migration Considerations

### Updating Existing Records

If existing `data_sources` records have incomplete metadata, run a migration:

```typescript
async function migrateExistingFilings() {
  const filings = await prisma.dataSource.findMany({
    where: { type: 'sec_filing' },
  });

  for (const filing of filings) {
    const metadata = filing.metadata as any;

    // Add missing required fields with defaults
    const updatedMetadata = {
      ...metadata,
      processed: metadata.processed ?? false,
      downloadedAt: metadata.downloadedAt ?? filing.createdAt.toISOString(),
    };

    await prisma.dataSource.update({
      where: { id: filing.id },
      data: { metadata: updatedMetadata },
    });
  }
}
```

## Related Documentation

- [Design Document](.kiro/specs/automatic-filing-detection/design.md) - Overall system architecture
- [Requirements](.kiro/specs/automatic-filing-detection/requirements.md) - User stories and acceptance criteria
- [Tasks](.kiro/specs/automatic-filing-detection/tasks.md) - Implementation tasks
- [Prisma Schema](prisma/schema.prisma) - Database schema definition

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2024-02-09 | 1.0.0 | Initial specification based on existing implementation |

