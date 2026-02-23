#!/usr/bin/env node
/**
 * RAG Regression Battery Test — Exhaustive
 * Covers: simple metrics, case variations, company names, workspace context,
 * multi-ticker, peer comparison, computed metrics, qualitative/narrative,
 * provocations, sentiment, contradictions, credibility, hybrid queries,
 * edge cases, and period-specific queries.
 *
 * Run: node scripts/rag-regression-battery.js
 */

const http = require('http');

const BASE = 'http://localhost:3000';

// ─── Helper: HTTP request ────────────────────────────────────────────────────
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 45000,
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: { raw: data.substring(0, 300) } });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout (45s)')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Evaluators ──────────────────────────────────────────────────────────────
function expectMetrics(res) {
  const b = res.body;
  if (b.error) return { pass: false, reason: `Error: ${b.error}` };
  if (b.intent?.needsClarification) return { pass: false, reason: `Clarification: "${b.intent.ambiguityReason}"` };
  const n = b.metrics?.length || 0;
  if (n > 0) return { pass: true, reason: `${n} metrics` };
  if (b.answer && b.answer.length > 30 && !/no data/i.test(b.answer)) return { pass: true, reason: 'narrative answer (no structured metrics)' };
  return { pass: false, reason: `No metrics. Answer: "${(b.answer || '').substring(0, 120)}"` };
}

function expectAny(res) {
  const b = res.body;
  if (b.error) return { pass: false, reason: `Error: ${b.error}` };
  if (b.answer && b.answer.length > 20 && !/i need more information/i.test(b.answer)) return { pass: true, reason: `${b.answer.length} chars` };
  if (b.intent?.needsClarification) return { pass: false, reason: `Clarification: "${b.intent.ambiguityReason}"` };
  return { pass: false, reason: `Weak/empty: "${(b.answer || '').substring(0, 120)}"` };
}

function expectSuccess(res) {
  const b = res.body;
  if (b.success === true) return { pass: true, reason: 'success=true' };
  if (b.error) return { pass: false, reason: `Error: ${b.error}` };
  return { pass: false, reason: `success=${b.success}` };
}

function expectArray(field) {
  return (res) => {
    const b = res.body;
    if (b.error) return { pass: false, reason: `Error: ${b.error}` };
    const arr = b[field];
    if (Array.isArray(arr)) return { pass: true, reason: `${arr.length} ${field}` };
    return { pass: false, reason: `No ${field} array` };
  };
}

function expectHasField(field) {
  return (res) => {
    const b = res.body;
    if (b.error) return { pass: false, reason: `Error: ${b.error}` };
    if (b[field] !== undefined && b[field] !== null) return { pass: true, reason: `${field} present` };
    return { pass: false, reason: `Missing ${field}` };
  };
}

// ─── Test definitions ────────────────────────────────────────────────────────
const GROUPS = [];

// ── GROUP 1: Simple metric queries — case variations ─────────────────────────
GROUPS.push({
  name: '1. SIMPLE METRICS (case variations)',
  tests: [
    { name: 'revenue lowercase',       method: 'POST', path: '/api/rag/query', body: { query: 'what is abnb revenue?' }, eval: expectMetrics },
    { name: 'Revenue Title Case',      method: 'POST', path: '/api/rag/query', body: { query: 'What is ABNB Revenue?' }, eval: expectMetrics },
    { name: 'REVENUE uppercase',       method: 'POST', path: '/api/rag/query', body: { query: 'What is ABNB REVENUE?' }, eval: expectMetrics },
    { name: 'revenues plural',         method: 'POST', path: '/api/rag/query', body: { query: 'What are AAPL revenues?' }, eval: expectMetrics },
    { name: 'REVENUES plural upper',   method: 'POST', path: '/api/rag/query', body: { query: 'What are AAPL REVENUES?' }, eval: expectMetrics },
    { name: 'net income',              method: 'POST', path: '/api/rag/query', body: { query: 'What is NVDA net income?' }, eval: expectMetrics },
    { name: 'NET INCOME upper',        method: 'POST', path: '/api/rag/query', body: { query: 'NVDA NET INCOME' }, eval: expectMetrics },
    { name: 'total assets',            method: 'POST', path: '/api/rag/query', body: { query: 'What are AMZN total assets?' }, eval: expectMetrics },
    { name: 'gross profit',            method: 'POST', path: '/api/rag/query', body: { query: 'What is AAPL gross profit?' }, eval: expectMetrics },
    { name: 'operating income',        method: 'POST', path: '/api/rag/query', body: { query: 'ABNB operating income' }, eval: expectMetrics },
    { name: 'cost of revenue',         method: 'POST', path: '/api/rag/query', body: { query: 'What is AMZN cost of revenue?' }, eval: expectMetrics },
    { name: 'total revenue',           method: 'POST', path: '/api/rag/query', body: { query: 'AAPL total revenue' }, eval: expectMetrics },
    { name: 'net sales',               method: 'POST', path: '/api/rag/query', body: { query: 'What are ABNB net sales?' }, eval: expectMetrics },
  ],
});

