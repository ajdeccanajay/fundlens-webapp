# Localhost Testing Guide

**Date**: January 26, 2026
**Purpose**: Complete guide to test all features locally

---

## Prerequisites

### 1. Start the Backend Server

```bash
npm run start:dev
```

Wait for the server to start (should see "Nest application successfully started").

### 2. Start the Python Parser (if testing SEC data)

```bash
cd python_parser
python api_server.py
```

---

## 🎯 Main Application URLs

### 1. Main Dashboard
```
http://localhost:3000/
```
**Features**:
- Landing page
- Navigation to all features

### 2. Login Page
```
http://localhost:3000/login.html
```
**Features**:
- User authentication
- Tenant selection

---

## 💼 Deal Analysis & Financial Statements

### 3. Deal Dashboard
```
http://localhost:3000/app/deals/
```
**Features**:
- Create and manage deals
- View deal list
- Access deal details

### 4. Deal Analysis (Specific Deal)
```
http://localhost:3000/deal-analysis.html?dealId=<deal-id>
```
**Features**:
- Financial statement analysis
- Export to Excel (✅ **ALL FIXES APPLIED**)
- Income Statement export
- Balance Sheet export
- Cash Flow Statement export
- Comprehensive financial metrics

**Testing Export**:
1. Open deal analysis page
2. Click "Export Financial Statements" button
3. Select format (Excel)
4. Download should start automatically
5. Open Excel file to verify:
   - ✅ Income Statement tab
   - ✅ Balance Sheet tab
   - ✅ Cash Flow Statement tab
   - ✅ All metrics properly mapped
   - ✅ Reporting units included
   - ✅ Multi-year data
   - ✅ Proper formatting

### 5. Financial Analysis Dashboard
```
http://localhost:3000/financial-analysis.html
```
**Features**:
- Comprehensive financial analysis
- Multi-company comparison
- Trend analysis
- Export capabilities

### 6. Financial Analyst Dashboard (Enhanced)
```
http://localhost:3000/financial-analyst-dashboard-enhanced.html
```
**Features**:
- Advanced financial metrics
- Interactive charts
- Real-time calculations
- Export to Excel

### 7. Comprehensive Financial Analysis
```
http://localhost:3000/comprehensive-financial-analysis.html
```
**Features**:
- Deep dive financial analysis
- All three statements
- Ratio analysis
- Export functionality

---

## 🔬 Research Assistant (Phase 1, 2 & 3 Complete!)

### 8. Research Assistant with Scratchpad
```
http://localhost:3000/app/research/
```
**Features** (✅ **FULLY TESTED**):
- ✅ Create conversations
- ✅ Send messages with streaming responses
- ✅ Pin/unpin conversations
- ✅ Delete conversations
- ✅ Welcome screen with quick queries
- ✅ Markdown rendering
- ✅ Mobile responsive
- ✅ **NEW: Simple Scratchpad**
  - ✅ Save favorite answers
  - ✅ Add personal notes
  - ✅ View saved items
  - ✅ Export to Markdown
  - ✅ Delete items
- ✅ 32 automated tests (21 frontend + 11 scratchpad)

**Testing**:
1. Open Research Assistant
2. Click "New Conversation"
3. Type a query (e.g., "What is AAPL revenue?")
4. Press Enter or click Send
5. Watch streaming response
6. **NEW: Click "Save" button below response**
7. **NEW: Add notes (optional) and click "Save"**
8. **NEW: Click "Scratchpad" button in top nav**
9. **NEW: Verify item appears in scratchpad panel**
10. **NEW: Click "Export to Markdown" to download**
11. **NEW: Delete item with trash icon**
12. Try quick query cards on welcome screen
13. Test pin/unpin/delete operations

---

## 📓 Notebooks (Phase 3 Backend Complete)

### 9. Notebook API Endpoints

**Note**: Backend API complete. Frontend scratchpad UI now available in Research Assistant!

#### Create Notebook
```bash
curl -X POST http://localhost:3000/research/notebooks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Q4 2024 Research",
    "description": "Tech company analysis"
  }'
```

#### List Notebooks
```bash
curl http://localhost:3000/research/notebooks \
  -H "Authorization: Bearer <token>"
```

#### Get Notebook with Insights
```bash
curl http://localhost:3000/research/notebooks/<notebook-id> \
  -H "Authorization: Bearer <token>"
```

