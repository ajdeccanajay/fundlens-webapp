# Investment-Grade RAG Synthesis - Implementation Tasks

## Overview

**CRITICAL: Use existing services. NO new synthesis service.**

This is a simple 4-task implementation:
1. Improve prompts in bedrock.service.ts
2. Add citation parsing to bedrock.service.ts
3. Add source modal to frontend
4. Test and validate

**Total: 2 days maximum**

---

## Task 1: Improve Prompt Engineering in bedrock.service.ts

Update the existing `buildSystemPrompt()` and `buildUserMessage()` methods to generate investment-grade synthesized responses with proper citations.

**Changes:**
- [x] 1.1 Update `buildSystemPrompt()` to be MORE explicit about synthesis
  - Add "NEVER copy-paste raw filing text" instruction
  - Add "ORGANIZE BY THEME" instruction
  - Add citation format examples
  - Add example good response
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2_

- [x] 1.2 Update `buildUserMessage()` to number sources for citation mapping
  - Add `[Source 1: TICKER FILING PERIOD - SECTION]` headers
  - Make it clear to Claude which source is [1], [2], etc.
  - _Requirements: 3.1, 3.2, 4.1, 4.2_

- [ ]* 1.3 Test prompt improvements manually
  - Ask "What are NVDA's risks?"
  - Verify response is synthesized (not copy-paste)
  - Verify citations [1], [2] appear
  - Iterate on prompt if needed
  - _Requirements: 1.1, 1.2, 1.3, 8.1, 8.2_

---

## Task 2: Add Citation Parsing to bedrock.service.ts

Add a new method to parse citations from Claude's response and map them to source chunks.

**Changes:**
- [x] 2.1 Add `parseCitations()` private method
  - Extract citation numbers [1], [2] from response using regex
  - Map citation numbers to source chunks (index-based)
  - Build citation objects with metadata
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4_

- [x] 2.2 Update `generate()` method signature to return citations
  - Change return type to include `citations: any[]`
  - Call `parseCitations()` after getting response
  - Return citations array
  - _Requirements: 3.1, 3.2, 4.1, 4.2_

- [x] 2.3 Update rag.service.ts to pass citations through
  - Get citations from `bedrock.generate()`
  - Include citations in RAGResponse
  - _Requirements: 10.1, 10.2_

- [x]* 2.4 Write unit tests for citation parsing
  - Test citation extraction from response
  - Test citation mapping to chunks
  - Test edge cases (no citations, invalid numbers)
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

---

## Task 3: Add Source Modal to Frontend

Create a modal component that displays source context when users click on citations.

**Changes:**
- [x] 3.1 Add source modal HTML to `public/app/research/index.html`
  - Modal overlay with backdrop
  - Header with ticker, filing, period
  - Metadata section (page, relevance)
  - Excerpt display
  - Actions (copy citation, close)
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 3.2 Add Alpine.js state and handlers
  - Add `sourceModal` state object
  - Add `handleCitationClick()` method
  - Add `copySourceCitation()` method
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 3.3 Make citations clickable in message rendering
  - Add `renderMessageWithCitations()` method
  - Convert [1], [2] to clickable links
  - Wire up click handlers
  - _Requirements: 5.1, 5.2_

- [x] 3.4 Add CSS styling for citations and modal
  - Style citation links (blue, hover effect)
  - Style modal (shadow, rounded, responsive)
  - Add keyboard navigation (Esc to close)
  - _Requirements: 5.1, 5.2, 5.5_

- [ ]* 3.5 Test modal functionality manually
  - Click citation and verify modal opens
  - Verify correct source info displayed
  - Test copy citation button
  - Test Esc key and click-away to close
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

---

## Task 5: Fix Citation Links Not Working (CRITICAL)

**STATUS**: COMPLETE ✅

**Issues Fixed**:
1. ✅ Modal opening multiple times on single click
2. ✅ Duplicate modal HTML outside Alpine.js component
3. ✅ Modal text wrapping and scrolling
4. ✅ Table formatting - collapsed tables now render correctly
5. ✅ Fallback HTML table converter for edge cases

**Root Causes Identified**:
1. **Duplicate Modal**: Two modal HTML blocks - one inside Alpine.js component (correct), one outside (broken)
2. **Multiple Event Handlers**: Event listener registered every time component initialized, causing multiple handlers
3. **Event Bubbling**: No `stopPropagation()` to prevent event bubbling
4. **Modal Text Cutoff**: Insufficient scrolling for long excerpts
5. **Table Formatting**: Tables stored as collapsed single lines with `||` as row separators