// ── GROUP 2: Period-specific queries ─────────────────────────────────────────
GROUPS.push({
  name: '2. PERIOD-SPECIFIC QUERIES',
  tests: [
    { name: 'FY2024 revenue',          method: 'POST', path: '/api/rag/query', body: { query: 'What is AAPL revenue for FY2024?' }, eval: expectMetrics },
    { name: 'Q3 2024 revenue',         method: 'POST', path: '/api/rag/query', body: { query: 'ABNB revenue Q3 2024' }, eval: expectMetrics },
    { name: 'latest revenue',          method: 'POST', path: '/api/rag/query', body: { query: 'What is the latest NVDA revenue?' }, eval: expectMetrics },
    { name: 'annual net income',       method: 'POST', path: '/api/rag/query', body: { query: 'AMZN annual net income' }, eval: expectMetrics },
  ],
});

// ── GROUP 3: Company name resolution (no ticker) ────────────────────────────
GROUPS.push({
  name: '3. COMPANY NAME RESOLUTION',
  tests: [
    { name: 'Airbnb revenue',          method: 'POST', path: '/api/rag/query', body: { query: 'What is Airbnb revenue?' }, eval: expectAny },
    { name: 'Apple net income',        method: 'POST', path: '/api/rag/query', body: { query: 'What is Apple net income?' }, eval: expectAny },
    { name: 'Amazon revenues',         method: 'POST', path: '/api/rag/query', body: { query: 'What are Amazon revenues?' }, eval: expectAny },
    { name: 'Nvidia total revenue',    method: 'POST', path: '/api/rag/query', body: { query: 'Nvidia total revenue' }, eval: expectAny },
  ],
});

// ── GROUP 4: Workspace context (ticker in options) ──────────────────────────
GROUPS.push({
  name: '4. WORKSPACE CONTEXT (ticker in options)',
  tests: [
    { name: 'revenue with context',    method: 'POST', path: '/api/rag/query', body: { query: 'What is the revenue?', options: { ticker: 'ABNB' } }, eval: expectMetrics },
    { name: 'net income with context',  method: 'POST', path: '/api/rag/query', body: { query: 'Show me net income', options: { ticker: 'AAPL' } }, eval: expectMetrics },
    { name: 'latest financials ctx',    method: 'POST', path: '/api/rag/query', body: { query: 'What are the latest financials?', options: { ticker: 'NVDA' } }, eval: expectAny },
    { name: 'operating expenses ctx',   method: 'POST', path: '/api/rag/query', body: { query: 'operating expenses', options: { ticker: 'AMZN' } }, eval: expectMetrics },
  ],
});

// ── GROUP 5: Multi-ticker / peer comparison ─────────────────────────────────
GROUPS.push({
  name: '5. MULTI-TICKER & PEER COMPARISON',
  tests: [
    { name: 'compare AAPL vs AMZN',    method: 'POST', path: '/api/rag/query', body: { query: 'Compare AAPL and AMZN revenue' }, eval: expectAny },
    { name: 'ABNB vs AAPL revenue',     method: 'POST', path: '/api/rag/query', body: { query: 'Compare ABNB revenue vs AAPL revenue' }, eval: expectAny },
    { name: 'multi-ticker net income',  method: 'POST', path: '/api/rag/query', body: { query: 'NVDA and AMZN net income comparison' }, eval: expectAny },
    { name: 'peer tickers option',      method: 'POST', path: '/api/rag/query', body: { query: 'Compare revenue', options: { tickers: ['AAPL', 'AMZN'] } }, eval: expectAny },
  ],
});

