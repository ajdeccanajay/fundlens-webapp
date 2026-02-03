# Workspace Citation Integration Plan

**Goal**: Transfer citation functionality from standalone Research Assistant to Deals Workspace  
**Target**: `public/app/deals/workspace.html#research`  
**Approach**: Incremental, careful changes with full testing

---

## Phase 1: Add Citation CSS (5 min)

### Changes
1. Add citation-specific CSS to workspace.html `<style>` section
2. Keep existing workspace styles intact
3. Add document preview modal styles

### Files Modified
- `public/app/deals/workspace.html` (CSS only)

### Testing
- Visual inspection (no functional changes yet)

---

## Phase 2: Update Research Message HTML (10 min)

### Changes
1. Replace `renderMarkdown()` with `renderMarkdownWithCitations()`
2. Add citations section below message content
3. Add citation preview modal HTML
4. Keep existing "Save to Scratchpad" functionality

### Files Modified
- `public/app/deals/workspace.html` (HTML template only)

### Testing
- Visual inspection
- Ensure no JavaScript errors
- Verify existing functionality still works

---

## Phase 3: Add Citation JavaScript Functions (15 min)

### Changes
1. Add `renderMarkdownWithCitations()` function
2. Add `previewCitation()` function
3. Add `highlightText()` function
4. Add citation event listener in `init()`
5. Update SSE handler to capture citations
6. Add `showDocumentPreview` and `previewDocument` to Alpine data

### Files Modified
- `public/app/deals/workspace.html` (JavaScript only)

### Testing
- Unit tests for citation rendering
- Manual testing with browser console
- Verify SSE stream handling

---

## Phase 4: Testing (30 min)

### Unit Tests
- Create `test/unit/workspace-citation-rendering.spec.ts`
- Test `renderMarkdownWithCitations()`
- Test citation link generation
- Test preview modal functions

### E2E Tests
- Create `test/e2e/workspace-research-citations.e2e-spec.ts`
- Test citation display in workspace
- Test citation click and preview
- Test keyboard navigation

### Frontend Tests
- Manual testing checklist
- Browser compatibility
- Mobile responsive

---

## Implementation Order

1. ✅ **Step 1**: Add CSS (no risk, visual only)
2. ✅ **Step 2**: Update HTML template (low risk, template only)
3. ✅ **Step 3**: Add JavaScript functions (medium risk, test thoroughly)
4. ✅ **Step 4**: Create and run tests (validation)

---

## Risk Mitigation

### Backup Strategy
- Create backup of workspace.html before changes
- Test each phase independently
- Rollback if issues detected

### Testing Strategy
- Test after each phase
- Verify existing functionality not broken
- Check browser console for errors

### Incremental Approach
- Make smallest possible changes
- Test immediately
- Don't move to next phase until current phase works

---

## Success Criteria

### Phase 1 (CSS)
- [ ] CSS added without breaking existing styles
- [ ] No visual regressions
- [ ] Page loads without errors

### Phase 2 (HTML)
- [ ] Citations section displays (even if empty)
- [ ] Modal HTML present in DOM
- [ ] Existing functionality works
- [ ] No JavaScript errors

### Phase 3 (JavaScript)
- [ ] Citations received from SSE stream
- [ ] Citations display in message
- [ ] Citation links clickable
- [ ] Preview modal opens/closes
- [ ] Keyboard navigation works

### Phase 4 (Testing)
- [ ] All unit tests pass
- [ ] All E2E tests pass
- [ ] Manual testing complete
- [ ] No regressions detected

---

## Estimated Time

- Phase 1: 5 minutes
- Phase 2: 10 minutes
- Phase 3: 15 minutes
- Phase 4: 30 minutes
- **Total**: 60 minutes

---

## Files to Create/Modify

### Modified
1. `public/app/deals/workspace.html` (main integration)

### Created
1. `test/unit/workspace-citation-rendering.spec.ts` (unit tests)
2. `test/e2e/workspace-research-citations.e2e-spec.ts` (E2E tests)
3. `.kiro/specs/chatgpt-like-research-assistant/WORKSPACE_INTEGRATION_COMPLETE.md` (completion doc)

---

## Next Steps

1. Create backup of workspace.html
2. Execute Phase 1 (CSS)
3. Test Phase 1
4. Execute Phase 2 (HTML)
5. Test Phase 2
6. Execute Phase 3 (JavaScript)
7. Test Phase 3
8. Execute Phase 4 (Testing)
9. Document completion

---

**Ready to begin implementation!**
