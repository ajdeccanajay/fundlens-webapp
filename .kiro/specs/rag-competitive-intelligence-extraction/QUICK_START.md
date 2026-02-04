# Quick Start Guide: RAG Competitive Intelligence Extraction

## 🚀 Getting Started in 5 Minutes

This guide gets you started with implementing the RAG Competitive Intelligence Extraction feature.

---

## Step 1: Create Baseline Git Tag (2 minutes)

Before making any changes, create a baseline tag so you can rollback if needed:

```bash
# Ensure you're on main branch with latest changes
git checkout main
git pull origin main

# Create baseline tag
git tag -a rag-extraction-baseline -m "Baseline: System state before RAG extraction improvements"
git push origin rag-extraction-baseline

# Verify tag was created
git tag -l "rag-extraction-*"
```

✅ **Checkpoint**: You should see `rag-extraction-baseline` in the tag list.

---

## Step 2: Update CHANGELOG (1 minute)

Open `CHANGELOG-RAG-EXTRACTION.md` and add the baseline date:

```markdown
## Baseline (Pre-Implementation)

**Tag**: `rag-extraction-baseline`
**Date**: 2026-02-03  <-- ADD TODAY'S DATE
**Status**: Current system state
```

Commit the change:

```bash
git add CHANGELOG-RAG-EXTRACTION.md
git commit -m "docs: add baseline date to RAG extraction changelog"
git push origin main
```

---

## Step 3: Choose Your Starting Phase (1 minute)

Open `.kiro/specs/rag-competitive-intelligence-extraction/tasks.md` and decide which phase to start:

### Recommended: Start with Phase 1
**Why**: Low risk, foundational, required for all other phases

**What you'll build**:
- Subsection identification in Python parser
- Database schema changes
- Bedrock KB metadata sync

**Time**: 1-2 weeks

### Alternative: Jump to Phase 2 (if Phase 1 is complete)
**Why**: This is where the magic happens - actual extraction

**What you'll build**:
- Intent detection
- Subsection-aware retrieval
- Structured extraction
- Confidence scoring

**Time**: 2-3 weeks

---

## Step 4: Start Your First Task (1 minute)

### If Starting Phase 1:

Open `tasks.md` and find:
```markdown
- [ ] 1. Create baseline git tag and CHANGELOG
```

✅ You already completed this! Mark it done:
```markdown
- [x] 1. Create baseline git tag and CHANGELOG
```

Now start the next task:
```markdown
- [ ] 2. Enhance Python Section Parser for subsection identification
  - [ ] 2.1 Implement subsection identification for Item 1 (Business)
```

Click "Start task 2.1" or begin implementation manually.

### If Starting Phase 2 (Phase 1 complete):

Open `tasks.md` and find:
```markdown
- [ ] 6. Enhance Intent Detector for subsection targeting
  - [ ] 6.1 Implement competitive intelligence intent detection
```

Click "Start task 6.1" or begin implementation manually.

---

## Step 5: Set Up Your Development Environment

### Install Dependencies (if not already installed)

```bash
# TypeScript/Node.js dependencies
npm install

# Python dependencies
cd python_parser
pip install -r requirements.txt
cd ..
```

### Set Up Feature Flags

Create or update `.env`:

```bash
# Phase 1 (no flags needed yet)

# Phase 2 (when you get there)
FEATURE_SUBSECTION_FILTERING=true
FEATURE_STRUCTURED_EXTRACTION=true
FEATURE_CONFIDENCE_SCORING=true

# Phase 3 (when you get there)
FEATURE_RERANKING=true
FEATURE_HYDE=true
FEATURE_QUERY_DECOMPOSITION=true
FEATURE_CONTEXTUAL_EXPANSION=true
FEATURE_ITERATIVE_RETRIEVAL=true

# Phase 4 (when you get there)
FEATURE_DYNAMIC_CALCULATIONS=true
FEATURE_FORMULA_CACHE=true
FEATURE_CHART_GENERATION=true
FEATURE_CODE_INTERPRETER=true
FEATURE_MULTI_MODAL_RESPONSES=true
```

### Run Tests to Verify Setup

```bash
# Run all tests
npm test

# Run specific phase tests (when you have them)
npm test -- --grep "Phase 1"
npm test -- --grep "Phase 2"
```

---

## Phase 1 Implementation Checklist

Use this checklist to track your progress through Phase 1:

### Week 1: Python Parser Enhancement

- [ ] **Day 1-2**: Implement Item 1 (Business) subsection identification
  - [ ] Add pattern matching for Competition, Products, Customers, etc.
  - [ ] Write unit tests for Item 1 subsections
  - [ ] Test on NVDA, AAPL, AMZN 10-K filings

