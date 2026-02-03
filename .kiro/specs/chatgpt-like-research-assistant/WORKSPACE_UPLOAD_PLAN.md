# Workspace Document Upload Integration Plan

**Goal**: Add document upload functionality to workspace research tab  
**Target**: `public/app/deals/workspace.html#research`  
**Approach**: Use existing document upload API, integrate with workspace UI

---

## Requirements

1. **Upload UI in Workspace**
   - File picker button in research tab
   - Drag-and-drop support
   - Upload progress indicator
   - Document list with status

2. **S3 Storage**
   - Save under deal (with ticker)
   - Follow existing pipeline structure: `{tenantId}/user_upload/{ticker}/`
   - Use existing DocumentProcessingService

3. **Data Extraction**
   - Extract quantitative data (if applicable)
   - Extract qualitative data (narratives)
   - Use existing extraction pipeline

4. **Bedrock KB Sync**
   - Automatic sync via S3 Lambda
   - Use existing kb-sync infrastructure
   - Chunks indexed immediately

5. **Testing**
   - Unit tests for upload functions
   - Frontend tests for UI
   - E2E tests for full flow

---

## Implementation Phases

### Phase 1: Add Upload UI (15 min)
- Add upload button in research tab header
- Add file input (hidden)
- Add document list section
- Add upload progress indicator

### Phase 2: Add Upload JavaScript (20 min)
- Add upload function
- Add progress tracking
- Add document list loading
- Add delete function
- Handle errors

### Phase 3: Testing (25 min)
- Unit tests for upload functions
- Frontend tests for UI interactions
- E2E tests for upload flow

---

## API Endpoints (Already Exist)

```
POST   /api/documents/upload          # Upload document
GET    /api/documents?tenantId=X&ticker=Y  # List documents
GET    /api/documents/:id             # Get document details
GET    /api/documents/:id/status      # Get processing status
DELETE /api/documents/:id             # Delete document
```

---

## S3 Structure (Existing)

```
s3://fundlens-documents-{env}/
  {tenantId}/
    user_upload/
      {ticker}/
        {documentId}/
          original.{ext}
          metadata.json
```

---

## Data Flow

```
1. User uploads file in workspace
   ↓
2. POST /api/documents/upload
   - tenantId: from user context
   - ticker: from workspace URL
   - file: uploaded file
   ↓
3. DocumentProcessingService
   - Upload to S3
   - Extract text
   - Extract metadata
   - Chunk text
   - Generate embeddings
   - Store in PostgreSQL
   ↓
4. S3 Lambda Trigger (automatic)
   - Detect new file in S3
   - Sync chunks to Bedrock KB
   - Update sync status
   ↓
5. Document indexed and searchable
```

---

## UI Design

```
┌─────────────────────────────────────────┐
│  Research Assistant                     │
│  [Upload Document] [📄 Documents (3)]   │
├─────────────────────────────────────────┤
│  [User Message]                         │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Response with citations [1]     │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [Type your message...]        [Send]  │
└─────────────────────────────────────────┘

Document List (when clicked):
┌─────────────────────────────────────────┐
│  Documents for AAPL                     │
├─────────────────────────────────────────┤
│  ✅ annual-report.pdf (2.3 MB)          │
│     Indexed • 15 chunks • 2 min ago     │
│     [Delete]                            │
│                                         │
│  ⏳ quarterly-results.pdf (1.1 MB)      │
│     Processing... 45%                   │
│                                         │
│  ❌ invalid-file.txt (0.5 MB)           │
│     Failed: Invalid format              │
│     [Delete]                            │
└─────────────────────────────────────────┘
```

---

## Success Criteria

- [ ] Upload button visible in workspace
- [ ] File picker works
- [ ] Upload progress shows
- [ ] Documents list displays
- [ ] Delete works
- [ ] Citations include uploaded docs
- [ ] Unit tests pass
- [ ] Frontend tests pass
- [ ] E2E tests pass

---

## Estimated Time

- Phase 1 (UI): 15 minutes
- Phase 2 (JavaScript): 20 minutes
- Phase 3 (Testing): 25 minutes
- **Total**: 60 minutes

---

**Ready to implement!**