// ── GROUP 6: Computed / derived metrics ─────────────────────────────────────
GROUPS.push({
  name: '6. COMPUTED / DERIVED METRICS',
  tests: [
    { name: 'gross margin',            method: 'POST', path: '/api/rag/query', body: { query: 'What is AAPL gross margin?' }, eval: expectAny },
    { name: 'operating margin',        method: 'POST', path: '/api/rag/query', body: { query: 'ABNB operating margin' }, eval: expectAny },
    { name: 'free cash flow',          method: 'POST', path: '/api/rag/query', body: { query: 'What is AMZN free cash flow?' }, eval: expectAny },
    { name: 'revenue growth',          method: 'POST', path: '/api/rag/query', body: { query: 'How has AAPL revenue grown over the last 3 years?' }, eval: expectAny },
    { name: 'EPS',                     method: 'POST', path: '/api/rag/query', body: { query: 'What is NVDA earnings per share?' }, eval: expectAny },
  ],
});

// ── GROUP 7: Qualitative / narrative queries ────────────────────────────────
GROUPS.push({
  name: '7. QUALITATIVE / NARRATIVE',
  tests: [
    { name: 'risk factors',            method: 'POST', path: '/api/rag/query', body: { query: 'What are the risk factors for ABNB?' }, eval: expectAny },
    { name: 'business strategy',       method: 'POST', path: '/api/rag/query', body: { query: 'Describe NVDA business strategy' }, eval: expectAny },
    { name: 'competitive landscape',   method: 'POST', path: '/api/rag/query', body: { query: 'What is the competitive landscape for AMZN?' }, eval: expectAny },
    { name: 'management discussion',   method: 'POST', path: '/api/rag/query', body: { query: 'Summarize AAPL management discussion and analysis' }, eval: expectAny },
    { name: 'business description',    method: 'POST', path: '/api/rag/query', body: { query: 'What does Airbnb do?' }, eval: expectAny },
  ],
});

// ── GROUP 8: Hybrid queries (metrics + narrative) ───────────────────────────
GROUPS.push({
  name: '8. HYBRID QUERIES (metrics + narrative)',
  tests: [
    { name: 'revenue + risk',          method: 'POST', path: '/api/rag/query', body: { query: 'What is ABNB revenue and what are the key risks?' }, eval: expectAny },
    { name: 'financials + strategy',   method: 'POST', path: '/api/rag/query', body: { query: 'Show AAPL financials and business strategy' }, eval: expectAny },
    { name: 'net income + outlook',    method: 'POST', path: '/api/rag/query', body: { query: 'NVDA net income and future outlook' }, eval: expectAny },
  ],
});

// ── GROUP 9: Provocations API ───────────────────────────────────────────────
GROUPS.push({
  name: '9. PROVOCATIONS API',
  tests: [
    { name: 'analyze provocations',    method: 'POST', path: '/api/provocations/analyze', body: { ticker: 'ABNB', mode: 'provocations' }, eval: expectSuccess },
    { name: 'get cached provocations', method: 'GET',  path: '/api/provocations/ABNB?mode=provocations', eval: expectSuccess },
    { name: 'available modes',         method: 'GET',  path: '/api/provocations/ABNB/modes', eval: expectSuccess },
    { name: 'value investing provs',   method: 'GET',  path: '/api/provocations/ABNB/value-investing', eval: expectSuccess },
    { name: 'switch mode',             method: 'POST', path: '/api/provocations/mode', body: { mode: 'provocations' }, eval: expectSuccess },
    { name: 'query count',             method: 'GET',  path: '/api/provocations/ABNB/query-count', eval: expectSuccess },
  ],
});

// ── GROUP 10: Sentiment API ─────────────────────────────────────────────────
GROUPS.push({
  name: '10. SENTIMENT ANALYSIS',
  tests: [
    { name: 'ABNB sentiment',          method: 'GET',  path: '/api/provocations/ABNB/sentiment', eval: expectSuccess },
    { name: 'AAPL sentiment',          method: 'GET',  path: '/api/provocations/AAPL/sentiment', eval: expectSuccess },
  ],
});

// ── GROUP 11: Contradictions & Credibility ──────────────────────────────────
GROUPS.push({
  name: '11. CONTRADICTIONS & CREDIBILITY',
  tests: [
    { name: 'ABNB contradictions',     method: 'GET',  path: '/api/provocations/ABNB/contradictions', eval: expectSuccess },
    { name: 'ABNB credibility',        method: 'GET',  path: '/api/provocations/ABNB/credibility', eval: expectSuccess },
  ],
});