- [ ] **Day 3-4**: Implement Item 7 (MD&A) subsection identification
  - [ ] Add pattern matching for Results of Operations, Liquidity, etc.
  - [ ] Write unit tests for Item 7 subsections
  - [ ] Test on multiple companies

- [ ] **Day 5**: Implement Item 8 and Item 1A subsection identification
  - [ ] Add pattern matching for footnotes and risk factors
  - [ ] Write unit tests
  - [ ] Test on multiple companies

### Week 2: Database and Bedrock KB Integration

- [ ] **Day 1**: Create database migration
  - [ ] Add subsection_name column
  - [ ] Create index
  - [ ] Test migration on dev database

- [ ] **Day 2**: Update chunk creation logic
  - [ ] Populate subsection_name when creating chunks
  - [ ] Handle null subsection_name gracefully
  - [ ] Test backward compatibility

- [ ] **Day 3-4**: Update Bedrock KB sync
  - [ ] Export subsection_name in metadata
  - [ ] Configure Bedrock KB to index subsection_name
  - [ ] Test metadata filtering

- [ ] **Day 5**: Write property tests and complete Phase 1
  - [ ] Property test for universal subsection identification
  - [ ] Property test for metadata persistence
  - [ ] Property test for backward compatibility
  - [ ] Run all tests and verify success criteria

---

## Phase 2 Implementation Checklist

Use this checklist when you're ready for Phase 2:

### Week 1: Intent Detection

- [ ] **Day 1-2**: Implement competitive intelligence intent detection
  - [ ] Add keyword patterns
  - [ ] Set target section and subsection
  - [ ] Write unit tests

- [ ] **Day 3-4**: Implement MD&A and footnote intent detection
  - [ ] Add keyword patterns for both
  - [ ] Map to subsections
  - [ ] Write unit tests

- [ ] **Day 5**: Implement intent prioritization
  - [ ] Add logic for most specific intent
  - [ ] Write property tests
  - [ ] Test with complex queries

### Week 2: Subsection-Aware Retrieval

- [ ] **Day 1-2**: Enhance Semantic Retriever
  - [ ] Add subsection filtering to Bedrock KB queries
  - [ ] Add subsection filtering to PostgreSQL queries
  - [ ] Implement fallback chain

- [ ] **Day 3-4**: Implement multi-ticker isolation
  - [ ] Process tickers independently
  - [ ] Add validation for ticker mixing
  - [ ] Write property tests

- [ ] **Day 5**: Write retrieval tests
  - [ ] Property test for subsection filtering
  - [ ] Property test for fallback chain
  - [ ] Property test for multi-ticker isolation

### Week 3: Response Generation

- [ ] **Day 1-2**: Create Response Generator Service
  - [ ] Implement competitive intelligence extraction
  - [ ] Implement MD&A intelligence extraction
  - [ ] Implement footnote extraction

- [ ] **Day 3-4**: Add confidence scoring and validation
  - [ ] Calculate confidence scores
  - [ ] Validate response quality
  - [ ] Generate citations

- [ ] **Day 5**: Complete Phase 2
  - [ ] Write all property tests
  - [ ] Run integration tests
  - [ ] Verify success criteria
  - [ ] Create Phase 2 git tag

---

## Common Commands

### Development

```bash
# Start development server
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- path/to/test.spec.ts

# Run tests for specific phase
npm test -- --grep "Phase 1"
npm test -- --grep "Phase 2"

# Build for production
npm run build

# Lint code
npm run lint

# Format code
npm run format
```

### Database

```bash
# Run migrations
npm run migrate

# Rollback last migration
npm run migrate:rollback

# Check migration status
npm run migrate:status

# Connect to database
psql -d fundlens
```

### Git

```bash
# Create feature branch
git checkout -b feature/rag-extraction-phase1

# Commit changes
git add .
git commit -m "feat(rag): implement Item 1 subsection identification"

# Push to remote
git push origin feature/rag-extraction-phase1

# Create tag after phase completion
git tag -a rag-extraction-phase1-v1.0.0 -m "Phase 1: Core subsection extraction"
git push origin rag-extraction-phase1-v1.0.0
```

---

## Testing Your Changes

### Manual Testing

#### Test Subsection Identification (Phase 1)

```bash
# Run parser on a test filing
cd python_parser
python -c "
from section_parser import SectionParser
parser = SectionParser()
sections = parser.extract_sections_with_subsections('path/to/nvda-10k.html')
for section in sections:
    print(f'{section.section_type}: {section.subsection_name}')
"
```

