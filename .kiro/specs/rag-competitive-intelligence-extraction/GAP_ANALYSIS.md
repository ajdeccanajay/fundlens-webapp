# GAP Analysis: Current RAG Architecture vs. Requirements

## Executive Summary

This analysis compares the current RAG implementation against the requirements for competitive intelligence extraction. The analysis reveals **5 critical gaps** that must be addressed to achieve institutional-grade accuracy for competitive intelligence, MD&A insights, and footnote queries.

## Current Architecture Strengths

### ✅ What's Working Well

1. **Hybrid Retrieval Architecture** (rag.service.ts)
   - Successfully combines structured (PostgreSQL) + semantic (Bedrock KB) retrieval
   - Proper separation of concerns between structured and semantic paths
   - User document integration already implemented

2. **Intent Detection Foundation** (intent-detector.service.ts)
   - Ticker extraction working (handles single and multiple tickers)
   - Metric extraction comprehensive (Revenue, Net_Income, etc.)
   - Period extraction functional (FY2024, Q4-2024, latest)
   - Section type mapping exists (item_1, item_7, item_8)

3. **Semantic Retrieval with Ticker Filtering** (semantic-retriever.service.ts)
   - **CRITICAL**: Already implements strict ticker filtering to prevent cross-contamination
   - Multi-ticker queries handled separately (retrieveMultipleTickersWithContext)
   - Post-filtering validation to ensure ticker accuracy
   - Contextual metrics integration from RDS

4. **Fallback Strategy** (semantic-retriever.service.ts)
   - PostgreSQL fallback when Bedrock KB unavailable
   - Multiple search strategies (exact phrase, multi-keyword, any keyword, section-based)
   - Relevance scoring for PostgreSQL results

## Critical Gaps

### ❌ GAP 1: No Subsection Granularity

**Requirement:** Req 1 (Subsection-Aware Section Extraction), Req 5 (Subsection-Aware Semantic Retrieval)

**Current State:**
- Section parser extracts major sections (Item 1, Item 7, Item 8)
- No subsection identification (e.g., "Competition" within Item 1)
- Database schema lacks `subsection_name` column
- Bedrock KB metadata doesn't include subsection information

**Impact:**
- Query "Who are NVDA's competitors?" retrieves entire Item 1 (Business) section
- Cannot target "Competition" subsection specifically
- Low signal-to-noise ratio in retrieved chunks

**Example:**
```typescript
// Current: Retrieves all of Item 1
filter: { ticker: 'NVDA', sectionType: 'item_1' }

// Needed: Target Competition subsection
filter: { ticker: 'NVDA', sectionType: 'item_1', subsectionName: 'Competition' }
```

**Fix Required:**
1. Enhance `section_parser.py` to identify subsections within major sections
2. Add `subsection_name` column to `narrative_chunks` table
3. Update Bedrock KB metadata to include subsection
4. Modify semantic retriever to filter by subsection

---

### ❌ GAP 2: Missing Competitive Intelligence Intent Detection

**Requirement:** Req 2 (Competitive Intelligence Intent Detection)

**Current State:**
- Intent detector recognizes general business queries
- No specific patterns for competitive intelligence
- Missing keywords: "competitors", "competitive landscape", "peer comparison", "market position"
- Doesn't map competitive queries to Item 1 Competition subsection

**Impact:**
- Query "Who are NVDA's competitors?" classified as generic semantic query
- No targeting of Competition subsection
- Response generator doesn't know to extract competitor names

**Example:**
```typescript
// Current: Generic semantic query
{ type: 'semantic', sectionTypes: ['item_1'] }

// Needed: Competitive intelligence intent
{ 
  type: 'competitive_intelligence', 
  sectionTypes: ['item_1'], 
  subsection: 'Competition',
  extractionType: 'competitor_names'
}
```

**Fix Required:**
1. Add competitive intelligence patterns to intent detector
2. Map to Item 1 Competition subsection
3. Set extraction type flag for response generator

---

### ❌ GAP 3: No MD&A or Footnote Intent Detection

**Requirement:** Req 3 (MD&A Intelligence Intent Detection), Req 4 (Footnote Intent Detection)

**Current State:**
- Intent detector has basic MD&A section mapping (item_7)
- No MD&A subsection targeting (Results of Operations, Liquidity, Critical Accounting)
- No footnote-specific intent detection
- Missing accounting policy keyword recognition

**Impact:**
- MD&A queries retrieve entire Item 7 (too broad)
- Footnote queries don't target Item 8 specifically
- No extraction of structured MD&A insights (trends, risks, guidance)

