# Testing Strategy - ChatGPT-Like Research Assistant

## Testing Philosophy

**Test-Driven Development (TDD) Approach**:
1. Write tests FIRST (or immediately after implementation)
2. Run tests to verify functionality
3. Refactor with confidence
4. Maintain high test coverage (>80%)

## Testing Pyramid

```
           ┌─────────────┐
           │   E2E Tests │  (10%)
           │  Integration│
           └─────────────┘
         ┌─────────────────┐
         │  Integration    │  (20%)
         │     Tests       │
         └─────────────────┘
       ┌───────────────────────┐
       │    Unit Tests         │  (70%)
       │  (Fast, Isolated)     │
       └───────────────────────┘
```

## Unit Testing Standards

### Coverage Requirements
- **Minimum**: 80% code coverage
- **Target**: 90%+ for critical paths
- **Services**: 100% of public methods
- **Controllers**: 100% of endpoints
- **Edge Cases**: All error scenarios

### Test Structure (AAA Pattern)
```typescript
describe('ServiceName', () => {
  // Arrange
  beforeEach(() => {
    // Setup mocks and dependencies
  });

  describe('methodName', () => {
    it('should handle success case', () => {
      // Arrange - Setup test data
      // Act - Execute the method
      // Assert - Verify results
    });

    it('should handle error case', () => {
      // Test error scenarios
    });

    it('should handle edge case', () => {
      // Test boundary conditions
    });
  });
});
```

### Mocking Strategy
- **External Services**: Always mock (S3, Bedrock, Database)
- **Internal Services**: Mock dependencies, test in isolation
- **Data**: Use realistic test fixtures
- **Time**: Mock Date.now() for consistency

## Test Files Created (Phase 1-2)

### Phase 1: Database Schema ✅
- ✅ `scripts/verify-user-documents-schema.js` - Schema verification
- ✅ Manual verification of Prisma client generation
- ✅ Database migration validation

### Phase 2: Document Upload & Extraction ✅

#### Unit Tests
1. **`test/unit/document-processing.service.spec.ts`** (15+ tests)
   - ✅ processDocument() - End-to-end flow
   - ✅ extractText() - PDF/DOCX/TXT extraction
   - ✅ extractMetadata() - Claude-based extraction
   - ✅ chunkText() - Chunking algorithm
   - ✅ generateEmbeddings() - Batch processing
   - ✅ extractTables() - Table detection
   - ✅ extractInlineMetrics() - Metric extraction
   - ✅ Error handling and fallbacks

2. **`test/unit/document-upload.controller.spec.ts`** (15+ tests)
   - ✅ uploadDocument() - File upload validation
   - ✅ listDocuments() - Filtering and pagination
   - ✅ getDocument() - Document retrieval
   - ✅ getDocumentStatus() - Status tracking
   - ✅ deleteDocument() - Deletion logic
   - ✅ Tenant validation
   - ✅ Document limit enforcement
   - ✅ Error scenarios

**Total Unit Tests**: 30+ tests

## Testing Workflow

### After Each Code Change

1. **Write/Update Tests**
   ```bash
   # Create test file
   touch test/unit/new-service.spec.ts
   
   # Write tests following AAA pattern
   ```

2. **Run Tests**
   ```bash
   # Run specific test file
   npm test -- test/unit/new-service.spec.ts
   
   # Run all unit tests
   npm run test:unit
   
   # Run with coverage
   npm run test:cov
   ```

3. **Verify Coverage**
   ```bash
   # Check coverage report
   open coverage/lcov-report/index.html
   ```

4. **Fix Failures**
   - Debug failing tests
   - Update implementation or tests
   - Re-run until all pass

5. **Commit**
   ```bash
   git add .
   git commit -m "feat: implement X with tests"
   ```

## Test Commands

### Unit Tests
```bash
# Run all unit tests
npm run test:unit

# Run specific test file
npm test -- test/unit/document-processing.service.spec.ts

# Run tests in watch mode
npm test -- --watch

# Run with coverage
npm run test:cov
```

### Integration Tests
```bash
# Run all integration tests
npm run test:integration

# Run specific integration test
npm test -- test/integration/document-upload.integration.spec.ts
```

### E2E Tests
```bash
# Run all E2E tests
npm run test:e2e

# Run specific E2E test
npm test -- test/e2e/document-upload-flow.e2e-spec.ts
```

## Phase 3: RAG Integration - Testing Plan

### Unit Tests to Create

1. **`test/unit/document-rag.service.spec.ts`**
   - [ ] searchUserDocuments() - Vector search with tenant filter
   - [ ] mergeResults() - Combine user docs + SEC filings
   - [ ] rerankResults() - Relevance scoring
   - [ ] extractCitations() - Citation parsing
   - [ ] storeCitations() - Database storage

