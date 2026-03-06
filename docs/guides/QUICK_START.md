# Quick Start Guide

## 🚀 Start Everything

```bash
# Terminal 1: Start NestJS
npm run start:dev

# Terminal 2: Start Python Parser
cd python_parser
python3 api.py
```

## 🌐 Access Points

| Service | URL | Purpose |
|---------|-----|---------|
| Upload Interface | http://localhost:3000/upload-test.html | Upload & process documents |
| Dashboard | http://localhost:3000/dashboard.html | View data & metrics |
| API Docs | http://localhost:3000/docs | Swagger documentation |
| Main App | http://localhost:3000 | Landing page |

## 📤 Quick Upload Test

1. Open: http://localhost:3000/upload-test.html
2. Drag & drop any PDF, DOCX, or HTML file
3. Click "🚀 Upload & Process"
4. Watch the magic happen!

## 🔍 Quick API Tests

```bash
# List documents
curl http://localhost:3000/documents

# Query AAPL metrics
curl "http://localhost:3000/api/sec/query/metrics?ticker=AAPL"

# Get ingested companies
curl http://localhost:3000/api/sec/ingested-tickers

# Health check
curl http://localhost:3000/health
```

## 📊 What You Can Do

✅ Upload documents (PDF, DOCX, PPTX, HTML, TXT)
✅ Process SEC filings (extract 427 metrics)
✅ Extract text from any document
✅ Create chunks for AI/RAG
✅ Query financial metrics
✅ View narrative chunks
✅ Batch process multiple files
✅ Download processed documents

## 🎯 Next Steps

See `NEXT_STEPS_PHASE8.md` for:
- AWS Bedrock RAG integration
- Local RAG testing
- Quarterly data support
- Frontend dashboard

## 📚 Documentation

- `PROJECT_STATUS.md` - Current status & achievements
- `TESTING_GUIDE.md` - Comprehensive testing
- `PHASE7_DOCUMENT_UPLOAD_COMPLETE.md` - Latest features
- `AWS_NATIVE_IMPLEMENTATION.md` - AWS setup guide

## 🆘 Troubleshooting

**Services not starting?**
```bash
# Check ports
lsof -i :3000
lsof -i :8000

# Restart services
# Kill and restart terminals
```

**Database issues?**
```bash
npm run db:push
npm run db:generate
```

**Python issues?**
```bash
cd python_parser
pip3 install -r requirements.txt
pip3 install python-multipart
```

## 🎉 You're Ready!

Your system is running and ready to:
- Process documents
- Extract financial data
- Build AI-powered features

**Start uploading and exploring!** 🚀
