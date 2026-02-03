# Document Upload Testing Guide

Quick guide for testing the document upload functionality in the workspace.

---

## Manual Testing

### 1. Start the Application

```bash
# Terminal 1: Start backend
npm run start:dev

# Terminal 2: Start frontend (if separate)
# Or just open http://localhost:3000
```

### 2. Navigate to Workspace

```
http://localhost:3000/app/deals/workspace.html?ticker=AAPL#research
```

### 3. Test Upload Flow

**Step 1: Click Upload Button**
- Look for "Upload Document" button in research tab header
- Should be blue/indigo colored

**Step 2: Select File**
- Choose a PDF, DOCX, or TXT file
- Max size: 10MB
- Should see progress indicator

**Step 3: Verify Upload**
- Progress bar should show 0-100%
- After completion, click "Documents (1)" button
- Should see uploaded document in list

**Step 4: Check Status**
- Document should show "processing" initially
- After ~30 seconds, refresh and check for "indexed" status
- Green checkmark icon = indexed
- Blue spinner = processing
- Red exclamation = failed

**Step 5: Test Delete**
- Click trash icon on document
- Confirm deletion
- Document should disappear from list

### 4. Test Research Integration

**Step 1: Upload a document with known content**
- Example: Upload a PDF with "Revenue grew 25% YoY"

**Step 2: Ask a question**
- Type: "What does the document say about revenue?"
- Send message

**Step 3: Check citation**
- Response should include citation [1]
- Citation should reference your uploaded document
- Click citation to preview

---

## Automated Testing

### Unit Tests

```bash
# Run all unit tests
npm test

# Run only upload tests
npm test -- test/unit/workspace-document-upload.spec.ts

# Watch mode
npm test -- --watch test/unit/workspace-document-upload.spec.ts
```

**Expected**: 11 tests pass

### E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run only upload E2E tests
npm run test:e2e -- workspace-document-upload

# Run with UI
npm run test:e2e -- --headed workspace-document-upload
```

**Expected**: 10 tests pass

---

## Test Scenarios

### Happy Path

1. ✅ Upload valid PDF file
2. ✅ See progress indicator
3. ✅ Document appears in list
4. ✅ Status changes to "indexed"
5. ✅ Query mentions document content
6. ✅ Citation references document
7. ✅ Delete document successfully

### Error Cases

1. ❌ Upload invalid file type (PNG, JPG)
   - **Expected**: Error message "Invalid file type"

2. ❌ Upload file > 10MB
   - **Expected**: Error message "File too large"

3. ❌ Upload 26th document (limit is 25)
   - **Expected**: API error "Document limit reached"

4. ❌ Delete without confirmation
   - **Expected**: No deletion, dialog dismissed

5. ❌ Network error during upload
   - **Expected**: Error message "Upload failed"

### Edge Cases

1. Upload multiple files sequentially
   - **Expected**: All files upload successfully

2. Upload while another is processing
   - **Expected**: Both process independently

3. Switch tickers while document list is open
   - **Expected**: Document list updates to new ticker

4. Refresh page during upload
   - **Expected**: Upload cancelled, can retry

5. Upload same file twice
   - **Expected**: Two separate documents created

---

## Debugging

### Check Upload API

```bash
# Watch backend logs
npm run start:dev

# Look for:
# - "Starting extraction for document..."
# - "Extracted X characters of text"
# - "Created X chunks"
# - "Document X processed successfully"
```

### Check S3 Storage

```bash
# List uploaded files
aws s3 ls s3://fundlens-documents-dev/{tenantId}/{ticker}/user_uploads/

# Download a file
aws s3 cp s3://fundlens-documents-dev/{tenantId}/{ticker}/user_uploads/{file} ./
```

### Check Database

```sql
-- Check documents
SELECT id, title, ticker, file_type, processed, processing_error, created_at
FROM documents
WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
  AND ticker = 'AAPL'
  AND source_type = 'USER_UPLOAD'
ORDER BY created_at DESC;

-- Check chunks
SELECT COUNT(*) as chunk_count, document_id
FROM document_chunks
WHERE document_id IN (
  SELECT id FROM documents WHERE source_type = 'USER_UPLOAD'
)
GROUP BY document_id;
```

### Check Bedrock KB Sync

```bash
# Check Lambda logs
aws logs tail /aws/lambda/bedrock-kb-sync --follow

# Look for:
# - "Processing S3 event..."
# - "Syncing X chunks to Bedrock KB"
# - "Sync complete"
```

### Browser Console

Open DevTools Console and look for:
- `✅ Upload successful: {...}`
- `✅ Loaded X documents`
- `✅ Document deleted`
- `❌ Upload error: ...`

---

## Common Issues

### Issue: Upload button not visible

**Solution**: 
- Check you're on research tab (#research in URL)
- Check authentication (token in localStorage)
- Check browser console for errors

### Issue: Upload fails with 401

**Solution**:
- Check `fundlens_token` in localStorage
- Regenerate token if expired
- Check backend is running

### Issue: Document stuck in "processing"

**Solution**:
- Check backend logs for extraction errors
- Check file is valid PDF/DOCX/TXT
- Check Python parser is running
- Wait up to 60 seconds for large files

### Issue: Document not appearing in citations

**Solution**:
- Wait for "indexed" status
- Check Bedrock KB sync completed
- Check chunks were created in database
- Try refreshing page and asking again

### Issue: Delete fails

**Solution**:
- Check authentication
- Check document belongs to your tenant
- Check backend logs for errors

---

## Performance Benchmarks

### Upload Times (approximate)

- 1MB PDF: ~2-3 seconds
- 5MB PDF: ~5-10 seconds
- 10MB PDF: ~10-20 seconds

### Processing Times (approximate)

- 10-page PDF: ~10-15 seconds
- 50-page PDF: ~30-45 seconds
- 100-page PDF: ~60-90 seconds

### Query Times (with uploaded docs)

- Simple query: ~2-3 seconds
- Complex query: ~5-8 seconds
- With citations: +1-2 seconds

---

## Test Data

### Sample Documents

Create test documents with known content:

**test-revenue.pdf**:
```
Company XYZ Financial Report
Q4 2023

Revenue: $2.5 billion
Growth: 25% YoY
Gross Margin: 65%
```

**test-risks.pdf**:
```
Risk Factors

1. Market Competition
   - Intense competition from established players
   - Price pressure in key markets

2. Regulatory Changes
   - New data privacy regulations
   - Compliance costs increasing
```

**test-strategy.pdf**:
```
Strategic Initiatives

1. Product Innovation
   - Launch 3 new products in 2024
   - Invest $100M in R&D

2. Market Expansion
   - Enter 5 new markets
   - Target 20% market share
```

### Test Queries

After uploading test documents:

1. "What was the revenue in Q4 2023?"
   - **Expected**: "$2.5 billion" with citation

2. "What are the main risks?"
   - **Expected**: Competition and regulatory with citations

3. "What is the company's strategy?"
   - **Expected**: Product innovation and market expansion with citations

---

## Checklist

Before marking as complete:

- [ ] Upload button visible
- [ ] File picker opens
- [ ] Progress indicator works
- [ ] Document list displays
- [ ] Status icons correct
- [ ] Delete works
- [ ] Citations include uploaded docs
- [ ] Unit tests pass (11/11)
- [ ] E2E tests pass (10/10)
- [ ] No console errors
- [ ] No breaking changes

---

**Last Updated**: January 27, 2026  
**Status**: Ready for testing
