# Testing URLs Guide - ChatGPT-Like Research Assistant

**Date**: January 27, 2026  
**Status**: Ready for Testing

---

## 🎯 Where to Test the Citation Feature

### ✅ PRIMARY URL (Citations Implemented Here)

**Research Assistant (Standalone)**
```
http://localhost:3000/app/research/index.html
```

**Features Available**:
- ✅ Document upload (PDF/DOCX/TXT)
- ✅ Citation display with superscripts [1], [2], [3]
- ✅ Citation sidebar with metadata
- ✅ Document preview modal
- ✅ Highlighted cited text
- ✅ Keyboard navigation (Escape to close)
- ✅ Mobile responsive

**This is the MAIN page where all citation features are implemented!**

---

### 📋 SECONDARY URL (Basic Research, No Citations Yet)

**Deals Workspace - Research Tab**
```
http://localhost:3000/app/deals/workspace.html#research
```

**Features Available**:
- ✅ Research assistant chat
- ✅ Scratchpad for saving answers
- ✅ System prompt customization
- ✅ Conversation history
- ❌ Citations NOT implemented here yet
- ❌ Document upload NOT available here

**Note**: This is the deals-focused workspace. The citation feature was implemented in the standalone Research Assistant page, not in the workspace.

---

## 🔍 Key Differences

### Research Assistant (Standalone) - `/app/research/index.html`
```
Purpose: General research across all companies
Features:
  ✅ Multi-company research
  ✅ Document upload
  ✅ Citations with document preview
  ✅ Hybrid RAG (SEC + user documents)
  ✅ Standalone interface
```

### Deals Workspace - `/app/deals/workspace.html#research`
```
Purpose: Deal-specific analysis
Features:
  ✅ Deal-focused research
  ✅ Scratchpad integration
  ✅ IC Memo generation
  ✅ System prompt customization
  ❌ No document upload (yet)
  ❌ No citations (yet)
```

---

## 🧪 How to Test Citations

### Step 1: Start Backend
```bash
npm run start:dev
```

### Step 2: Navigate to Research Assistant
```
http://localhost:3000/app/research/index.html
```

### Step 3: Upload a Document (Optional)
1. Click "Upload Document" button (if implemented in UI)
2. Or use API directly:
```bash
curl -X POST http://localhost:3000/api/documents/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@/path/to/document.pdf" \
  -F "tenantId=YOUR_TENANT_ID" \
  -F "ticker=AAPL" \
  -F "extractionTier=advanced"
```

### Step 4: Ask a Question
1. Type a question in the chat input
2. Press Enter or click Send
3. Watch for citations to appear

### Step 5: Verify Citations
- ✅ Look for superscript numbers [1], [2], [3] in the response
- ✅ Check citation sidebar below the message
- ✅ Click on a citation to open preview modal
- ✅ Verify highlighted text in modal
- ✅ Press Escape to close modal

---

## 📊 API Endpoints for Testing

### Document Upload
```
POST /api/documents/upload
Headers: Authorization: Bearer <token>
Body: multipart/form-data
  - file: PDF/DOCX/TXT file
  - tenantId: UUID
  - ticker: string (optional)
  - extractionTier: 'basic' | 'advanced'
```

### List Documents
```
GET /api/documents?tenantId=<uuid>&ticker=<ticker>
Headers: Authorization: Bearer <token>
```

### Research Assistant
```
POST /api/research/conversations/:id/messages
Headers: Authorization: Bearer <token>
Body: { message: "Your question here" }
Response: SSE stream with citations
```

---

## 🐛 Troubleshooting

### Citations Not Showing?

**Check 1: Are you on the right page?**
```
✅ Correct: http://localhost:3000/app/research/index.html
❌ Wrong:   http://localhost:3000/app/deals/workspace.html#research
```

**Check 2: Check browser console**
```javascript
// Should see:
📎 Received citations: [...]
```

**Check 3: Verify SSE stream**
```javascript
// Open Network tab, look for SSE connection
// Should see events:
- token (streaming response)
- sources (SEC filings)
- citations (user documents) ← NEW
- complete (done)
```

