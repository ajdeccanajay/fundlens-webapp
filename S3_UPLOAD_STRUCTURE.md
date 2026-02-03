# S3 Upload Structure Documentation

## Overview

Documents are uploaded to S3 with **tenant-specific prefixes** for complete isolation. The system uses two different S3 path structures depending on which service handles the upload.

## Current S3 Path Structures

### Structure 1: TenantAwareS3Service (NEW - Tenant Isolated)
**Used by**: `DocumentsController` → `DocumentsService` → `TenantAwareS3Service`

```
s3://fundlens-data-lake/
└── tenants/
    └── {tenantId}/
        └── uploads/
            └── {documentId}/
                └── {documentId}.{extension}
```

**Example**:
```
s3://fundlens-data-lake/tenants/00000000-0000-0000-0000-000000000000/uploads/aab82460-6585-4b25-b80d-efadbae3a58b/aab82460-6585-4b25-b80d-efadbae3a58b.pdf
```

**Features**:
- ✅ Full tenant isolation
- ✅ Path traversal protection
- ✅ Security logging
- ✅ Ownership verification on all operations
- ✅ Metadata tagging with tenantId

**Code Location**: `src/tenant/tenant-aware-s3.service.ts`

```typescript
async uploadTenantFile(
  documentId: string,
  filename: string,
  content: Buffer,
  options: TenantFileUploadOptions = {},
): Promise<string> {
  const tenantId = this.getTenantId();
  const s3Key = `${this.getTenantPrefix()}/uploads/${documentId}/${filename}`;
  // Returns: tenants/{tenantId}/uploads/{documentId}/{filename}
}
```

### Structure 2: S3Service (OLD - Simple Path)
**Used by**: `DocumentUploadController` → `DocumentProcessingService` → `S3Service`

```
s3://fundlens-documents-dev/
└── {tenantId}/
    └── user_upload/
        └── {ticker}/
            └── {timestamp}_{filename}
```

**Example**:
```
s3://fundlens-documents-dev/00000000-0000-0000-0000-000000000000/user_upload/AAPL/1738012419000_Apple_DBS.pdf
```

**Features**:
- ✅ Tenant prefix
- ✅ Ticker organization
- ✅ Timestamp for uniqueness
- ❌ No path traversal protection
- ❌ No security logging
- ❌ No ownership verification

**Code Location**: `src/services/s3.service.ts`

```typescript
async uploadFile(file: Express.Multer.File, s3Key: string): Promise<void> {
  // s3Key provided by caller: {tenantId}/user_upload/{ticker}/{timestamp}_{filename}
  await this.s3Client.send(
    new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      Body: file.buffer,
    }),
  );
}
```

## Current Upload Flow

### Frontend Upload Request
```javascript
// public/app/deals/workspace.html
const formData = new FormData();
formData.append('file', file);
formData.append('tenantId', tenantId);
formData.append('ticker', ticker);
formData.append('extractionTier', 'basic');
formData.append('userId', userId);

xhr.open('POST', '/api/documents/upload');
xhr.send(formData);
```

### Backend Processing

**Route**: `POST /api/documents/upload`

**Handler**: `DocumentsController.uploadDocument()` (registered first, takes precedence)

**Flow**:
```
1. DocumentsController.uploadDocument()
   ↓
2. DocumentsService.uploadDocument()
   ↓
3. TenantAwareS3Service.uploadTenantFile()
   ↓
4. S3 Path: tenants/{tenantId}/uploads/{documentId}/{documentId}.pdf
   ↓
5. [NEW FIX] DocumentProcessorService.processDocument() (async)
   ↓
6. Extract text, generate embeddings, store chunks
```

## S3 Bucket Configuration

### Environment Variables
```bash
# Primary bucket for tenant data
S3_DATA_LAKE_BUCKET=fundlens-data-lake

# Legacy bucket for old uploads
S3_BUCKET_NAME=fundlens-documents-dev

# AWS Region
AWS_REGION=us-east-1
```

