# SEC Parser API

**A comprehensive API for parsing SEC filings using both DOM extraction and XBRL data analysis, designed for RAG chatbot integration.**

## Features

- **Unified DOM Parser**: Extracts structured data from SEC HTML filings (10-K, 10-Q, 8-K)
- **XBRL Parser**: Fetches financial metrics with time-aware filtering
- **FastAPI Endpoints**: RESTful API with automatic documentation
- **Configurable Storage**: Local filesystem or AWS S3 support
- **Production Ready**: Docker containerization and deployment scripts

## Architecture

### 1. Unified DOM Parser
- **Structure via `sec_parsers`**: Builds XML tree with sections and items
- **Tables via DOM**: Extracts HTML tables with BeautifulSoup + lxml
- **Unit Context**: Sniffs unit information (millions/thousands) and computes factors
- **Section Mapping**: Maps tables to document sections using heuristics

### 2. XBRL Parser
- **Time-Aware Filtering**: Aligns with HTML parser time windows
- **Financial Metrics**: 10 key metrics (Revenue, EBIT, Net Income, etc.)
- **Derived Calculations**: Formulas for ratios and growth rates
- **Provenance Tracking**: Detailed source information for transparency

## Quick Start

### Local Development

1. **Clone and Setup**
```bash
git clone <repository-url>
cd unified_sec_parser
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

2. **Start the API**
```bash
python api.py
```

3. **Access Documentation**
- API Docs: http://localhost:8000/docs
- Alternative Docs: http://localhost:8000/redoc

### Production Deployment

1. **Using systemd (Linux)**
```bash
# Create service file
sudo nano /etc/systemd/system/sec-parser-api.service

# Add content:
[Unit]
Description=SEC Parser API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/unified_sec_parser
Environment=PATH=/path/to/unified_sec_parser/venv/bin
ExecStart=/path/to/unified_sec_parser/venv/bin/python api.py
Restart=always

[Install]
WantedBy=multi-user.target

# Enable and start
sudo systemctl enable sec-parser-api
sudo systemctl start sec-parser-api
```

2. **Using PM2 (Node.js process manager)**
```bash
# Install PM2
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'sec-parser-api',
    script: 'api.py',
    interpreter: 'python',
    cwd: '/path/to/unified_sec_parser',
    env: {
      PORT: 8000,
      DEBUG: false
    }
  }]
}
EOF

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## API Endpoints

### 1. SEC Parser (`/sec-parser`)

Parse SEC HTML filings and extract structured data.

**POST** `/sec-parser`
```json
{
  "filing_type": "10-K",
  "filename": "10-K_2024-11-01_0000320193-24-000123.html",
  "output_format": "json"
}
```

**Response**: Complete parsed data including:
- Document structure and hierarchy
- Section mappings and text chunks
- Extracted tables with unit context
- Metadata and export information

### 2. XBRL Parser (`/xbrl-parser`)

Extract financial metrics using XBRL data.

**POST** `/xbrl-parser`
```json
{
  "cik": "0000320193",
  "start_date": "2023-09-30",
  "end_date": "2024-09-28",
  "basis": "FY",
  "metrics": ["rev_ttm", "gross_profit", "ebit", "net_income"]
}
```

**Response**: Financial metrics with formulas
```json
{
  "company": "Apple Inc.",
  "cik": "0000320193",
  "timestamp": "2024-01-15T10:30:00",
  "time_window": {
    "start": "2023-09-30",
    "end": "2024-09-28",
    "basis": "FY"
  },
  "metrics": {
    "gross_profit": {
      "value": 180683000000,
      "unit": "USD",
      "success": true
    }
  },
  "formulas": {
    "gross_margin_pct": "GrossProfit / Revenues",
    "ebitda": "OperatingIncomeLoss + DepreciationAndAmortization"
  }
}
```

### 3. Utility Endpoints

- **GET** `/sec-parser/filings` - List available SEC filings
- **GET** `/xbrl-parser/metrics` - List available XBRL metrics
- **GET** `/` - API information

## Configuration

### Environment Variables

```bash
# API Settings
HOST=0.0.0.0
PORT=8000
DEBUG=false
LOG_LEVEL=INFO

# File Storage
SEC_FILINGS_PATH=data
OUTPUT_PATH=output

# AWS S3 (for production)
USE_S3=false
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
S3_BUCKET=your-bucket

# XBRL Settings
XBRL_CACHE_TTL=3600
XBRL_RATE_LIMIT=0.2
```