#### Test Intent Detection (Phase 2)

```bash
# Test competitive intelligence query
curl -X POST http://localhost:3000/api/rag/detect-intent \
  -H "Content-Type: application/json" \
  -d '{"query": "Who are NVDA'\''s competitors?"}'

# Expected output:
# {
#   "type": "competitive_intelligence",
#   "ticker": "NVDA",
#   "sectionType": "item_1",
#   "subsectionName": "Competition",
#   "confidence": 0.95
# }
```

#### Test Extraction (Phase 2)

```bash
# Test competitive intelligence extraction
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Who are NVDA'\''s competitors?"}'

# Expected output should include:
# - Competitor names (AMD, Intel, etc.)
# - Market positioning
# - Competitive advantages/disadvantages
# - Confidence score
# - Citations with subsection references
```

### Automated Testing

```bash
# Run all tests
npm test

# Run Phase 1 tests only
npm test -- --grep "Phase 1"

# Run property tests only
npm test -- --grep "Property"

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- src/rag/intent-detector.service.spec.ts
```

---

## Troubleshooting

### Issue: Subsection identification not working

**Solution**: Check pattern matching in `python_parser/section_parser.py`

```python
# Debug subsection identification
parser = SectionParser()
sections = parser.extract_sections_with_subsections(filing_html)
for section in sections:
    print(f"Section: {section.section_type}")
    print(f"Subsections found: {section.subsections}")
    print(f"Content preview: {section.content[:200]}")
```

### Issue: Intent detection classifying incorrectly

**Solution**: Check keyword patterns in `src/rag/intent-detector.service.ts`

```typescript
// Add debug logging
console.log('Query:', query);
console.log('Detected keywords:', detectedKeywords);
console.log('Intent:', intent);
console.log('Confidence:', confidence);
```

### Issue: Retrieval returning no results

**Solution**: Check filters and fallback chain

```typescript
// Debug retrieval
console.log('Filters:', {
  ticker,
  sectionType,
  subsectionName
});
console.log('Results count:', results.length);
console.log('Fallback used:', fallbackUsed);
```

### Issue: Tests failing

**Solution**: Check test setup and data

```bash
# Run tests with verbose output
npm test -- --verbose

# Run single test to isolate issue
npm test -- --grep "specific test name"

# Check test data
ls test/fixtures/
```

---

## Getting Help

### Documentation
- **Requirements**: `.kiro/specs/rag-competitive-intelligence-extraction/requirements.md`
- **Design**: `.kiro/specs/rag-competitive-intelligence-extraction/design.md`
- **Tasks**: `.kiro/specs/rag-competitive-intelligence-extraction/tasks.md`
- **CHANGELOG**: `CHANGELOG-RAG-EXTRACTION.md`
- **Git Guide**: `.kiro/specs/rag-competitive-intelligence-extraction/GIT_TAGGING_GUIDE.md`

### Team
- **Slack**: #rag-extraction-feature
- **Feature Owner**: TBD
- **Technical Lead**: TBD

### Resources
- **AWS Bedrock Docs**: https://docs.aws.amazon.com/bedrock/
- **fast-check Docs**: https://fast-check.dev/
- **Property-Based Testing Guide**: https://hypothesis.works/articles/what-is-property-based-testing/

---

## Next Steps

1. ✅ Create baseline git tag (you did this!)
2. ✅ Update CHANGELOG (you did this!)
3. 🚀 Start implementing Phase 1, Task 2.1
4. 📝 Write tests as you go
5. 🔍 Test manually with real SEC filings
6. ✅ Complete Phase 1 checklist
7. 🏷️ Create Phase 1 git tag
8. 🎉 Move to Phase 2!

---

## Success Tips

1. **Test Early, Test Often**: Write tests as you implement, not after
2. **Use Real Data**: Test with actual SEC filings (NVDA, AAPL, AMZN)
3. **Commit Frequently**: Small, focused commits are easier to review and rollback
4. **Document Decisions**: Add comments explaining why, not just what
5. **Ask Questions**: Use #rag-extraction-feature Slack channel
6. **Review Design**: Re-read design.md when stuck
7. **Check Examples**: Look at existing RAG code for patterns
8. **Monitor Metrics**: Track success rates and latency from day 1

---

## You're Ready! 🎉

You now have everything you need to start implementing the RAG Competitive Intelligence Extraction feature. Begin with Phase 1, Task 2.1 and work through the checklist.

**Remember**: This is a phased approach. You don't need to implement everything at once. Focus on Phase 1 first, get it working, tag it, then move to Phase 2.

Good luck! 🚀
