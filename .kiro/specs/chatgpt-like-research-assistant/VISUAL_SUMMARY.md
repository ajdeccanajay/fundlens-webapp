# Visual Summary: Workspace Document Upload

Quick visual guide to the document upload feature.

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  FundLens - Deal Workspace                                  │
│  [Home] [Deals]                          Tenant: default    │
├─────────────────────────────────────────────────────────────┤
│  Home > Deals > AAPL                                        │
│  [AAPL Icon] AAPL - Apple Inc.                              │
│              Technology                                      │
├──────────┬──────────────────────────────────────────────────┤
│          │  Research Assistant                              │
│ Analysis │  [Upload Document] [Documents (3)]               │
│ Research │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│ Scratchpad│                                                  │
│ IC Memo  │  ┌────────────────────────────────────────────┐ │
│          │  │ Documents for AAPL                    [↻]  │ │
│ Settings │  ├────────────────────────────────────────────┤ │
│          │  │ ✅ annual-report.pdf (2.3 MB)             │ │
│          │  │    Indexed • 15 chunks • 2 min ago   [🗑] │ │
│          │  │                                            │ │
│          │  │ ⏳ quarterly-results.pdf (1.1 MB)         │ │
│          │  │    Processing... 45%                       │ │
│          │  │                                            │ │
│          │  │ ❌ invalid-file.txt (0.5 MB)              │ │
│          │  │    Failed: Invalid format            [🗑] │ │
│          │  └────────────────────────────────────────────┘ │
│          │                                                  │
│          │  [User Message]                                 │
│          │                                                  │
│          │  ┌──────────────────────────────────────────┐   │
│          │  │ Response with citations [1]              │   │
│          │  │                                          │   │
│          │  │ Citations:                               │   │
│          │  │ [1] annual-report.pdf • Page 5           │   │
│          │  │     "Revenue grew 25% YoY..."            │   │
│          │  └──────────────────────────────────────────┘   │
│          │                                                  │
│          │  [Type your message...]              [Send]     │
└──────────┴──────────────────────────────────────────────────┘
```

---

## Upload Flow

```
┌─────────────┐
│ User clicks │
│   Upload    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ File picker │
│   opens     │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ User selects│
│  PDF/DOCX   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Validate   │
│ type & size │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Upload    │
│  to S3 via  │
│     API     │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Progress  │
│  indicator  │
│   0-100%    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Document   │
│  appears in │
│    list     │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Processing  │
│  (backend)  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Indexed   │
│ (searchable)│
└─────────────┘
```

---

## Processing Pipeline

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Upload  │────▶│    S3    │────▶│ Extract  │
│   File   │     │ Storage  │     │   Text   │
└──────────┘     └──────────┘     └──────────┘
                                        │
                                        ▼
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Bedrock │◀────│PostgreSQL│◀────│  Chunk   │
│    KB    │     │  Chunks  │     │   Text   │
└──────────┘     └──────────┘     └──────────┘
     │                                  │
     │                                  ▼
     │                            ┌──────────┐
     │                            │ Generate │
     │                            │Embeddings│
     │                            └──────────┘
     │                                  │
     │                                  ▼
     │                            ┌──────────┐
     └───────────────────────────▶│  Store   │
                                  │  Chunks  │
                                  └──────────┘
```

---

## Document States

```
┌─────────────┐
│  Uploading  │  ━━━━━━━━━━ 45%
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Processing  │  ⏳ Extracting text...
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Indexed   │  ✅ Ready for search
└─────────────┘

       OR

┌─────────────┐
│   Failed    │  ❌ Invalid format
└─────────────┘
```

---

## Citation Integration

