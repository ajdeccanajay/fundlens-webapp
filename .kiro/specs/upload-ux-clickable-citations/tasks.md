# Implementation Plan: Upload UX & Clickable Citations

## Overview

Incrementally replace the current file queue dropdown with inline upload chips, add drag-drop overlay with visual feedback, per-file progress indicators, and make all source citations clickable with a unified source modal. All changes are frontend-only in `workspace.html` and `instant-rag.css`.

## Tasks

- [x] 1. Add upload chip styles and drag-drop overlay CSS
  - [x] 1.1 Add upload chip styles to `public/css/instant-rag.css`
    - Add `.upload-chips-container` (flexbox row, wrap, gap, positioned above textarea)
    - Add `.upload-chip` base styles and status variants (`.chip-pending`, `.chip-processing`, `.chip-complete`, `.chip-error`)
    - Add `.upload-chip-icon`, `.upload-chip-info`, `.upload-chip-name`, `.upload-chip-size`, `.upload-chip-remove`, `.upload-chip-progress`, `.upload-chip-progress-bar`, `.upload-chip-phase`, `.upload-chip-status` styles
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 3.1, 3.2, 3.3, 3.4_

  - [x] 1.2 Add drag-drop overlay styles to `public/css/instant-rag.css`
    - Add `.drag-drop-overlay` (absolute positioned, dashed border, background, z-index)
    - Add `.drag-drop-content`, `.drag-drop-icon`, `.drag-drop-text`, `.drag-drop-subtext` styles
    - Add transition/animation for overlay appearance
    - _Requirements: 2.1, 2.2, 2.4_

  - [x] 1.3 Add citation link variant styles and source modal styles to `public/css/instant-rag.css`
    - Add `.citation-link` base, `.citation-upload` (purple/indigo accent), `.citation-sec` (blue accent) styles
    - Add `.source-modal-backdrop`, `.source-modal`, `.source-modal-header`, `.source-modal-meta`, `.source-modal-excerpt`, `.source-modal-actions`, `.source-modal-btn`, `.source-modal-close`, `.source-badge` styles
    - _Requirements: 4.1, 5.1, 7.4, 7.5_

- [x] 2. Replace file queue dropdown with inline upload chips in workspace.html
  - [x] 2.1 Replace the "Queued Files" dropdown HTML with upload chips container
    - Remove the `<template x-if="instantRagFiles.length > 0 && !instantRagSession">` block (the file queue dropdown around lines 1680-1700)
    - Add the upload chips container HTML above the textarea, inside the chat input `<div class="flex items-end space-x-3">` parent
    - Each chip shows file icon, truncated name, size, status indicator, and remove button per the design
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 2.2 Add Alpine.js helper methods for chip rendering
    - Add `getFileIconName(filename)`, `getFileIconClass(filename)`, `getChipStatusClass(file)`, `truncateFileName(name, maxLen)`, `formatFileSize(bytes)` methods to the Alpine.js component
    - _Requirements: 1.2, 1.3_

  - [ ]* 2.3 Write property tests for helper methods (Properties 2, 3, 4)
    - **Property 2: File icon mapping is total over supported extensions**
    - **Property 3: File name truncation preserves extension and respects max length**
    - **Property 4: File size formatting produces correct human-readable output**
    - **Validates: Requirements 1.2, 1.3**

- [x] 3. Implement drag-drop overlay with visual feedback
  - [x] 3.1 Add drag-drop overlay HTML to the chat input area in workspace.html
    - Wrap the chat input area in a relative-positioned container
    - Add the drag-drop overlay div with `x-show="instantRagDragOver"` and Alpine.js transitions
    - Move `@dragover`, `@dragleave`, `@drop` handlers from the textarea to the wrapper container for a larger drop target
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 3.2 Write property test for file addition count invariant (Property 1)
    - **Property 1: File addition preserves count invariant**
    - **Validates: Requirements 1.1, 1.7, 2.3**

  - [ ]* 3.3 Write property test for file removal (Property 5)
    - **Property 5: File removal decreases list length by exactly one**
    - **Validates: Requirements 1.4, 1.5**

