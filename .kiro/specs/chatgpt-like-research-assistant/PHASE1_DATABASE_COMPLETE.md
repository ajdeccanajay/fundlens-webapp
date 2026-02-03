# Phase 1: Database Schema - COMPLETE ✅

## Summary

Successfully implemented Phase 1 of the ChatGPT-like Research Assistant feature. The database schema has been updated to support document uploads, vector embeddings, and citation tracking.

## Changes Made

### 1. Prisma Schema Updates (`prisma/schema.prisma`)

#### Extended `Document` Model
- ✅ Added `sourceType` field (USER_UPLOAD | SEC_FILING)
- ✅ Added `createdBy` field for audit tracking
- ✅ Added `citations` relation to Citation model
- ✅ Added indexes for `tenantId + sourceType` and `tenantId + ticker`

#### Extended `DocumentChunk` Model
- ✅ Added `tenantId` field (required for tenant isolation)
- ✅ Added `ticker` field (for cross-ticker search)
- ✅ Added `embedding` field as `vector(1536)` for pgvector
- ✅ Added `pageNumber` field (for PDF citations)
- ✅ Changed `content` to TEXT type (was VARCHAR)
- ✅ Added `citations` relation to Citation model
- ✅ Added index for `tenantId + ticker`

#### Extended `Message` Model (Research Assistant)
- ✅ Added `ticker` field (to associate messages with companies)
- ✅ Added `citations` relation to Citation model

#### New `Citation` Model
- ✅ Created complete model with all required fields:
  - `id`, `tenantId`, `messageId`, `documentId`, `chunkId`
  - `quote`, `pageNumber`, `relevanceScore`
  - `createdAt`
- ✅ Added foreign key relations to Message, Document, and DocumentChunk
- ✅ Added indexes for efficient queries:
  - `tenantId + messageId` (primary lookup)
  - `documentId` (document-based queries)
  - `chunkId` (chunk-based queries)

### 2. Database Migration (`prisma/migrations/20250127_add_user_documents_and_citations.sql`)

Created comprehensive migration with:
- ✅ pgvector extension installation
- ✅ ALTER TABLE statements for existing tables (idempotent)
- ✅ CREATE TABLE for citations
- ✅ Vector index creation using ivfflat for performance
- ✅ Data backfill for `tenant_id` in document_chunks
- ✅ Comments for documentation

### 3. Migration Script (`scripts/apply-user-documents-migration.js`)

Created automated migration script with:
- ✅ SQL file parsing and execution
- ✅ Error handling for idempotent operations
- ✅ Verification checks for all changes
- ✅ Detailed logging and progress tracking
- ✅ Summary report with next steps

## Migration Results

```
✅ pgvector extension: INSTALLED
✅ citations table: CREATED
✅ document_chunks.embedding: ADDED
✅ research_messages.ticker: ADDED
✅ documents.source_type: ADDED
```

All 18 SQL statements executed successfully!

## Database Schema Summary

### Tables Modified
1. **documents** - Extended with source_type and created_by
2. **document_chunks** - Extended with tenant_id, ticker, embedding, page_number
3. **research_messages** - Extended with ticker

### Tables Created
1. **citations** - New table for source attribution

### Indexes Created
- `idx_documents_tenant_source` - Fast lookup by tenant and source type
- `idx_documents_tenant_ticker` - Fast lookup by tenant and ticker
- `idx_chunks_tenant_ticker` - Fast lookup of chunks by tenant and ticker
- `idx_chunks_embedding` - Vector similarity search (ivfflat)
- `idx_citations_tenant_message` - Fast citation lookup by message
- `idx_citations_document` - Fast citation lookup by document
- `idx_citations_chunk` - Fast citation lookup by chunk

## Vector Search Capability

The pgvector extension enables:
- **Semantic search** across document chunks using cosine similarity
- **Cross-ticker search** - Find relevant content across all companies for a tenant
- **Efficient retrieval** - ivfflat index for fast approximate nearest neighbor search
- **1536-dimensional embeddings** - Compatible with AWS Bedrock Titan embeddings

## Multi-Tenancy & Security

All new fields and tables maintain strict tenant isolation:
- ✅ `tenantId` field on all relevant tables
- ✅ Indexes include `tenantId` for query performance
- ✅ Foreign key constraints ensure referential integrity
- ✅ Cascade deletes maintain data consistency

## Cost Optimization

The schema is designed for minimal costs:
- **No separate vector database** - Uses PostgreSQL + pgvector
- **Efficient indexing** - ivfflat reduces search time
- **Tenant-scoped queries** - Reduces data scanned
- **25 document limit** - Keeps storage and compute costs low

## Next Steps (Phase 2: Document Upload)

Now that the database is ready, proceed with:

1. **Document Upload Controller** (`src/documents/document-upload.controller.ts`)
   - File validation (PDF/DOCX/TXT, max 10MB)
   - S3 upload with tenant/ticker path
   - Store metadata in documents table

2. **Document Processing Service** (`src/documents/document-processing.service.ts`)
   - Text extraction (pdf-parse, mammoth)
   - Chunking (1000 chars, 200 overlap)
   - Embedding generation (Bedrock Titan)
   - Store chunks with vectors

3. **Document Management API**
   - GET /api/documents?ticker=AAPL
   - POST /api/documents/upload
   - DELETE /api/documents/:id
   - GET /api/documents/:id/status

## Testing

To verify the migration:

```bash
# Check pgvector extension
psql $DATABASE_URL -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# Check citations table
psql $DATABASE_URL -c "\d citations"

# Check document_chunks columns
psql $DATABASE_URL -c "\d document_chunks"

# Check research_messages columns
psql $DATABASE_URL -c "\d research_messages"
```

## Files Modified

1. `prisma/schema.prisma` - Schema updates
2. `prisma/migrations/20250127_add_user_documents_and_citations.sql` - Migration SQL
3. `scripts/apply-user-documents-migration.js` - Migration script

## Prisma Client

✅ Regenerated with `npx prisma generate`

The TypeScript types are now available for:
- `Citation` model
- Updated `Document`, `DocumentChunk`, `Message` models
- Vector field type support

## Timeline

- **Planned**: Day 1-2 of Week 1
- **Actual**: Completed in 1 session
- **Status**: ✅ COMPLETE - Ready for Phase 2

---

**Phase 1 Complete!** The database foundation is ready for document uploads, vector search, and citation tracking. Moving to Phase 2: Document Upload & Processing.