### Bucket Structure
```
fundlens-data-lake/
├── tenants/                    # Tenant-isolated uploads (NEW)
│   └── {tenantId}/
│       └── uploads/
│           └── {documentId}/
│               └── {filename}
│
└── public/                     # Public SEC filings (shared)
    └── sec/
        └── {ticker}/
            └── {filing}/

fundlens-documents-dev/         # Legacy bucket
└── {tenantId}/
    └── user_upload/
        └── {ticker}/
            └── {timestamp}_{filename}
```

## Security Features

### TenantAwareS3Service Security

1. **Prefix Enforcement**
   ```typescript
   private getTenantPrefix(): string {
     return `tenants/${this.getTenantId()}`;
   }
   ```

2. **Path Traversal Protection**
   ```typescript
   private normalizeS3Key(s3Key: string): string {
     const parts = s3Key.split('/');
     const resolved: string[] = [];
     
     for (const part of parts) {
       if (part === '..') {
         resolved.pop(); // Prevent directory traversal
       } else if (part !== '.' && part !== '') {
         resolved.push(part);
       }
     }
     
     return resolved.join('/');
   }
   ```

3. **Ownership Verification**
   ```typescript
   private isOwnedByTenant(s3Key: string): boolean {
     const normalizedKey = this.normalizeS3Key(s3Key);
     const tenantPrefix = `${this.getTenantPrefix()}/`;
     return normalizedKey.startsWith(tenantPrefix);
   }
   ```

4. **Security Logging**
   ```typescript
   private logSecurityEvent(action: string, s3Key: string, reason: string): void {
     this.logger.warn({
       event: 'S3_ACCESS_DENIED',
       action,
       s3Key,
       reason,
       tenantId: this.getTenantId(),
       userId: this.getUserId(),
       ip: this.request?.ip,
       timestamp: new Date().toISOString(),
     });
   }
   ```

5. **Metadata Tagging**
   ```typescript
   Metadata: {
     tenantId,
     documentId,
     originalFilename: filename,
     uploadedBy: this.getUserId(),
     uploadedAt: new Date().toISOString(),
   },
   Tagging: `visibility=private&tenant=${tenantId}`,
   ```

## Database Records

### Document Record
```typescript
{
  id: "aab82460-6585-4b25-b80d-efadbae3a58b",
  tenantId: "00000000-0000-0000-0000-000000000000",
  ticker: "AAPL",
  title: "Apple DBS.pdf",
  fileType: "pdf",
  documentType: "user_upload",
  sourceType: "USER_UPLOAD",
  s3Bucket: "fundlens-data-lake",
  s3Key: "tenants/00000000-0000-0000-0000-000000000000/uploads/aab82460-6585-4b25-b80d-efadbae3a58b/aab82460-6585-4b25-b80d-efadbae3a58b.pdf",
  fileSize: 200320,
  processed: false,
  createdBy: "user-123",
  createdAt: "2026-01-27T17:33:39.000Z"
}
```

### DataSource Record (for tenant isolation)
```typescript
{
  id: "ds-123",
  type: "upload",
  sourceId: "aab82460-6585-4b25-b80d-efadbae3a58b",
  visibility: "private",
  ownerTenantId: "00000000-0000-0000-0000-000000000000",
  s3Path: "tenants/00000000-0000-0000-0000-000000000000/uploads/aab82460-6585-4b25-b80d-efadbae3a58b/aab82460-6585-4b25-b80d-efadbae3a58b.pdf",
  metadata: {
    ticker: "AAPL",
    title: "Apple DBS.pdf",
    uploadedBy: "user-123",
    originalFilename: "Apple DBS.pdf",
    documentType: "user_upload"
  }
}
```

### DocumentChunk Records (after processing)
```typescript
{
  id: "chunk-1",
  documentId: "aab82460-6585-4b25-b80d-efadbae3a58b",
  tenantId: "00000000-0000-0000-0000-000000000000",
  ticker: "AAPL",
  chunkIndex: 0,
  content: "This is the first chunk of text...",
  embedding: [0.123, 0.456, ...], // 1536-dimensional vector
  tokenCount: 250,
  metadata: {
    tenant_id: "00000000-0000-0000-0000-000000000000",
    documentType: "user_upload",
    ticker: "AAPL",
    visibility: "private",
    documentId: "aab82460-6585-4b25-b80d-efadbae3a58b"
  }
}
```