// ── GROUP 12: Edge cases ────────────────────────────────────────────────────
GROUPS.push({
  name: '12. EDGE CASES',
  tests: [
    { name: 'unknown ticker',          method: 'POST', path: '/api/rag/query', body: { query: 'What is ZZZZ revenue?' }, eval: (res) => {
      const b = res.body;
      // Should NOT crash — either clarification, no-data message, or graceful answer
      if (b.error && /internal/i.test(b.error)) return { pass: false, reason: 'Internal error' };
      return { pass: true, reason: b.intent?.needsClarification ? 'clarification' : 'graceful' };
    }},
    { name: 'empty query',             method: 'POST', path: '/api/rag/query', body: { query: '' }, eval: (res) => {
      if (res.status >= 500) return { pass: false, reason: `Server error ${res.status}` };
      return { pass: true, reason: 'no crash' };
    }},
    { name: 'gibberish query',         method: 'POST', path: '/api/rag/query', body: { query: 'asdfghjkl qwerty' }, eval: (res) => {
      if (res.status >= 500) return { pass: false, reason: `Server error ${res.status}` };
      return { pass: true, reason: 'no crash' };
    }},
    { name: 'very long query',         method: 'POST', path: '/api/rag/query', body: { query: 'What is the revenue for AAPL ' + 'and also '.repeat(50) + 'net income?' }, eval: (res) => {
      if (res.status >= 500) return { pass: false, reason: `Server error ${res.status}` };
      return { pass: true, reason: 'no crash' };
    }},
    { name: 'unknown metric',          method: 'POST', path: '/api/rag/query', body: { query: 'What is AAPL flurble ratio?' }, eval: (res) => {
      if (res.status >= 500) return { pass: false, reason: `Server error ${res.status}` };
      return { pass: true, reason: 'graceful' };
    }},
    { name: 'ticker only no metric',   method: 'POST', path: '/api/rag/query', body: { query: 'AAPL' }, eval: (res) => {
      if (res.status >= 500) return { pass: false, reason: `Server error ${res.status}` };
      return { pass: true, reason: 'no crash' };
    }},
  ],
});

// ── GROUP 13: Ticker case sensitivity ───────────────────────────────────────
GROUPS.push({
  name: '13. TICKER CASE SENSITIVITY',
  tests: [
    { name: 'lowercase ticker abnb',   method: 'POST', path: '/api/rag/query', body: { query: 'abnb revenue' }, eval: expectMetrics },
    { name: 'mixed case Aapl',         method: 'POST', path: '/api/rag/query', body: { query: 'Aapl net income' }, eval: expectAny },
    { name: 'lowercase nvda',          method: 'POST', path: '/api/rag/query', body: { query: 'nvda total revenue' }, eval: expectAny },
  ],
});

// ─── Runner ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          RAG REGRESSION BATTERY — EXHAUSTIVE                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  let totalPassed = 0;
  let totalFailed = 0;
  let totalErrors = 0;
  const allFailures = [];

  for (const group of GROUPS) {
    console.log(`\n── ${group.name} ${'─'.repeat(Math.max(0, 58 - group.name.length))}`);
    for (const t of group.tests) {
      const label = `  ${t.name.padEnd(30)}`;
      process.stdout.write(label);
      try {
        const res = await request(t.method, t.path, t.body);
        const result = t.eval(res);
        if (result.pass) {
          console.log(`  ✅  ${result.reason}`);
          totalPassed++;
        } else {
          console.log(`  ❌  ${result.reason}`);
          totalFailed++;
          allFailures.push({ group: group.name, name: t.name, reason: result.reason });
        }
      } catch (err) {
        console.log(`  💥  ${err.message}`);
        totalErrors++;
        allFailures.push({ group: group.name, name: t.name, reason: err.message });
      }
    }
  }

  const total = totalPassed + totalFailed + totalErrors;
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${String(totalPassed).padStart(3)} passed  ${String(totalFailed).padStart(3)} failed  ${String(totalErrors).padStart(3)} errors  /  ${total} total    ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  if (allFailures.length > 0) {
    console.log('\n  FAILURES:');
    for (const f of allFailures) {
      console.log(`    ❌ [${f.group}] ${f.name}`);
      console.log(`       → ${f.reason}`);
    }
  }

  const passRate = total > 0 ? ((totalPassed / total) * 100).toFixed(1) : '0.0';
  console.log(`\n  Pass rate: ${passRate}%\n`);
  process.exit(allFailures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
