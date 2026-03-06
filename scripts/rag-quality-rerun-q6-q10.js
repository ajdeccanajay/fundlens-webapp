#!/usr/bin/env node
/**
 * Re-run Q6-Q10 from the RAG quality test (Q1-Q5 passed earlier).
 * Runs sequentially with 5s delay between queries to avoid ALB timeout cascades.
 */
const https = require('https');

const ALB = 'https://fundlens-production-alb-931926615.us-east-1.elb.amazonaws.com';
const PLATFORM_KEY = 'c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(path, ALB);
    const opts = {
      hostname: url.hostname, port: url.port || 443, path: url.pathname, method,
      headers: { 'Content-Type': 'application/json', 'x-platform-admin-key': PLATFORM_KEY },
      rejectUnauthorized: false, timeout: 120000,
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: { raw: data.substring(0, 500) } }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout (120s)')); });
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const QUERIES = [
  {
    id: 'Q6', name: 'Earnings Call Evolution — NVDA AI Narrative 2022→2024',
    body: { query: 'How has NVIDIA management messaging about AI evolved across their earnings calls from 2022 to 2024? Track changes in confidence, specificity, and strategic emphasis.' },
  },
  {
    id: 'Q7', name: 'Insider Trading Activity — TSLA Form 4 Transactions',
    body: { query: 'What insider trading activity has occurred at Tesla recently? Show me the largest insider sales and purchases from Form 4 filings.' },
  },
  {
    id: 'Q8', name: 'Governance & Board — AMGN Board Independence + Shareholder Proposals',
    body: { query: 'Describe Amgen board of directors composition, independence, and any shareholder proposals from their latest proxy statement. How does their governance compare to best practices?' },
  },
  {
    id: 'Q9', name: 'Cross-Company R&D — MSFT vs GOOGL vs AMZN R&D as % of Revenue',
    body: { query: 'Compare research and development spending as a percentage of revenue for Microsoft, Google, and Amazon over the last 3 years. Who invests the most in R&D relative to their size?', options: { tickers: ['MSFT', 'GOOGL', 'AMZN'] } },
  },
  {
    id: 'Q10', name: 'Canadian Filer — SHOP 40-F vs 10-K, 6-K Filings',
    body: { query: 'Shopify files as a Canadian company using 40-F instead of 10-K. Summarize their latest annual report key financials, risk factors, and how their disclosure format differs from US filers.' },
  },
];

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║     RAG QUALITY RE-RUN — Q6 through Q10                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log(`  Target: ${ALB}`);
  console.log(`  Time:   ${new Date().toISOString()}`);
  console.log('');

  for (const q of QUERIES) {
    process.stdout.write(`  ${q.id}: ${q.name}\n       Sending... `);
    const start = Date.now();
    try {
      const res = await request('POST', '/api/rag/query', q.body);
      const elapsed = Date.now() - start;
      const a = res.body.answer || '';
      const m = (res.body.metrics || []).length;
      const n = (res.body.narratives || []).length;
      const c = (res.body.citations || []).length;
      const pi = res.body.processingInfo || {};
      
      console.log(`Done (${(elapsed/1000).toFixed(1)}s, HTTP ${res.status})`);
      console.log(`       Answer: ${a.length} chars | Metrics: ${m} | Narratives: ${n} | Citations: ${c}`);
      console.log(`       Model: ${pi.modelTier || '?'} | Bedrock: ${pi.usedBedrockKB ? 'YES' : 'NO'} | Claude: ${pi.usedClaudeGeneration ? 'YES' : 'NO'}`);
      
      if (a.length > 0) {
        const preview = a.replace(/\n/g, ' ').substring(0, 250);
        console.log(`       Preview: "${preview}..."`);
      } else {
        console.log(`       ⚠️  Empty answer. Raw: ${JSON.stringify(res.body).substring(0, 300)}`);
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
    
    console.log('');
    // Wait 5s between queries to let the server breathe
    if (q !== QUERIES[QUERIES.length - 1]) {
      process.stdout.write('       (waiting 5s) ');
      await sleep(5000);
      console.log('→ next');
    }
  }
  
  console.log('═══════════════════════════════════════════════════════════════════════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