#### Add Insight to Notebook
```bash
curl -X POST http://localhost:3000/research/notebooks/<notebook-id>/insights \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "AAPL revenue grew 15% YoY",
    "userNotes": "Strong services growth",
    "tags": ["revenue", "growth"],
    "companies": ["AAPL"]
  }'
```

#### Export Notebook as Markdown
```bash
curl http://localhost:3000/research/notebooks/<notebook-id>/export?format=markdown \
  -H "Authorization: Bearer <token>" \
  -o notebook.md
```

---

## 🔍 RAG Query System

### 10. RAG Query Interface
```
http://localhost:3000/rag-query.html
```
**Features**:
- Query SEC filings
- Semantic search
- Source citations
- Hybrid RAG (structured + semantic)

**Testing**:
1. Enter a query (e.g., "What is Apple's revenue?")
2. Select companies (AAPL)
3. Click "Query"
4. View results with sources

---

## 📄 Document Upload & Processing

### 11. Document Upload
```
http://localhost:3000/upload.html
```
**Features**:
- Upload SEC filings (10-K, 10-Q)
- PDF processing
- Automatic parsing
- Metadata extraction

**Testing**:
1. Select a PDF file (10-K)
2. Enter ticker symbol
3. Click "Upload"
4. Wait for processing
5. View parsed data

---

## 🔧 Admin & Platform Management

### 12. Platform Admin
```
http://localhost:3000/internal/platform-admin.html
```
**Features**:
- Tenant management
- User management
- System monitoring
- Data validation

**Note**: Requires admin authentication

---

## 🧪 Testing Endpoints

### 13. Health Check
```
http://localhost:3000/health
```
**Expected Response**:
```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "memory_heap": { "status": "up" }
  }
}
```

### 14. API Documentation (if Swagger enabled)
```
http://localhost:3000/api
```

---

## 📊 Financial Statement Export Testing

### Complete Export Testing Workflow

#### Step 1: Create or Select a Deal
```
http://localhost:3000/app/deals/
```
1. Click "Create New Deal"
2. Enter deal details
3. Add companies (e.g., AAPL, MSFT)

#### Step 2: Ingest SEC Data
```bash
# Via API
curl -X POST http://localhost:3000/sec/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "AAPL",
    "filingType": "10-K",
    "fiscalYear": 2024
  }'
```

#### Step 3: View Financial Statements
```
http://localhost:3000/deal-analysis.html?dealId=<deal-id>
```

#### Step 4: Export to Excel
1. Click "Export Financial Statements"
2. Select "Excel" format
3. Download file
4. Open in Excel

#### Step 5: Verify Export Quality

**Income Statement**:
- ✅ Revenue (all line items)
- ✅ Cost of Goods Sold
- ✅ Gross Profit
- ✅ Operating Expenses
- ✅ Operating Income
- ✅ Net Income
- ✅ EPS (Basic & Diluted)

**Balance Sheet**:
- ✅ Current Assets
- ✅ Non-Current Assets
- ✅ Total Assets
- ✅ Current Liabilities
- ✅ Non-Current Liabilities
- ✅ Total Liabilities
- ✅ Shareholders' Equity

**Cash Flow Statement**:
- ✅ Operating Activities
- ✅ Investing Activities
- ✅ Financing Activities
- ✅ Net Change in Cash

**Formatting**:
- ✅ Proper column headers
- ✅ Multi-year data (3-5 years)
- ✅ Number formatting (currency)
- ✅ Formulas for calculations
- ✅ Reporting units (if applicable)

---

## 🎨 Frontend Testing (Automated)

### Run Playwright Tests

#### Research Assistant Frontend Tests
```bash
# Run all frontend tests
npm run test:e2e:frontend

# Run in interactive UI mode
npm run test:e2e:frontend:ui

# Run in debug mode
npm run test:e2e:frontend:debug
```

**Tests Covered**:
- ✅ Page load and initialization (5 tests)
- ✅ Conversation management (6 tests)
- ✅ Message sending (4 tests)
- ✅ Welcome screen quick queries (1 test)
- ✅ Markdown rendering (1 test)
- ✅ Responsive design (2 tests)
- ✅ Error handling (2 tests)

**Total**: 21 tests, all passing

---

## 🔐 Authentication Testing

### Get Auth Token (for API testing)

```bash
# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password"
  }'

# Response will include token
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-uuid",
    "email": "test@example.com",
    "tenantId": "tenant-uuid"
  }
}
```

Use the `access_token` in subsequent API calls:
```bash
curl http://localhost:3000/research/notebooks \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## 🐛 Troubleshooting

### Backend Not Starting

```bash
# Check if port 3000 is in use
lsof -i :3000