- [x] 4. Add per-file upload progress and processing status indicators
  - [x] 4.1 Update upload chip HTML to show progress bar and phase labels
    - Add progress bar div inside each chip that shows during `status === 'processing'`
    - Add phase label span that displays `file.phase` during processing
    - Add complete checkmark and error icon based on status
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 4.2 Update `uploadInstantRagFiles()` to set progress and phase values during upload
    - Set phase to 'Uploading' when upload starts
    - Set phase to 'Extracting text' after upload response received
    - Set phase to 'Complete' or 'Failed' based on response
    - Disable send button while `instantRagUploading` is true
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 5. Checkpoint - Verify upload UX works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Enhance citation rendering with source type differentiation
  - [x] 6.1 Update `renderMarkdownWithCitations()` to add source type CSS classes and data attributes
    - Modify the citation replacement logic to check `citation.sourceType`
    - Apply `citation-upload` class for USER_UPLOAD, `citation-sec` class for SEC_FILING
    - Add `data-source-type` attribute to each citation link
    - Add click handler via `onclick` or Alpine.js event dispatch
    - _Requirements: 4.1, 5.1_

  - [ ]* 6.2 Write property test for citation rendering (Property 6)
    - **Property 6: Citation rendering produces correctly typed links**
    - **Validates: Requirements 4.1, 5.1**

- [x] 7. Implement source citation modal
  - [x] 7.1 Add source modal HTML to workspace.html
    - Add the modal markup with backdrop, header (adapts title by sourceType), metadata section, excerpt area, and action buttons
    - Add ARIA attributes: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="source-modal-title"`
    - Add close on Escape key and click-outside handlers
    - Add `formatExcerpt()` helper method
    - _Requirements: 4.2, 4.3, 4.4, 5.2, 5.3, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 7.2 Update citation click handler to populate and open source modal
    - Update `handleCitationClickByNumber()` to set `sourceModal.sourceType` from the citation
    - For USER_UPLOAD: populate filename and excerpt
    - For SEC_FILING: populate ticker, filingType, fiscalPeriod, section, pageNumber, excerpt
    - Set `showSourceModal = true` and focus the close button via `$nextTick`
    - _Requirements: 4.2, 5.2, 7.2_

  - [ ]* 7.3 Write property test for citation click modal population (Property 7)
    - **Property 7: Citation click populates modal with correct metadata**
    - **Validates: Requirements 4.2, 5.2**

  - [ ]* 7.4 Write property test for excerpt formatting (Property 8)
    - **Property 8: Excerpt formatting preserves paragraph structure**
    - **Validates: Requirements 7.4**

- [x] 8. Wire up event listeners and integration
  - [x] 8.1 Add custom event listener for citation clicks
    - Add `document.addEventListener('citation-click', ...)` in the Alpine.js `init()` or component setup
    - Route citation click events to `handleCitationClickByNumber()`
    - Ensure the listener is cleaned up if the component is destroyed
    - _Requirements: 4.2, 5.2_

  - [x] 8.2 Update attachment button styling for active session indicator
    - Update the paperclip button to show green accent when `instantRagSession.status === 'active'`
    - Ensure the button is positioned within the textarea border area (left side)
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 8.3 Write unit tests for upload UX and citation interactions
    - Test file icon mapping for all 9 supported extensions
    - Test truncateFileName edge cases (short name, exact length, long name, no extension)
    - Test formatFileSize with 0, 512, 1536, 5242880 bytes
    - Test formatExcerpt with null, empty, single-line, multi-line input
    - Test citation rendering with mixed sourceTypes
    - Test modal population for both source types
    - _Requirements: 1.2, 1.3, 4.1, 4.2, 5.1, 5.2, 7.4_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All changes are frontend-only — no backend modifications needed
- The existing `sendInstantRagQuery()` function is NOT modified or deleted
- The existing upload flow functions (`handleInstantRagFiles`, `uploadInstantRagFiles`, `removeInstantRagFile`, `addInstantRagFiles`) are preserved and extended
- Property tests use fast-check with minimum 100 iterations per property
- Each property test references its design document property number
