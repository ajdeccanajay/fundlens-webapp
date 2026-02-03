# Quick Testing URLs

**Start Backend**: `npm run start:dev`

---

## 🎯 Main Features

### Research Assistant (✅ Complete with 21 automated tests)
```
http://localhost:3000/app/research/
```
- Create conversations
- Send messages with streaming
- Pin/unpin/delete
- Quick query cards
- Markdown rendering

### Financial Statement Export (✅ All fixes applied)
```
http://localhost:3000/deal-analysis.html?dealId=<deal-id>
```
- Export to Excel
- Income Statement
- Balance Sheet
- Cash Flow Statement
- All metrics properly mapped

### Deal Dashboard
```
http://localhost:3000/app/deals/
```
- Create and manage deals
- View deal list

### RAG Query
```
http://localhost:3000/rag-query.html
```
- Query SEC filings
- Semantic search
- Source citations

---

## 🧪 Run Tests

```bash
# Research Assistant frontend tests (21 tests)
npm run test:e2e:frontend

# Research Assistant backend tests (30 tests)
npm test -- test/unit/research-assistant.service.spec.ts

# Notebooks backend tests (24 tests)
npm test -- test/unit/notebook.service.spec.ts

# All tests
npm test
```

---

## 📓 Notebooks API (Backend only - no UI yet)

```bash
# Create notebook
curl -X POST http://localhost:3000/research/notebooks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "My Research"}'

# List notebooks
curl http://localhost:3000/research/notebooks \
  -H "Authorization: Bearer <token>"

# Export notebook
curl http://localhost:3000/research/notebooks/<id>/export?format=markdown \
  -H "Authorization: Bearer <token>" \
  -o notebook.md
```

---

## ✅ Test Status

| Feature | Status | Tests |
|---------|--------|-------|
| Research Assistant | ✅ Complete | 51 tests (30 backend + 21 frontend) |
| Financial Export | ✅ Complete | All fixes applied |
| Notebooks Backend | ✅ Complete | 24 tests passing |
| Notebooks Frontend | ⏳ Pending | Not yet implemented |

---

**Total Automated Tests**: 75 tests passing (100%)