2. **`test/unit/citation.service.spec.ts`**
   - [ ] createCitation() - Citation creation
   - [ ] getCitationPreview() - Preview generation
   - [ ] linkCitationToChunk() - Chunk linking
   - [ ] validateCitation() - Validation logic

3. **`test/unit/hybrid-rag.service.spec.ts`**
   - [ ] queryWithUserDocuments() - Unified query
   - [ ] buildPromptWithCitations() - Prompt construction
   - [ ] streamResponseWithCitations() - Streaming logic

### Integration Tests to Create

1. **`test/integration/document-upload-to-rag.integration.spec.ts`**
   - [ ] Upload document → Extract → Store → Query → Retrieve
   - [ ] Verify vector search returns correct chunks
   - [ ] Verify tenant isolation in queries

2. **`test/integration/citation-flow.integration.spec.ts`**
   - [ ] Query → Generate response → Extract citations → Store
   - [ ] Retrieve citation preview
   - [ ] Verify citation links to correct chunks

### E2E Tests to Create

1. **`test/e2e/document-upload-query.e2e-spec.ts`**
   - [ ] Full flow: Upload → Process → Query → Get answer with citations
   - [ ] Verify citations display correctly
   - [ ] Test cross-ticker search

## Test Data & Fixtures

### Test Documents
```
test/fixtures/documents/
├── sample-pitch-deck.pdf
├── sample-financial-report.docx
├── sample-analysis.txt
└── sample-with-tables.pdf
```

### Mock Data
```typescript
// test/fixtures/mock-data.ts
export const mockDocument = {
  id: 'doc-123',
  tenantId: 'tenant-123',
  ticker: 'AAPL',
  // ...
};

export const mockChunk = {
  id: 'chunk-123',
  content: 'Sample chunk content',
  embedding: new Array(1536).fill(0.1),
  // ...
};

export const mockCitation = {
  id: 'citation-123',
  messageId: 'msg-123',
  documentId: 'doc-123',
  chunkId: 'chunk-123',
  quote: 'Revenue increased to $2.5B',
  // ...
};
```

## Continuous Integration

### GitHub Actions Workflow
```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npm run test:e2e
      - run: npm run test:cov
      - uses: codecov/codecov-action@v2
```

## Test Maintenance

### Regular Tasks
- [ ] Review and update tests monthly
- [ ] Remove obsolete tests
- [ ] Add tests for bug fixes
- [ ] Refactor tests with code changes
- [ ] Update mock data to match schema changes

### Code Review Checklist
- [ ] All new code has tests
- [ ] Tests follow AAA pattern
- [ ] Mocks are properly configured
- [ ] Edge cases are covered
- [ ] Error scenarios are tested
- [ ] Tests are readable and maintainable

## Performance Testing

### Load Tests (Future)
```typescript
// test/performance/document-upload.perf.spec.ts
describe('Document Upload Performance', () => {
  it('should handle 25 concurrent uploads', async () => {
    const uploads = Array(25).fill(null).map(() => 
      uploadDocument(mockFile)
    );
    
    const start = Date.now();
    await Promise.all(uploads);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(60000); // < 60 seconds
  });
});
```

## Success Metrics

### Current Status (Phase 1-2)
- ✅ **Unit Test Coverage**: 30+ tests created
- ✅ **Services Tested**: DocumentProcessingService, DocumentUploadController
- ✅ **Test Patterns**: AAA pattern, proper mocking
- ✅ **Error Handling**: All error scenarios covered

### Phase 3 Goals
- [ ] **Unit Test Coverage**: 50+ total tests
- [ ] **Integration Tests**: 5+ integration tests
- [ ] **E2E Tests**: 3+ end-to-end tests
- [ ] **Code Coverage**: >85%
- [ ] **All Tests Passing**: 100% pass rate

## Testing Best Practices

### DO ✅
- Write tests for all public methods
- Test error scenarios
- Use descriptive test names
- Mock external dependencies
- Keep tests fast (<100ms per test)
- Test one thing per test
- Use realistic test data

### DON'T ❌
- Test implementation details
- Write flaky tests
- Skip error scenarios
- Use real external services
- Write slow tests
- Test multiple things in one test
- Use magic numbers without explanation

## Next Steps

1. **Phase 3 Implementation**: RAG Integration
   - Write tests FIRST for new services
   - Run tests after each change
   - Maintain >80% coverage

2. **Integration Testing**: Document upload to RAG flow
   - Test full pipeline
   - Verify tenant isolation
   - Test performance

3. **E2E Testing**: User-facing flows
   - Upload → Query → Citations
   - Frontend integration
   - Cross-browser testing

---

**Testing is not optional - it's part of the implementation!**

Every code change must include corresponding tests.
