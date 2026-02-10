# SEC Filing Metadata - Quick Reference

## TL;DR

When storing SEC filings in `data_sources`, use the `SECFilingMetadata` interface and helper functions:

```typescript
import { createSECFilingMetadata, markAsProcessed } from '@/filings/types/sec-filing-metadata.interface';

// Creating new filing metadata
const metadata = createSECFilingMetadata({
  ticker: 'AAPL',
  filingType: '10-K',
  accessionNumber: '0000320193-24-000123',
  filingDate: '2024-11-01',
  reportDate: '2024-09-30',
});

// After processing
const processed = markAsProcessed(metadata);
```

## Required Fields

| Field | Type | Example |
|-------|------|---------|
| `ticker` | string | `"AAPL"` |
| `filingType` | `"10-K"` \| `"10-Q"` \| `"8-K"` | `"10-K"` |
| `accessionNumber` | string | `"0000320193-24-000123"` |
| `filingDate` | string (ISO 8601) | `"2024-11-01"` |
| `reportDate` | string (ISO 8601) | `"2024-09-30"` |
| `processed` | boolean | `false` |
| `downloadedAt` | string (ISO 8601) | `"2024-11-02T06:15:00.000Z"` |

## Common Operations

### 1. Create New Filing Record

```typescript
import { createSECFilingMetadata } from '@/filings/types/sec-filing-metadata.interface';

const metadata = createSECFilingMetadata({
  ticker: 'AAPL',
  filingType: '10-K',
  accessionNumber: '0000320193-24-000123',
  filingDate: '2024-11-01',
  reportDate: '2024-09-30',
});

await prisma.dataSource.create({
  data: {
    type: 'sec_filing',
    sourceId: `${metadata.ticker}-${metadata.filingType}-${metadata.accessionNumber}`,
    visibility: 'public',
    ownerTenantId: null,
    s3Path: `public/sec-filings/${metadata.ticker}/${metadata.filingType}/${metadata.accessionNumber}/`,
    metadata,
  },
});
```

### 2. Check if Filing Exists

```typescript
import { SECFilingMetadata } from '@/filings/types/sec-filing-metadata.interface';

const existingFilings = await prisma.dataSource.findMany({
  where: {
    type: 'sec_filing',
    metadata: {
      path: ['ticker'],
      equals: ticker,
    },
  },
});

const existingAccessions = new Set(
  existingFilings.map(f => (f.metadata as SECFilingMetadata).accessionNumber)
);

const isNew = !existingAccessions.has(filing.accessionNumber);
```

### 3. Find Unprocessed Filings

```typescript
const unprocessed = await prisma.dataSource.findMany({
  where: {
    type: 'sec_filing',
    metadata: {
      path: ['processed'],
      equals: false,
    },
  },
});
```

### 4. Mark Filing as Processed

```typescript
import { SECFilingMetadata, markAsProcessed } from '@/filings/types/sec-filing-metadata.interface';

const filing = await prisma.dataSource.findUnique({ where: { id } });
const metadata = filing.metadata as SECFilingMetadata;
const processed = markAsProcessed(metadata);

await prisma.dataSource.update({
  where: { id },
  data: { metadata: processed },
});
```

### 5. Validate Metadata

```typescript
import { validateSECFilingMetadata } from '@/filings/types/sec-filing-metadata.interface';

try {
  validateSECFilingMetadata(metadata);
  // Metadata is valid
} catch (error) {
  // Handle validation error
  console.error(error.message);
}
```

## Helper Functions

### Type Guards

```typescript
import { isSECFilingMetadata, isFilingProcessed } from '@/filings/types/sec-filing-metadata.interface';

if (isSECFilingMetadata(metadata)) {
  // TypeScript knows metadata is SECFilingMetadata
  console.log(metadata.ticker);
}

if (isFilingProcessed(metadata)) {
  console.log('Filing has been processed');
}
```

### Extractors

```typescript
import { getTickerFromMetadata } from '@/filings/types/sec-filing-metadata.interface';

const ticker = getTickerFromMetadata(dataSource.metadata);
if (ticker) {
  console.log(`Ticker: ${ticker}`);
}
```

## Validation Rules

### Ticker
- **Format**: 1-5 uppercase letters
- **Valid**: `"AAPL"`, `"F"`, `"GOOGL"`
- **Invalid**: `"aapl"` (lowercase), `"TOOLONG"` (>5 chars), `"123"` (numbers)

### Filing Type
- **Valid**: `"10-K"`, `"10-Q"`, `"8-K"`
- **Invalid**: `"10-X"`, `"10K"` (no dash), `"10-k"` (lowercase)

### Dates
- **Format**: ISO 8601 date string (`YYYY-MM-DD`)
- **Valid**: `"2024-11-01"`
- **Invalid**: `"11/01/2024"`, `"2024-11-1"`, `"invalid-date"`

