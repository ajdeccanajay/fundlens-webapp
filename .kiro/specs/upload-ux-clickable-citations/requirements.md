# Requirements Document

## Introduction

This feature redesigns the file upload experience in the workspace to match modern AI chat interfaces (Claude/ChatGPT-level UX) and makes source citations clickable so users can view the original source text. The current upload UI uses a separate dropdown and basic paperclip button; the new design integrates file chips directly into the chat input area with drag-and-drop visual feedback, per-file progress, and file type icons. Additionally, inline citations from RAG responses (both uploaded documents and SEC filings) become clickable links that open a modal showing the source text excerpt.

## Glossary

- **Upload_Chip**: An inline pill/badge element attached to the textarea area that represents a queued or uploaded file, displaying file type icon, file name, file size, and a remove button.
- **Chat_Input_Area**: The textarea and its surrounding container in the workspace Research tab where users type queries and attach files.
- **Drag_Drop_Overlay**: A visual overlay that appears on the Chat_Input_Area when a user drags files over it, providing clear feedback that files can be dropped.
- **File_Progress_Indicator**: A per-file progress bar or status indicator within an Upload_Chip showing upload and processing stages.
- **Citation_Link**: A clickable inline reference (e.g., [1], [2]) within a rendered assistant message that links to source text.
- **Source_Modal**: A modal dialog that displays the source text excerpt, metadata (filename, ticker, filing type, section), and relevance score when a Citation_Link is clicked.
- **Upload_Manager**: The frontend component responsible for managing file selection, validation, queuing, uploading, and status tracking of files attached to the Chat_Input_Area.
- **Citation_Renderer**: The frontend function (`renderMarkdownWithCitations`) that converts markdown content with citation references into HTML with clickable Citation_Links.

## Requirements

### Requirement 1: Inline File Chips

**User Story:** As a user, I want to see my queued files as inline chips attached to the chat input area, so that the upload experience feels integrated with the conversation rather than being a separate UI element.

#### Acceptance Criteria

1. WHEN a user selects files via the file picker or drops files onto the Chat_Input_Area, THE Upload_Manager SHALL display each file as an Upload_Chip within the Chat_Input_Area container.
2. THE Upload_Chip SHALL display a file type icon corresponding to the file extension (PDF, DOCX, XLSX, CSV, PPTX, TXT, or image).
3. THE Upload_Chip SHALL display the file name (truncated with ellipsis if longer than 20 characters) and the file size in human-readable format (KB, MB).
4. THE Upload_Chip SHALL include a visible remove button (X icon) that removes the file from the queue when clicked.
5. WHEN a file is removed via the Upload_Chip remove button, THE Upload_Manager SHALL remove the file from the `instantRagFiles` array and remove the corresponding Upload_Chip from the display.
6. WHILE files are queued, THE Chat_Input_Area SHALL display the Upload_Chips in a horizontal row above the textarea, wrapping to additional rows if needed.
7. IF more than 5 files are selected, THEN THE Upload_Manager SHALL reject the excess files and display a notification indicating the maximum file limit.

### Requirement 2: Drag-and-Drop with Visual Feedback

**User Story:** As a user, I want clear visual feedback when I drag files over the chat input area, so that I know where to drop files for upload.

#### Acceptance Criteria

1. WHEN a user drags files over the Chat_Input_Area, THE Drag_Drop_Overlay SHALL appear with a dashed border, a background color change, and an upload icon with instructional text ("Drop files here").
2. WHEN the user drags files away from the Chat_Input_Area without dropping, THE Drag_Drop_Overlay SHALL disappear and the Chat_Input_Area SHALL return to its default appearance.
3. WHEN the user drops files onto the Chat_Input_Area, THE Upload_Manager SHALL add the dropped files to the queue and display them as Upload_Chips.
4. WHILE the Drag_Drop_Overlay is visible, THE Chat_Input_Area SHALL apply a subtle scale transform and border highlight to indicate the active drop zone.

### Requirement 3: Upload Progress and Processing Status