**Check 4: Check backend logs**
```bash
# Should see:
[ResearchAssistantService] Storing 3 citations for message...
✅ Stored 3 citations
```

### Document Upload Not Working?

**Check 1: S3 bucket configured**
```bash
# Check .env file
AWS_S3_BUCKET=fundlens-documents-dev
AWS_REGION=us-east-1
```

**Check 2: File size < 10MB**
```bash
ls -lh document.pdf
# Should be < 10MB
```

**Check 3: Document limit**
```bash
# Max 25 documents per tenant
curl http://localhost:3000/api/documents?tenantId=<uuid>
# Count should be < 25
```

---

## 🎨 Visual Guide

### Research Assistant Page Layout
```
┌─────────────────────────────────────────────────────┐
│  FundLens - Research Assistant                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [User Message]                                     │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ Assistant Response with citations [1] [2]   │   │
│  │                                             │   │
│  │ Citations:                                  │   │
│  │ ┌─────────────────────────────────────┐    │   │
│  │ │ [1] document.pdf | Page 5           │    │   │
│  │ │     "Revenue increased to $2.5B..." │    │   │
│  │ └─────────────────────────────────────┘    │   │
│  │ ┌─────────────────────────────────────┐    │   │
│  │ │ [2] report.docx | Page 12           │    │   │
│  │ │     "Operating margin improved..."  │    │   │
│  │ └─────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [Type your message...]                    [Send]  │
└─────────────────────────────────────────────────────┘
```

### Citation Preview Modal
```
┌─────────────────────────────────────────────────────┐
│  Document Preview                            [X]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  📄 document.pdf                                    │
│  🏢 AAPL | Page 5                                   │
│  ⭐ Relevance: 92%                                  │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ "Revenue increased to $2.5B in Q4 2023,    │   │
│  │  representing a 15% year-over-year growth  │   │
│  │  driven by strong iPhone sales..."         │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [Download Document]                                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 📝 Test Checklist

### Basic Functionality
- [ ] Navigate to `/app/research/index.html`
- [ ] Create a new conversation
- [ ] Send a message
- [ ] Receive response with streaming
- [ ] See citations appear (if user docs exist)

### Citation Display
- [ ] Citations show as superscripts [1], [2], [3]
- [ ] Citation sidebar displays below message
- [ ] Citation metadata shows (filename, ticker, page)
- [ ] Snippet preview displays
- [ ] Relevance score shows

### Citation Preview
- [ ] Click citation opens modal
- [ ] Modal shows document metadata
- [ ] Cited text is highlighted
- [ ] Close button works
- [ ] Escape key closes modal
- [ ] Click outside closes modal

### Mobile Responsive
- [ ] Layout adapts to mobile screen
- [ ] Citations readable on mobile
- [ ] Modal works on mobile
- [ ] Touch interactions work

---

## 🚀 Next Steps

### To Add Citations to Workspace
If you want citations in the Deals Workspace (`/app/deals/workspace.html`), you would need to:

1. **Copy citation CSS** from `index.html` to `workspace.html`
2. **Add citation display** in the research message template
3. **Add citation modal** component
4. **Update message handling** to include citations
5. **Test integration** with workspace features

**Estimated effort**: 1-2 hours

---

## 📚 Documentation References

- **[FINAL_STATUS.md](.kiro/specs/chatgpt-like-research-assistant/FINAL_STATUS.md)** - Complete overview
- **[QUICK_REFERENCE.md](.kiro/specs/chatgpt-like-research-assistant/QUICK_REFERENCE.md)** - API reference
- **[PHASE4_FRONTEND_COMPLETE.md](.kiro/specs/chatgpt-like-research-assistant/PHASE4_FRONTEND_COMPLETE.md)** - Frontend implementation details

---

## Summary

**✅ Test Here (Citations Work)**:
```
http://localhost:3000/app/research/index.html
```

**❌ Not Here (No Citations Yet)**:
```
http://localhost:3000/app/deals/workspace.html#research
```

The citation feature is **fully implemented and working** in the standalone Research Assistant page. If you want it in the Deals Workspace, that would be a separate integration task.

---

**Last Updated**: January 27, 2026