**Example:**
```typescript
// Current: Broad MD&A query
{ type: 'semantic', sectionTypes: ['item_7'] }

// Needed: Targeted MD&A intelligence
{ 
  type: 'mda_intelligence', 
  sectionTypes: ['item_7'], 
  subsection: 'Results_of_Operations',
  extractionType: 'trends_and_risks'
}
```

**Fix Required:**
1. Add MD&A intelligence patterns to intent detector
2. Map to Item 7 subsections
3. Add footnote patterns and Item 8 mapping
4. Set extraction type flags

---

### ❌ GAP 4: No Structured Extraction in Response Generation

**Requirement:** Req 6 (Structured Competitive Intelligence Extraction), Req 7 (Structured MD&A Intelligence Extraction), Req 8 (Footnote Content Extraction)

**Current State:**
- Response generator (bedrock.service.ts) uses generic prompts
- No specialized prompts for competitive intelligence, MD&A, or footnotes
- No structured extraction (competitor names, trends, risks, policies)
- No confidence scoring for extracted information

**Impact:**
- Even when relevant chunks are retrieved, Claude doesn't extract structured information
- Response: "I don't have specific information about NVIDIA's competitors" despite having the data
- No competitor names, market positioning, or competitive advantages extracted

**Example:**
```typescript
// Current: Generic prompt
"Answer the question based on these chunks: ..."

// Needed: Specialized extraction prompt
"Extract competitor names from these chunks. For each competitor, provide:
1. Company name
2. Market segment
3. Competitive threat level
4. Supporting evidence from text
Format as structured list with confidence scores."
```

**Fix Required:**
1. Create specialized prompt templates for each intent type
2. Implement structured extraction logic
3. Add confidence scoring
4. Validate extracted information against source chunks

---

### ❌ GAP 5: No Re-ranking Model

**Requirement:** Req 5A (Retrieval Re-ranking for Improved Accuracy)

**Current State:**
- Retrieval uses Bedrock KB scores or PostgreSQL relevance scores
- No re-ranking step to improve relevance
- Mistral re-ranking model available in Bedrock but not used

**Impact:**
- Retrieved chunks may not be optimally ordered
- Less relevant chunks may be prioritized over more relevant ones
- Response quality depends on initial retrieval quality

**Example:**
```typescript
// Current: Use raw retrieval scores
const narratives = await this.bedrock.retrieve(query, filter, numberOfResults);

// Needed: Re-rank results
const narratives = await this.bedrock.retrieve(query, filter, numberOfResults * 2);
const reranked = await this.reranker.rerank(query, narratives);
const topNarratives = reranked.slice(0, numberOfResults);
```

**Fix Required:**
1. Integrate Mistral re-ranking model from Bedrock
2. Add re-ranking step after initial retrieval
3. Implement fallback if re-ranking unavailable

---

## Minor Gaps (Lower Priority)

### ⚠️ GAP 6: No Advanced Retrieval Techniques

**Requirement:** Req 20 (Advanced Retrieval Techniques), Req 21 (Contextual Chunk Expansion), Req 22 (Query Decomposition), Req 23 (HyDE)

**Current State:**
- Single-pass retrieval only
- No contextual expansion of retrieved chunks
- No query decomposition for complex queries
- No HyDE or iterative retrieval

**Impact:**
- Fine-grained details may be missed if not in top-K chunks
- Chunks may lack surrounding context for coherence
- Complex multi-part questions not fully answered
- Retrieval limited by query phrasing

**Fix Required:**
1. Implement contextual chunk expansion (retrieve chunk_index ± N)
2. Add query decomposition for complex queries
3. Implement HyDE for semantic intent matching
4. Add iterative retrieval for gap-filling

---

### ⚠️ GAP 7: No Prompt Fine-Tuning Infrastructure

**Requirement:** Req 24 (Prompt Fine-Tuning), Req 25 (Few-Shot Learning)

**Current State:**
- Prompts hardcoded in bedrock.service.ts
- No prompt versioning or A/B testing
- No few-shot examples in extraction prompts
- No mechanism to update prompts without code changes

**Impact:**
- Cannot improve prompts based on real-world usage
- No systematic way to test prompt variants
- Extraction quality depends on initial prompt design
- Difficult to adapt to new extraction patterns

**Fix Required:**
1. Create prompt library with versioned templates
2. Implement A/B testing for prompt variants
3. Add few-shot examples to extraction prompts
4. Build admin interface for prompt management

---

### ⚠️ GAP 8: Limited Confidence Scoring

**Requirement:** Req 11 (Extraction Confidence Scoring)

