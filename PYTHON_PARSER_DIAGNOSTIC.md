# Python Parser Diagnostic - February 8, 2026

## Issue
Pipeline preflight check failing with error:
```
ERROR [PipelineOrchestrationService] ❌ Preflight FAILED for AMZN: Pipeline cannot start: Python parser not available: fetch failed
```

## Root Cause
The Python parser API server is not running on port 8000.

## Diagnosis Steps

### 1. Check if Python parser is running
```bash
curl http://localhost:8000/health
# Result: Connection refused - Python parser not responding
```

### 2. Check port 8000
```bash
lsof -i :8000
# Result: No process on port 8000
```

### 3. Configuration Check
From `.env`:
```
PYTHON_PARSER_URL=http://localhost:8000
```

## Solution

### Start the Python Parser API Server

The Python parser must be running before the pipeline can start. Here's how to start it:

#### Option 1: Start in Terminal (Recommended for Development)
```bash
cd python_parser
python3 api_server.py
```

The server will start on port 8000 and you should see:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

#### Option 2: Start as Background Process
```bash
cd python_parser
nohup python3 api_server.py > parser.log 2>&1 &
```

#### Option 3: Use Process Manager (Production)
```bash
# Using PM2
pm2 start python_parser/api_server.py --name python-parser --interpreter python3

# Or using systemd (create service file)
sudo systemctl start fundlens-python-parser
```

### Verify Python Parser is Running
```bash
# Check health endpoint
curl http://localhost:8000/health

# Expected response:
# {"status":"healthy","parser":"ready"}
```

## Architecture Context

The Python parser is a **critical dependency** for the pipeline:

1. **Step A (Download SEC Filings)**: Calls Python parser to extract metrics from XBRL/iXBRL
2. **Step B (Parse & Store Metrics)**: Uses Python calculator for derived metrics
3. **Preflight Check**: Verifies Python parser is available before starting pipeline

### Why Python Parser is Required

- **XBRL/iXBRL Parsing**: Python has better libraries for parsing SEC filings
- **Financial Calculations**: Complex calculations (TTM, CAGR, margins) done in Python
- **Accuracy Validation**: Python validator ensures data quality
- **Reporting Units**: Extracts segment/geographic breakdowns

### Pipeline Flow
```
User Request → Preflight Check → Python Parser Health Check
                                        ↓
                                   ✅ Healthy → Start Pipeline
                                   ❌ Failed → Return Error
```

## Prevention

### For Development
Add to your startup script:
```bash
#!/bin/bash
# start-fundlens.sh

# Start Python parser
cd python_parser
python3 api_server.py &
PARSER_PID=$!

# Wait for parser to be ready
sleep 2
curl -s http://localhost:8000/health || {
    echo "Python parser failed to start"
    kill $PARSER_PID
    exit 1
}

# Start Node.js backend
cd ..
npm run start:dev
```

### For Production (ECS/Docker)
Ensure Python parser is included in the container and starts before the Node.js app:

**Dockerfile**:
```dockerfile
# Install Python dependencies
RUN pip3 install -r python_parser/requirements.txt

# Start script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
```

**start.sh**:
```bash
#!/bin/bash
# Start Python parser in background
cd /app/python_parser
python3 api_server.py &

# Wait for it to be ready
sleep 3

# Start Node.js app
cd /app
npm run start:prod
```

## Testing

After starting the Python parser, test the pipeline:

```bash
# 1. Verify parser is running
curl http://localhost:8000/health

# 2. Test pipeline for AMZN
curl -X POST http://localhost:3000/api/deals/pipeline/start \
  -H "Content-Type: application/json" \
  -d '{"ticker": "AMZN", "years": 5}'
```

## Related Files

- **Python Parser**: `python_parser/api_server.py`
- **Preflight Check**: `src/deals/pipeline-orchestration.service.ts` (line ~120)
- **Configuration**: `.env` (PYTHON_PARSER_URL)
- **Health Check**: Calls `http://localhost:8000/health` with 5s timeout

## Status

- [x] Issue identified: Python parser not running
- [ ] Python parser started
- [ ] Pipeline tested successfully
- [ ] Documentation updated

## Next Steps

1. **Immediate**: Start Python parser manually
2. **Short-term**: Add to development startup script
3. **Long-term**: Include in Docker/ECS deployment with health checks
