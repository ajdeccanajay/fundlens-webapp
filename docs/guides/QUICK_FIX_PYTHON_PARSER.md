# Quick Fix: Python Parser Not Running

## Problem
```
ERROR: Pipeline cannot start: Python parser not available: fetch failed
```

## Solution (30 seconds)
```bash
# Start Python parser
cd python_parser
python3 api_server.py &

# Verify it's running
curl http://localhost:8000/health
# Should return: {"status":"healthy","parser":"ready"}
```

## Why This Happens
The Python parser API server must be running on port 8000 before the pipeline can start. It's a separate service from the Node.js backend.

## Check Status
```bash
# Is it running?
lsof -i :8000

# Is it healthy?
curl http://localhost:8000/health
```

## Stop Python Parser
```bash
# Find process
lsof -i :8000

# Kill it
kill <PID>
```

## For Production
Add to your startup script or Docker container to start both services together.

See `PYTHON_PARSER_FIX_COMPLETE.md` for full details.