**User Story:** As a user, I want to see per-file upload progress and processing status, so that I know the state of each file during upload and text extraction.

#### Acceptance Criteria

1. WHEN file upload begins, THE File_Progress_Indicator SHALL display a progress bar within each Upload_Chip showing upload percentage.
2. WHILE a file is being processed (text extraction, embedding generation), THE Upload_Chip SHALL display the current processing phase label (e.g., "Uploading", "Extracting text", "Generating embeddings", "Complete").
3. WHEN file processing completes successfully, THE Upload_Chip SHALL display a green checkmark icon and the label "Complete".
4. IF a file upload or processing fails, THEN THE Upload_Chip SHALL display a red error icon and a brief error message.
5. WHILE any file is uploading or processing, THE Upload_Manager SHALL disable the send button and display a loading state on the upload trigger button.

### Requirement 4: Clickable Citation Links for Uploaded Documents

**User Story:** As a user, I want to click on citation references in RAG responses that reference my uploaded documents, so that I can view the original source text excerpt.

#### Acceptance Criteria

1. WHEN the Citation_Renderer processes a message with citations that have `sourceType` equal to `USER_UPLOAD`, THE Citation_Renderer SHALL render each citation reference as a clickable Citation_Link styled distinctly for uploaded documents.
2. WHEN a user clicks a Citation_Link for an uploaded document, THE Source_Modal SHALL open and display the filename, the source text excerpt, and the relevance score.
3. THE Source_Modal SHALL include a "Copy Citation" button that copies the source reference text to the clipboard.
4. THE Source_Modal SHALL include a close button and close when the user clicks outside the modal or presses Escape.

### Requirement 5: Clickable Citation Links for SEC Filings

**User Story:** As a user, I want to click on citation references in RAG responses that reference SEC filings, so that I can view the original filing text excerpt.

#### Acceptance Criteria

1. WHEN the Citation_Renderer processes a message with citations that have `sourceType` equal to `SEC_FILING`, THE Citation_Renderer SHALL render each citation reference as a clickable Citation_Link styled distinctly for SEC filings.
2. WHEN a user clicks a Citation_Link for an SEC filing, THE Source_Modal SHALL open and display the ticker, filing type, fiscal period, section name, page number (if available), and the source text excerpt.
3. THE Source_Modal SHALL reuse the same modal component used for uploaded document citations, adapting the displayed metadata fields based on the source type.

### Requirement 6: Integrated Upload Trigger

**User Story:** As a user, I want the file upload button to feel like a natural part of the chat input, so that attaching files is as seamless as typing a message.

#### Acceptance Criteria

1. THE Chat_Input_Area SHALL display an attachment button (paperclip icon) integrated into the textarea border area, positioned to the left of the textarea.
2. WHEN the user clicks the attachment button, THE Upload_Manager SHALL open the system file picker with the accepted file types filter (.pdf, .docx, .xlsx, .csv, .pptx, .txt, .png, .jpg, .jpeg).
3. WHEN an active Instant RAG session exists, THE attachment button SHALL display a green accent to indicate the session is active.
4. WHILE files are queued but not yet uploaded, THE Chat_Input_Area SHALL display an "Upload & Process" action button or auto-trigger upload when the user sends a message.

### Requirement 7: Source Modal Accessibility and Interaction

**User Story:** As a user, I want the source citation modal to be accessible and easy to interact with, so that I can review source text without disrupting my workflow.

#### Acceptance Criteria

1. THE Source_Modal SHALL be keyboard navigable with focus trapped within the modal while open.
2. WHEN the Source_Modal opens, THE Source_Modal SHALL set focus to the close button.
3. THE Source_Modal SHALL use appropriate ARIA attributes (role="dialog", aria-modal="true", aria-labelledby for the title).
4. THE Source_Modal SHALL display the source text excerpt with preserved formatting (line breaks, paragraphs).
5. WHEN the source text excerpt exceeds the visible area, THE Source_Modal SHALL provide a scrollable content area.