# Kill process if needed
kill -9 <PID>

# Restart backend
npm run start:dev
```

### Python Parser Not Starting

```bash
# Check if port 5000 is in use
lsof -i :5000

# Kill process if needed
kill -9 <PID>

# Restart parser
cd python_parser
python api_server.py
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
pg_isready

# Restart PostgreSQL (macOS)
brew services restart postgresql

# Check connection
psql -U postgres -d fundlens
```

### Authentication Issues

1. Check `.env` file has correct settings
2. Verify JWT secret is set
3. Check Cognito configuration (if using AWS)
4. Use mock auth for local testing

---

## 📝 Test Checklist

### Research Assistant (Phase 1 & 2)
- [ ] Open http://localhost:3000/app/research/
- [ ] Create new conversation
- [ ] Send message and verify streaming
- [ ] Test quick query cards
- [ ] Pin/unpin conversation
- [ ] Delete conversation
- [ ] Test on mobile viewport
- [ ] Run automated tests: `npm run test:e2e:frontend`

### Financial Statement Export
- [ ] Open http://localhost:3000/deal-analysis.html
- [ ] Click "Export Financial Statements"
- [ ] Download Excel file
- [ ] Verify Income Statement tab
- [ ] Verify Balance Sheet tab
- [ ] Verify Cash Flow Statement tab
- [ ] Check all metrics are present
- [ ] Verify formatting is correct
- [ ] Check multi-year data
- [ ] Verify reporting units (if applicable)

### Notebooks (Backend Only)
- [ ] Test create notebook API
- [ ] Test list notebooks API
- [ ] Test add insight API
- [ ] Test reorder insights API
- [ ] Test export markdown API
- [ ] Run unit tests: `npm test -- test/unit/notebook.service.spec.ts`

### RAG Query System
- [ ] Open http://localhost:3000/rag-query.html
- [ ] Enter query
- [ ] Select companies
- [ ] Verify results
- [ ] Check source citations

---

## 🚀 Quick Start Testing

### 1-Minute Test (Research Assistant)
```bash
# Start backend
npm run start:dev

# Open browser
open http://localhost:3000/app/research/

# Test:
# 1. Click "New Conversation"
# 2. Type "What is AAPL revenue?"
# 3. Press Enter
# 4. Verify streaming response
```

### 5-Minute Test (Financial Export)
```bash
# Start backend
npm run start:dev

# Open browser
open http://localhost:3000/deal-analysis.html?dealId=<deal-id>

# Test:
# 1. Click "Export Financial Statements"
# 2. Download Excel file
# 3. Open in Excel
# 4. Verify all three statement tabs
# 5. Check data accuracy
```

### 10-Minute Test (Full System)
```bash
# Start backend
npm run start:dev

# Run automated tests
npm run test:e2e:frontend

# Manual testing
# 1. Research Assistant
# 2. Financial Export
# 3. RAG Query
# 4. Document Upload

# Verify all features work
```

---

## 📊 Test Results Summary

### Automated Tests
- **Backend Unit Tests**: 30/30 passing (Research Assistant)
- **Backend Unit Tests**: 24/24 passing (Notebooks)
- **Frontend E2E Tests**: 21/21 passing (Research Assistant)
- **Total**: 75/75 tests passing (100%)

### Manual Testing
- **Research Assistant**: ✅ Fully functional
- **Financial Export**: ✅ All fixes applied
- **Notebooks Backend**: ✅ API working
- **Notebooks Frontend**: ⏳ Not yet implemented
- **RAG Query**: ✅ Functional
- **Document Upload**: ✅ Functional

---

## 🎯 Priority Testing Order

1. **Research Assistant** (http://localhost:3000/app/research/)
   - Most complete feature
   - 21 automated tests
   - Full UI implementation

2. **Financial Statement Export** (http://localhost:3000/deal-analysis.html)
   - All fixes applied
   - Critical for institutional users
   - Test Excel export thoroughly

3. **Notebooks API** (via curl/Postman)
   - Backend complete
   - 24 unit tests passing
   - Frontend UI pending

4. **RAG Query** (http://localhost:3000/rag-query.html)
   - Core functionality
   - Test semantic search

5. **Document Upload** (http://localhost:3000/upload.html)
   - Test PDF processing
   - Verify parsing accuracy

---

**Created**: January 26, 2026
**Status**: Ready for Testing
**Backend**: Running on http://localhost:3000
**Python Parser**: Running on http://localhost:5000