### Configuration File

Edit `config.py` to modify default settings:

```python
class Settings:
    SEC_FILINGS_PATH: str = os.getenv("SEC_FILINGS_PATH", "data")
    SUPPORTED_FILING_TYPES: List[str] = ["10-K", "10-Q", "8-K"]
    # ... more settings
```

## Usage Examples

### Python Client

```python
import requests

# Parse SEC filing
response = requests.post("http://localhost:8000/sec-parser", json={
    "filing_type": "10-K",
    "filename": "10-K_2024-11-01_0000320193-24-000123.html"
})
parsed_data = response.json()

# Get XBRL metrics
response = requests.post("http://localhost:8000/xbrl-parser", json={
    "cik": "0000320193",
    "start_date": "2023-09-30",
    "end_date": "2024-09-28",
    "basis": "FY"
})
metrics = response.json()
```

### cURL Examples

```bash
# Parse SEC filing
curl -X POST "http://localhost:8000/sec-parser" \
  -H "Content-Type: application/json" \
  -d '{
    "filing_type": "10-K",
    "filename": "10-K_2024-11-01_0000320193-24-000123.html"
  }'

# Get XBRL metrics
curl -X POST "http://localhost:8000/xbrl-parser" \
  -H "Content-Type: application/json" \
  -d '{
    "cik": "0000320193",
    "start_date": "2023-09-30",
    "end_date": "2024-09-28",
    "basis": "FY"
  }'
```

## Deployment

### AWS Deployment

1. **EC2 Instance**
```bash
# Install Python and dependencies
sudo yum update -y
sudo yum install -y python3 python3-pip git
git clone <repository-url>
cd unified_sec_parser
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run the API
python api.py
```

2. **AWS S3 Integration**
```bash
# Set environment variables
export USE_S3=true
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export S3_BUCKET=your-bucket

# Run with S3
python api.py
```

3. **Load Balancer (ALB)**
```yaml
# alb-config.yml
TargetGroupArn: arn:aws:elasticloadbalancing:region:account:targetgroup/sec-parser/1234567890123456
Port: 8000
Protocol: HTTP
HealthCheckPath: /
```

### Production Considerations

- **Scaling**: Use multiple process instances behind a load balancer
- **Caching**: Implement Redis for XBRL data caching
- **Monitoring**: Add health checks and metrics collection
- **Security**: Implement authentication and rate limiting
- **Storage**: Use S3 for large-scale filing storage

## Development

### Project Structure

```
unified_sec_parser/
├── api.py                 # FastAPI application
├── config.py              # Configuration settings
├── cli.py                 # CLI interface
├── requirements.txt       # Python dependencies
├── data/                  # SEC filings storage
├── output/                # Parsed results
├── unified_sec_parser/    # DOM parser modules
└── xbrl_parsing/          # XBRL parser modules
```

### Adding New Metrics

1. **Update `metric_mapping.yaml`**
```yaml
- id: new_metric
  name: New Metric
  period_type: duration
  taxonomy_tags:
    priority: [us-gaap:NewMetric]
  unit_candidates: [USD]
  sign_rule: positive
```

2. **Add formula to `api.py`**
```python
def get_derived_metrics_formulas():
    return {
        "new_metric": "Formula for new metric",
        # ... existing formulas
    }
```

### Testing

```bash
# Run API tests
python -m pytest tests/

# Test specific endpoint
curl -X POST "http://localhost:8000/sec-parser" \
  -H "Content-Type: application/json" \
  -d '{"filing_type": "10-K", "filename": "test.html"}'
```

## Troubleshooting

### Common Issues

1. **Import Errors**
   - Ensure virtual environment is activated
   - Check Python path and module imports

2. **File Not Found**
   - Verify SEC_FILINGS_PATH is correct
   - Check file permissions

3. **XBRL Rate Limiting**
   - Adjust XBRL_RATE_LIMIT in config
   - Implement caching for repeated requests

4. **Memory Issues**
   - Increase system memory or use swap
   - Process large filings in chunks

### Logs

```bash
# Debug mode
DEBUG=true python api.py

# View logs in background
nohup python api.py > api.log 2>&1 &
tail -f api.log
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## Support

For issues and questions:
- Create an issue on GitHub
- Check the API documentation at `/docs`
- Review the troubleshooting section above
