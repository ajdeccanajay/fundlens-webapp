# News API Status Check - February 2026

## Current Implementation

**Service**: Yahoo Finance (via `yahoo-finance2` npm package)  
**NOT using**: NewsAPI.org

### Endpoints

1. **Company-specific news**:
   ```
   GET /api/news/symbol/:symbol?limit=30
   Example: /api/news/symbol/NVDA?limit=5
   ```

2. **General market news**:
   ```
   GET /api/news/top?query=markets&limit=30
   Example: /api/news/top?limit=5
   ```

## Test Results

### ❌ Both Endpoints Failing

```bash
curl 'http://localhost:3000/api/news/symbol/NVDA?limit=5'
# Response: {"statusCode": 500, "message": "Internal server error"}

curl 'http://localhost:3000/api/news/top?limit=5'
# Response: {"statusCode": 500, "message": "Internal server error"}
```

## Likely Issues

### 1. Yahoo Finance API Changes
The `yahoo-finance2` package may have:
- Breaking API changes
- Rate limiting issues
- Deprecated endpoints
- Authentication requirements

### 2. Missing Dependencies
Check if `yahoo-finance2` is installed:
```bash
npm list yahoo-finance2
```

### 3. Network/Firewall Issues
Yahoo Finance may be blocking requests from your IP/server

## Recommendations

### Option 1: Fix Yahoo Finance Integration

1. **Update the package**:
   ```bash
   npm update yahoo-finance2
   ```

2. **Check server logs** for detailed error:
   ```bash
   # Check NestJS logs when making request
   tail -f logs/app.log
   ```

3. **Test Yahoo Finance directly**:
   ```typescript
   // Create test script: test-yahoo-news.js
   const yahooFinance = require('yahoo-finance2').default;
   
   yahooFinance.insights('NVDA')
     .then(data => console.log(JSON.stringify(data, null, 2)))
     .catch(err => console.error('Error:', err));
   ```

### Option 2: Switch to Alternative News Source

#### A. NewsAPI.org (Paid)
- Requires API key
- Good coverage
- Reliable
- Cost: $449/month for business plan

```typescript
// .env
NEWS_API_KEY=your_key_here

// news.service.ts
import axios from 'axios';

async headlinesBySymbol(symbol: string, limit = 30) {
  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q: symbol,
      apiKey: process.env.NEWS_API_KEY,
      pageSize: limit,
      sortBy: 'publishedAt'
    }
  });
  return response.data.articles;
}
```

#### B. Alpha Vantage News (Free Tier Available)
- Free tier: 25 requests/day
- Paid: $49.99/month for 1200 requests/day

```typescript
// .env
ALPHA_VANTAGE_API_KEY=your_key_here

// news.service.ts
async headlinesBySymbol(symbol: string, limit = 30) {
  const response = await axios.get('https://www.alphavantage.co/query', {
    params: {
      function: 'NEWS_SENTIMENT',
      tickers: symbol,
      apikey: process.env.ALPHA_VANTAGE_API_KEY,
      limit: limit
    }
  });
  return response.data.feed;
}
```

#### C. Finnhub (Free Tier Available)
- Free tier: 60 API calls/minute
- Good for financial news

```typescript
// .env
FINNHUB_API_KEY=your_key_here

// news.service.ts
async headlinesBySymbol(symbol: string, limit = 30) {
  const response = await axios.get('https://finnhub.io/api/v1/company-news', {
    params: {
      symbol: symbol,
      from: new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0],
      to: new Date().toISOString().split('T')[0],
      token: process.env.FINNHUB_API_KEY
    }
  });
  return response.data.slice(0, limit);
}
```

### Option 3: Use Multiple Sources with Fallback

```typescript
async headlinesBySymbol(symbol: string, limit = 30): Promise<Headline[]> {
  try {
    // Try Yahoo Finance first (free)
    return await this.getYahooNews(symbol, limit);
  } catch (error) {
    console.warn('Yahoo Finance failed, trying Finnhub:', error);
    try {
      // Fallback to Finnhub
      return await this.getFinnhubNews(symbol, limit);
    } catch (error2) {
      console.error('All news sources failed:', error2);
      return [];
    }
  }
}
```

## Next Steps

1. **Check server logs** to see exact error from Yahoo Finance
2. **Test Yahoo Finance package** directly with test script
3. **Decide on news provider**:
   - Fix Yahoo Finance (free but unreliable)
   - Switch to paid service (NewsAPI, Alpha Vantage)
   - Use free tier service (Finnhub, Alpha Vantage free)
4. **Update service implementation** based on chosen provider

## Files to Check

- `src/dataSources/news/news.service.ts` - Service implementation
- `src/dataSources/news/news.controller.ts` - API endpoints
- `package.json` - Check yahoo-finance2 version
- Server logs - Check for detailed error messages

## Testing Commands

```bash
# Test company news
curl 'http://localhost:3000/api/news/symbol/NVDA?limit=5'

# Test market news
curl 'http://localhost:3000/api/news/top?limit=5'

# Check API documentation
open http://localhost:3000/docs
```