**Current State:**
- Intent detection has basic confidence scoring
- No confidence scoring for extracted information
- No validation that claims are supported by chunks

### ⚠️ GAP 8: Limited Confidence Scoring

**Requirement:** Req 11 (Extraction Confidence Scoring)

**Current State:**
- Intent detection has basic confidence scoring
- No confidence scoring for extracted information
- No validation that claims are supported by chunks

**Fix Required:**
1. Add confidence scoring to extraction logic
2. Validate extracted information against source chunks
3. Return confidence scores with responses

---

### ⚠️ GAP 9: Limited Monitoring

**Requirement:** Req 17 (Monitoring and Observability)

**Current State:**
- Basic logging exists
- No metrics for extraction success rates
- No alerts for failures

**Fix Required:**
1. Add extraction success/failure metrics
2. Track confidence scores by intent type
3. Implement alerting for low success rates

---

## Incremental Implementation Plan

### Phase 1: Foundation (Weeks 1-2)
**Goal:** Enable subsection-aware retrieval

1. **Database Schema Enhancement**
   - Add `subsection_name` column to `narrative_chunks` table
   - Create indexes on (ticker, section_type, subsection_name)
   - Backfill existing chunks with null subsection_name

2. **Section Parser Enhancement**
   - Modify `section_parser.py` to identify subsections
   - Extract Competition, Products, Customers from Item 1
   - Extract Results of Operations, Liquidity from Item 7
   - Extract note numbers from Item 8

3. **Bedrock KB Metadata Update**
   - Update section exporter to include subsection_name
   - Re-export chunks with subsection metadata
   - Verify Bedrock KB indexes subsection_name

**Benefit for Analyst:** Retrieval becomes more targeted, reducing noise in results

---

### Phase 2: Intent Detection (Week 3)
**Goal:** Recognize competitive intelligence, MD&A, and footnote queries

1. **Competitive Intelligence Patterns**
   - Add patterns: "competitors", "competitive landscape", "peer comparison"
   - Map to Item 1 Competition subsection
   - Set extraction type flag

2. **MD&A Intelligence Patterns**
   - Add patterns: "growth drivers", "trends", "outlook", "guidance"
   - Map to Item 7 subsections
   - Set extraction type flag

3. **Footnote Patterns**
   - Add patterns: "footnote", "accounting policy", "revenue recognition"
   - Map to Item 8
   - Extract note numbers

**Benefit for Analyst:** System understands query intent and targets correct sections

---

### Phase 3: Structured Extraction (Week 4)
**Goal:** Extract structured information from retrieved chunks

1. **Specialized Prompts**
   - Create competitive intelligence extraction prompt
   - Create MD&A intelligence extraction prompt
   - Create footnote extraction prompt

2. **Extraction Logic**
   - Implement competitor name extraction
   - Implement trend and risk extraction
   - Implement accounting policy extraction

3. **Confidence Scoring**
   - Score based on explicit mentions
   - Validate against source chunks
   - Return confidence with results

**Benefit for Analyst:** Receives structured, actionable insights instead of raw text

---

### Phase 4: Re-ranking (Week 5)
**Goal:** Improve retrieval relevance

1. **Mistral Re-ranking Integration**
   - Integrate Mistral re-ranking model from Bedrock
   - Add re-ranking step after retrieval
   - Implement fallback strategy

2. **Evaluation**
   - Compare re-ranked vs. non-re-ranked results
   - Measure improvement in relevance
   - Tune re-ranking parameters

**Benefit for Analyst:** Most relevant information prioritized in responses

---

### Phase 5: Hybrid Responses (Week 6)
**Goal:** Combine qualitative narratives with quantitative metrics

1. **Quantitative Engine Integration**
   - Detect when queries need both qualitative and quantitative data
   - Invoke both engines in parallel
   - Merge results intelligently

2. **Response Formatting**
   - Clearly distinguish qualitative vs. quantitative
   - Format metrics with proper units
   - Combine competitor names (qualitative) with financial metrics (quantitative)

**Benefit for Analyst:** Comprehensive answers combining narrative insights and financial data

---

### Phase 6: Advanced Retrieval (Week 7-8)
**Goal:** Implement advanced techniques for fine-grained detail extraction

1. **Contextual Chunk Expansion**
   - Retrieve surrounding chunks (chunk_index ± 2)
   - Merge into coherent context window
   - Preserve chunk boundaries for citations

2. **Query Decomposition**
   - Detect complex multi-part queries
   - Decompose into sub-queries
   - Execute and synthesize results