## Access Patterns

### Upload File
```typescript
// Frontend
POST /api/documents/upload
Body: FormData with file, tenantId, ticker

// Backend
DocumentsController → DocumentsService → TenantAwareS3Service
Result: tenants/{tenantId}/uploads/{documentId}/{filename}
```

### Download File
```typescript
// Get signed URL
GET /api/documents/{documentId}/download

// Backend verifies ownership
if (!isOwnedByTenant(s3Key)) {
  throw new NotFoundException('File not found'); // 404, not 403
}

// Returns signed URL valid for 1 hour
return getSignedUrl(s3Client, GetObjectCommand, { expiresIn: 3600 });
```

### List Files
```typescript
// List tenant's files
GET /api/documents?tenantId={tenantId}&ticker={ticker}

// Backend filters by tenantId
const documents = await prisma.document.findMany({
  where: {
    tenantId: tenantId,
    ticker: ticker,
    sourceType: 'USER_UPLOAD'
  }
});
```

### Delete File
```typescript
// Delete document
DELETE /api/documents/{documentId}

// Backend verifies ownership and deletes from S3
const document = await prisma.document.findFirst({
  where: { id: documentId, tenantId: tenantId }
});

if (!document) {
  throw new NotFoundException('Document not found');
}

await tenantS3Service.deleteTenantFile(document.s3Key);
await prisma.document.delete({ where: { id: documentId } });
```

## Migration Path

### Current State
- ✅ TenantAwareS3Service implemented
- ✅ DocumentsService using TenantAwareS3Service
- ✅ Security features in place
- ⚠️ Old S3Service still used by DocumentProcessingService
- ⚠️ Two different path structures

### Recommended Changes

1. **Consolidate S3 Services**
   - Remove old `S3Service`
   - Update `DocumentProcessingService` to use `TenantAwareS3Service`
   - Standardize on `tenants/{tenantId}/uploads/` structure

2. **Migrate Existing Files**
   ```bash
   # Script to migrate old structure to new structure
   aws s3 sync \
     s3://fundlens-documents-dev/{tenantId}/user_upload/ \
     s3://fundlens-data-lake/tenants/{tenantId}/uploads/ \
     --metadata tenant_id={tenantId},visibility=private
   ```

3. **Update Database Records**
   ```sql
   UPDATE documents
   SET s3_bucket = 'fundlens-data-lake',
       s3_key = REPLACE(s3_key, 
         '{tenantId}/user_upload/', 
         'tenants/{tenantId}/uploads/')
   WHERE source_type = 'USER_UPLOAD';
   ```

## Testing

### Test Upload
```bash
# Upload a test file
curl -X POST http://localhost:3000/api/documents/upload \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -F "file=@test.pdf" \
  -F "ticker=AAPL" \
  -F "documentType=user_upload"
```

### Verify S3 Path
```bash
# Check S3 structure
aws s3 ls s3://fundlens-data-lake/tenants/ --recursive

# Expected output:
# tenants/00000000-0000-0000-0000-000000000000/uploads/aab82460.../aab82460....pdf
```

### Check Database
```sql
SELECT id, tenant_id, ticker, s3_key, processed
FROM documents
WHERE source_type = 'USER_UPLOAD'
ORDER BY created_at DESC
LIMIT 5;
```

## Summary

**Current Upload Path**:
```
Frontend → POST /api/documents/upload
         → DocumentsController.uploadDocument()
         → DocumentsService.uploadDocument()
         → TenantAwareS3Service.uploadTenantFile()
         → S3: tenants/{tenantId}/uploads/{documentId}/{filename}
         → [NEW] DocumentProcessorService.processDocument() (async)
```

**S3 Structure**:
```
fundlens-data-lake/
└── tenants/
    └── {tenantId}/
        └── uploads/
            └── {documentId}/
                └── {documentId}.pdf
```

**Security**: Full tenant isolation with path traversal protection, ownership verification, and security logging.

**Processing**: Async text extraction, chunking, embedding generation, and database storage.