### Timestamps
- **Format**: ISO 8601 with timezone (`YYYY-MM-DDTHH:mm:ss.sssZ`)
- **Valid**: `"2024-11-02T06:15:00.000Z"`
- **Invalid**: `"2024-11-02 06:15:00"`, `"2024-11-02T06:15:00"` (no timezone)

### Processed
- **Type**: Boolean
- **Valid**: `true`, `false`
- **Invalid**: `"true"`, `"false"`, `1`, `0`

## Common Mistakes

### ❌ Don't: Use lowercase ticker
```typescript
const metadata = {
  ticker: 'aapl', // Wrong!
  // ...
};
```

### ✅ Do: Use uppercase ticker
```typescript
const metadata = createSECFilingMetadata({
  ticker: 'AAPL', // Correct!
  // ...
});
```

### ❌ Don't: Use string for processed
```typescript
const metadata = {
  processed: 'false', // Wrong!
  // ...
};
```

### ✅ Do: Use boolean for processed
```typescript
const metadata = {
  processed: false, // Correct!
  // ...
};
```

### ❌ Don't: Forget to validate
```typescript
await prisma.dataSource.create({
  data: { metadata: untrustedMetadata }, // Risky!
});
```

### ✅ Do: Always validate
```typescript
validateSECFilingMetadata(metadata);
await prisma.dataSource.create({
  data: { metadata }, // Safe!
});
```

### ❌ Don't: Manually construct metadata
```typescript
const metadata = {
  ticker: ticker.toUpperCase(),
  filingType,
  accessionNumber,
  filingDate,
  reportDate,
  processed: false,
  downloadedAt: new Date().toISOString(),
}; // Verbose and error-prone
```

### ✅ Do: Use helper function
```typescript
const metadata = createSECFilingMetadata({
  ticker,
  filingType,
  accessionNumber,
  filingDate,
  reportDate,
}); // Concise and validated
```

## TypeScript Integration

### Import Types

```typescript
import { SECFilingMetadata } from '@/filings/types/sec-filing-metadata.interface';
```

### Type Assertions

```typescript
const metadata = dataSource.metadata as SECFilingMetadata;
console.log(metadata.ticker); // TypeScript knows the type
```

### Type Guards

```typescript
if (isSECFilingMetadata(dataSource.metadata)) {
  // TypeScript narrows the type automatically
  console.log(dataSource.metadata.ticker);
}
```

## Related Files

- **Specification**: `.kiro/specs/automatic-filing-detection/DATA_SOURCES_METADATA_SPEC.md`
- **Interface**: `src/filings/types/sec-filing-metadata.interface.ts`
- **Tests**: `test/unit/sec-filing-metadata.spec.ts`
- **Design**: `.kiro/specs/automatic-filing-detection/design.md`

## Examples from Codebase

### SECSyncService

```typescript
// src/s3/sec-sync.service.ts
private async createDataSource(
  ticker: string,
  filingType: string,
  filing: any,
): Promise<void> {
  const metadata = createSECFilingMetadata({
    ticker,
    filingType,
    accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    form: filing.form,
    size: filing.size,
  });

  await this.prisma.dataSource.upsert({
    where: {
      type_sourceId: {
        type: 'sec_filing',
        sourceId: `${ticker}-${filingType}-${filing.accessionNumber}`,
      },
    },
    create: {
      type: 'sec_filing',
      sourceId: `${ticker}-${filingType}-${filing.accessionNumber}`,
      visibility: 'public',
      ownerTenantId: null,
      s3Path: this.s3.getSECFilingPath(ticker, filingType, filing.accessionNumber),
      metadata,
    },
    update: { metadata },
  });
}
```

### FilingDetectorService

```typescript
// src/filings/filing-detector.service.ts
private async filterNewFilings(
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
    select: { metadata: true },
  });

  const existingSet = new Set(
    existingAccessions.map(ds => (ds.metadata as SECFilingMetadata).accessionNumber)
  );

  return filings.filter(f => !existingSet.has(f.accessionNumber));
}
```

### SECProcessingService

```typescript
// src/s3/sec-processing.service.ts
async processFiling(
  ticker: string,
  filingType: string,
  accessionNumber: string,
): Promise<ProcessingResult> {
  // ... processing logic ...

  // Mark as processed
  const filing = await this.prisma.dataSource.findFirst({
    where: {
      type: 'sec_filing',
      metadata: {
        path: ['accessionNumber'],
        equals: accessionNumber,
      },
    },
  });

  const metadata = filing.metadata as SECFilingMetadata;
  const processed = markAsProcessed(metadata);

  await this.prisma.dataSource.update({
    where: { id: filing.id },
    data: { metadata: processed },
  });
}
```

## Need Help?

- **Full Specification**: See `DATA_SOURCES_METADATA_SPEC.md` for complete details
- **Type Definitions**: See `src/filings/types/sec-filing-metadata.interface.ts`
- **Test Examples**: See `test/unit/sec-filing-metadata.spec.ts` for usage examples
- **Design Document**: See `.kiro/specs/automatic-filing-detection/design.md` for architecture