```
User Query: "What does the pitch deck say about growth?"
                    │
                    ▼
            ┌───────────────┐
            │  Hybrid RAG   │
            │   Search      │
            └───────┬───────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌───────────────┐       ┌───────────────┐
│  SEC Filings  │       │   Uploaded    │
│   (10-K, 10-Q)│       │   Documents   │
└───────┬───────┘       └───────┬───────┘
        │                       │
        └───────────┬───────────┘
                    │
                    ▼
            ┌───────────────┐
            │   Response    │
            │ with Citations│
            └───────────────┘
                    │
                    ▼
"Based on the pitch deck [1], revenue grew 25% YoY."

Citations:
[1] pitch-deck.pdf • Page 3
    "Revenue increased from $2B to $2.5B..."
```

---

## Status Icons

```
✅  Indexed       - Document fully processed and searchable
⏳  Processing    - Currently extracting and indexing
❌  Failed        - Processing error occurred
🗑  Delete        - Remove document
↻   Refresh      - Reload document list
📄  Document      - File icon
⬆  Upload        - Upload new document
```

---

## File Validation

```
┌─────────────────────────────────────┐
│  Allowed File Types                 │
├─────────────────────────────────────┤
│  ✅ PDF  (.pdf)                     │
│  ✅ DOCX (.docx)                    │
│  ✅ TXT  (.txt)                     │
│                                     │
│  ❌ PNG  (.png)                     │
│  ❌ JPG  (.jpg)                     │
│  ❌ XLS  (.xlsx)                    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  File Size Limits                   │
├─────────────────────────────────────┤
│  Max Size: 10 MB                    │
│  Max Documents: 25 per tenant       │
└─────────────────────────────────────┘
```

---

## Error Messages

```
┌─────────────────────────────────────────────────────┐
│  Invalid file type. Only PDF, DOCX, and TXT are    │
│  allowed.                                           │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  File too large. Maximum size is 10MB.              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Document limit reached. Maximum 25 documents per   │
│  tenant.                                            │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Upload failed. Please try again.                   │
└─────────────────────────────────────────────────────┘
```

---

## Responsive Design

### Desktop (1920x1080)
```
┌────────────────────────────────────────────────────┐
│  [Upload Document] [Documents (3)]                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ Documents for AAPL                           │ │
│  │ ✅ annual-report.pdf (2.3 MB)               │ │
│  │ ⏳ quarterly-results.pdf (1.1 MB)           │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

### Tablet (768x1024)
```
┌──────────────────────────────────┐
│  [Upload] [Docs (3)]             │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                  │
│  ┌────────────────────────────┐ │
│  │ Documents for AAPL         │ │
│  │ ✅ annual-report.pdf       │ │
│  │ ⏳ quarterly-results.pdf   │ │
│  └────────────────────────────┘ │
└──────────────────────────────────┘
```

### Mobile (375x667)
```
┌────────────────────┐
│  [⬆] [📄 3]       │
│  ━━━━━━━━━━━━━━━  │
│                    │
│  ┌──────────────┐ │
│  │ AAPL Docs    │ │
│  │ ✅ annual... │ │
│  │ ⏳ quarter...│ │
│  └──────────────┘ │
└────────────────────┘
```

---

## Color Scheme

```
Primary:   #1a56db (Indigo)
Success:   #059669 (Green)
Warning:   #d97706 (Orange)
Error:     #dc2626 (Red)
Gray:      #4b5563 (Neutral)

Status Colors:
✅ Indexed:    #10b981 (Green)
⏳ Processing: #3b82f6 (Blue)
❌ Failed:     #ef4444 (Red)
```

---

## Keyboard Shortcuts

```
⌘1  - Switch to Analysis
⌘2  - Switch to Research
⌘3  - Switch to Scratchpad
⌘4  - Switch to IC Memo
ESC - Close document list
```

---

## Animation Timing

```
Upload Progress:  Smooth transition (0.3s)
Document List:    Slide down (0.2s)
Status Change:    Fade in (0.3s)
Delete:           Fade out (0.2s)
```

---

**Visual design follows FundLens brand guidelines with clean, professional UI.**