**Changes Made**:
- [x] 5.1 Remove duplicate modal HTML
  - Deleted broken duplicate modal (lines 1738-1809) that was outside Alpine.js component
  - Kept correct modal inside `x-data="dealWorkspace()"` component
  - _Fix: Modal now properly reactive with Alpine.js_

- [x] 5.2 Fix multiple event handler registration
  - Added global flag `window._citationHandlerRegistered` to prevent duplicate handlers
  - Event listener now registered only once
  - Added `event.stopPropagation()` to prevent bubbling
  - _Fix: Modal opens only once per click_

- [x] 5.3 Fix modal text scrolling
  - Increased outer container to `max-h-[500px]` (from 384px)
  - Added inner scrollable div with `max-h-[400px] overflow-y-auto`
  - Kept proper text wrapping: `white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word;`
  - _Fix: Full excerpt visible with smooth scrolling_

- [x] 5.4 Fix table formatting (collapsed tables)
  - Added preprocessing in `renderMarkdown()` to detect collapsed tables
  - Added `||` to `|\n|` conversion to restore row breaks
  - Added separator row newline fix
  - Added `convertRawTableToHtml()` fallback function for edge cases
  - Updated marked.js config to use `marked.use()` for v5+ compatibility
  - Added `.markdown-table` CSS class for fallback tables
  - _Fix: Tables now render correctly even when stored as collapsed single lines_

- [x] 5.5 Comprehensive debugging logs
  - Added logs throughout citation flow
  - Logs helped identify duplicate modal and multiple handlers
  - _Purpose: Trace entire flow from backend to modal_

**Files Modified**:
- `public/app/deals/workspace.html`: 
  - Removed duplicate modal
  - Added event deduplication
  - Improved scrolling
  - Enhanced `renderMarkdown()` with table preprocessing
  - Added `convertRawTableToHtml()` fallback function
  - Enhanced CSS for `.markdown-table` class
- `src/rag/bedrock.service.ts`: Enhanced system prompt and user instructions for table formatting

**Documentation**: 
- See `.kiro/specs/investment-grade-rag-synthesis/MODAL_MULTIPLE_CLICKS_FIX.md`
- See `.kiro/specs/investment-grade-rag-synthesis/FINAL_FIXES.md`

---

## Task 4: Integration Testing and Validation

Test the complete end-to-end flow and validate synthesis quality.

**Changes:**
- [ ]* 4.1 End-to-end integration test
  - Query: "What are NVDA's risks?"
  - Verify synthesized response (not copy-paste)
  - Verify citations [1], [2] appear inline
  - Verify clicking citation opens modal
  - Verify modal shows correct metadata
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 5.1, 5.2, 5.3, 5.4_

- [ ]* 4.2 Test with multiple query types
  - Financial performance query
  - Competitive analysis query
  - Business model query
  - Verify synthesis quality across types
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [ ]* 4.3 Validate synthesis quality
  - No copy-paste from filings
  - Professional investment-grade language
  - Organized by theme (not by source)
  - No repetition
  - All facts have citations
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4_

- [ ]* 4.4 Validate citation accuracy
  - Citations map to correct sources
  - Metadata is complete (ticker, filing, section, page)
  - Excerpts are relevant
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5_

---

## Success Criteria

### Technical
- [ ] No new services created (use existing bedrock, citation, rag services)
- [ ] Prompts generate synthesized responses (not copy-paste)
- [ ] Citations [1], [2] are parsed and mapped correctly
- [ ] Modal displays source context with metadata
- [ ] All tests pass

### User Experience
- [ ] Responses read like professional analyst reports
- [ ] Citations are easy to click
- [ ] Modal provides helpful source context
- [ ] Copy citation works smoothly
- [ ] No performance degradation

### Quality
- [ ] 90%+ of responses are synthesized (not copy-paste)
- [ ] 95%+ citation accuracy (correct source mapping)
- [ ] Professional language throughout
- [ ] No repetition or redundancy
- [ ] All factual claims have citations

---

## Notes

- Tasks marked with `*` are optional testing tasks
- Focus on prompt engineering quality in Task 1
- Keep implementation simple - no over-engineering
- Test frequently with real queries
- Iterate on prompts based on output quality