3. **HyDE Implementation**
   - Generate hypothetical documents for queries
   - Use for retrieval alongside original query
   - Merge and deduplicate results

4. **Iterative Retrieval**
   - Detect low-confidence initial results
   - Generate follow-up queries
   - Merge iterative results

**Benefit for Analyst:** Can extract even the tiniest details from narratives, complex questions fully answered

---

### Phase 7: Prompt Fine-Tuning (Week 9-10)
**Goal:** Build infrastructure for continuous prompt improvement

1. **Prompt Library**
   - Create versioned prompt templates
   - Store in database or configuration
   - Support hot-reloading without code changes

2. **Few-Shot Examples**
   - Add 2-3 examples to each extraction prompt
   - Domain-specific examples (tech, retail, finance)
   - Demonstrate desired output structure

3. **A/B Testing**
   - Test prompt variants in production
   - Track success rates and confidence scores
   - Automatically select best-performing variant

4. **Admin Interface**
   - UI for prompt management
   - View performance metrics by prompt
   - Update prompts without deployment

**Benefit for Analyst:** Extraction quality improves over time, adapts to new patterns

---

## Success Metrics

### Phase 1 Success Criteria
- ✅ Subsection metadata populated for 95%+ of chunks
- ✅ Retrieval can filter by subsection
- ✅ Bedrock KB indexes subsection metadata

### Phase 2 Success Criteria
- ✅ Competitive intelligence queries correctly classified (95%+ accuracy)
- ✅ MD&A queries correctly classified (90%+ accuracy)
- ✅ Footnote queries correctly classified (90%+ accuracy)

### Phase 3 Success Criteria
- ✅ Competitive intelligence queries extract competitor names (95%+ success rate)
- ✅ MD&A queries extract trends and risks (90%+ success rate)
- ✅ Footnote queries extract policies (90%+ success rate)
- ✅ Confidence scores provided for all extractions

### Phase 4 Success Criteria
- ✅ Re-ranking improves relevance by 20%+ (measured by analyst feedback)
- ✅ Fallback strategy works when re-ranking unavailable

### Phase 5 Success Criteria
- ✅ Hybrid responses combine qualitative and quantitative data correctly
- ✅ No cross-contamination between tickers (100% accuracy)
- ✅ Response latency <5 seconds

### Phase 6 Success Criteria
- ✅ Contextual expansion improves response coherence (measured by analyst feedback)
- ✅ Query decomposition handles 90%+ of complex queries correctly
- ✅ HyDE improves retrieval recall by 15%+
- ✅ Iterative retrieval fills gaps in 80%+ of low-confidence cases

### Phase 7 Success Criteria
- ✅ Prompt library operational with 10+ versioned templates
- ✅ Few-shot examples improve extraction accuracy by 20%+
- ✅ A/B testing identifies best-performing prompts
- ✅ Admin interface allows prompt updates without deployment

---

## Risk Mitigation

### Risk 1: Subsection Identification Accuracy
**Mitigation:** Start with high-confidence subsections (Competition, Results of Operations), expand gradually

### Risk 2: Extraction Prompt Engineering
**Mitigation:** Test prompts on sample filings, iterate based on results, use few-shot examples

### Risk 3: Re-ranking Cost
**Mitigation:** Only re-rank top N results (e.g., top 10), cache re-ranking results

### Risk 4: Backward Compatibility
**Mitigation:** Make subsection_name nullable, support null values in all queries

### Risk 5: Advanced Retrieval Latency
**Mitigation:** Make advanced techniques optional, use only when needed, implement caching

### Risk 6: Prompt Fine-Tuning Complexity
**Mitigation:** Start with simple versioning, add A/B testing later, use feature flags

---

## Conclusion

The current RAG architecture has a **solid foundation** with hybrid retrieval, ticker filtering, and contextual metrics integration. The **5 critical gaps** can be addressed incrementally over 10 weeks, with each phase delivering tangible benefits to equity analysts:

1. **Phase 1:** More targeted retrieval (less noise)
2. **Phase 2:** Better query understanding (correct sections)
3. **Phase 3:** Structured insights (actionable information)
4. **Phase 4:** Improved relevance (best information first)
5. **Phase 5:** Comprehensive answers (qualitative + quantitative)
6. **Phase 6:** Fine-grained details (advanced retrieval techniques)
7. **Phase 7:** Continuous improvement (prompt fine-tuning)

This incremental approach minimizes risk while progressively improving the analyst experience. **Advanced retrieval techniques (Phase 6)** address the challenge of extracting tiny details from RAGged narratives, while **prompt fine-tuning (Phase 7)** ensures the system improves over time based on real-world usage.

