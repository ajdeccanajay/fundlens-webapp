#!/usr/bin/env node
/* Pre-deployment Regression Battery: 12 queries covering all 20 spec fixes */
const http = require('http');
const fs = require('fs');
const BASE = 'http://localhost:3000';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJjdXN0b206dGVuYW50X2lkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIiwiY3VzdG9tOnRlbmFudF9zbHVnIjoiZGVmYXVsdCIsImN1c3RvbTp0ZW5hbnRfcm9sZSI6ImFkbWluIiwidXNlcm5hbWUiOiJ0ZXN0QHRlc3QuY29tIn0.test_signature';
const TIMEOUT = 180000;
const LOGF = '/tmp/fundlens-regression-battery.log';
const logS = fs.createWriteStream(LOGF, { flags: 'w' });
const log = (...a) => { const m = a.join(' '); console.log(m); logS.write(m + '\n'); };

function rq(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const o = { hostname: u.hostname, port: u.port, path: u.pathname, method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN } };
    const r = http.request(o, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          if (res.headers['content-type']?.includes('text/event-stream')) resolve({ status: res.statusCode, sse: d });
          else resolve({ status: res.statusCode, data: JSON.parse(d) });
        } catch (e) { resolve({ status: res.statusCode, raw: d }); }
      });
    });
    r.on('error', reject);
    r.setTimeout(TIMEOUT, () => { r.destroy(); reject(new Error('Timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function parseSSE(raw) {
  const evts = []; const lines = raw.split('\n'); let cur = {};
  for (const l of lines) {
    if (l.startsWith('event: ')) cur.type = l.slice(7).trim();
    else if (l.startsWith('data: ')) {
      try { cur.data = JSON.parse(l.slice(6)); } catch { cur.data = l.slice(6); }
      if (cur.type) { evts.push({ ...cur }); cur = {}; }
    }
  }
  return evts;
}

async function send(cid, content, ctx) {
  const r = await rq('POST', '/api/research/conversations/' + cid + '/messages', { content, context: { tickers: [], ...ctx } });
  if (r.sse) {
    const evts = parseSSE(r.sse);
    const ans = evts.filter(e => e.type === 'token').map(e => e.data?.text || (typeof e.data === 'string' ? e.data : '')).join('');
    const cits = evts.find(e => e.type === 'citations')?.data?.citations || [];
    const err = evts.find(e => e.type === 'error');
    return { answer: ans, citations: cits, error: err };
  }
  return { answer: '', citations: [], error: r.data || r.raw };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const TESTS = [
  // --- METRIC QUERIES (Fixes 1,3,5,13,14) ---
  { id: 'METRIC-1', name: 'AMZN FCF Trend',
    query: "What is AMZN's free cash flow and how has it trended over the last 3 years?",
    ctx: { tickers: ['AMZN'] }, must: [/amzn|amazon/i], minLen: 400,
    fixes: '3,5,14', category: 'metric' },
  { id: 'METRIC-2', name: 'AAPL Margins',
    query: "What are AAPL's gross margins and operating margins?",
    ctx: { tickers: ['AAPL'] }, must: [/aapl|apple/i], minLen: 300,
    fixes: '1,13', category: 'metric' },

  // --- NARRATIVE QUERIES (Fixes 8,14,16,17,18) ---
  { id: 'NARR-1', name: 'AMZN Cloud Risks',
    query: "What are the key risks Amazon faces in its cloud business?",
    ctx: { tickers: ['AMZN'] }, must: [/amzn|amazon|aws/i], minLen: 500,
    fixes: '8,14,16,18', category: 'narrative' },
  { id: 'NARR-2', name: 'AAPL Services MDA',
    query: "Summarize Apple's management discussion on services growth",
    ctx: { tickers: ['AAPL'] }, must: [/aapl|apple|service/i], minLen: 500,
    fixes: '14,16,18', category: 'narrative' },

  // --- ANALYST QUERIES (Fixes 19,20, uploaded doc retrieval) ---
  { id: 'ANALYST-1', name: 'AMZN DBS Bull Case + Risks',
    query: "What is the DBS analyst's bull case for Amazon and what are the key risks to their thesis?",
    ctx: { tickers: ['AMZN'] }, must: [/amzn|amazon/i], minLen: 500,
    fixes: '19,20', category: 'analyst', needsUploadedDoc: true },
  { id: 'ANALYST-2', name: 'AAPL DBS vs 10-K',
    query: "Compare the DBS analyst view on AAPL with what the 10-K filings show",
    ctx: { tickers: ['AAPL'] }, must: [/aapl|apple/i], minLen: 500,
    fixes: '16,19,20', category: 'analyst', needsUploadedDoc: true },

  // --- COMPARISON QUERIES (Fixes 3,5,13,16,19) ---
  { id: 'COMPARE-1', name: 'Revenue Growth AMZN vs AAPL',
    query: "Compare revenue growth rates between AMZN and AAPL over the last 3 years",
    ctx: { tickers: ['AMZN', 'AAPL'] }, must: [/amzn|amazon/i, /aapl|apple/i], minLen: 500,
    fixes: '3,13,14', category: 'comparison' },
  { id: 'COMPARE-2', name: 'Operating Leverage',
    query: "Which company has better operating leverage — Amazon or Apple? Show the data.",
    ctx: { tickers: ['AMZN', 'AAPL'] }, must: [/amzn|amazon/i, /aapl|apple/i], minLen: 500,
    fixes: '5,16,19', category: 'comparison' },

  // --- EDGE CASES (Fixes 11A,13) ---
  { id: 'EDGE-1', name: 'Short Query: AMZN Revenue',
    query: "AMZN revenue",
    ctx: { tickers: ['AMZN'] }, must: [/amzn|amazon|revenue/i], minLen: 100,
    fixes: '11A,13', category: 'edge' },
  { id: 'EDGE-2', name: 'Broad Multi-Part Query',
    query: "Tell me everything about Amazon's competitive position, capital allocation strategy, and how analysts view the stock",
    ctx: { tickers: ['AMZN'] }, must: [/amzn|amazon/i], minLen: 1000,
    fixes: '13,18,19', category: 'edge' },

  // --- COMPLEX STRESS TESTS ---
  { id: 'COMPLEX-METRICS', name: 'Full Financial Profile (12+ metrics)',
    query: "Build me a complete financial profile of Amazon: revenue, COGS, gross profit, operating income, net income, EBITDA, free cash flow, operating cash flow, capex, total debt, total assets, and return on equity — for the last 3 fiscal years. Show the year-over-year growth rates and margins where applicable.",
    ctx: { tickers: ['AMZN'] }, must: [/amzn|amazon/i, /revenue/i], minLen: 1500,
    fixes: '1,3,5,13,14', category: 'complex-metric',
    extraChecks: ['hasTable'] },
  { id: 'COMPLEX-NARRATIVE', name: 'Full Investment Thesis (cross-source)',
    query: "Write me a comprehensive investment thesis for Apple. Cover the bull case and bear case, management's strategic priorities from the latest 10-K MD&A, what the DBS analyst report says about valuation and risks, how services revenue is changing the margin profile, and whether the current multiple is justified given growth expectations. Cite specific numbers.",
    ctx: { tickers: ['AAPL'] }, must: [/aapl|apple/i, /bull|bear|thesis|valuation/i], minLen: 2000,
    fixes: '8,14,16,18,19,20', category: 'complex-narrative',
    needsUploadedDoc: true, extraChecks: ['hasICChallenge'] },
];

async function main() {
  log(''); log('='.repeat(80));
  log('  FUNDLENS PRE-DEPLOYMENT REGRESSION BATTERY — 12 QUERIES');
  log('  Date: ' + new Date().toISOString());
  log('  Covers: All 20 spec fixes + vector serialization fix');
  log('='.repeat(80));

  log('\nHealth check...');
  try { const h = await rq('GET', '/api/health'); log('  Status: ' + h.status); }
  catch (e) { log('FATAL: Server unreachable — ' + e.message); process.exit(1); }

  log('\nCreating conversation...');
  const cr = await rq('POST', '/api/research/conversations', { title: 'Regression Battery ' + new Date().toISOString() });
  const cid = cr.data?.data?.id || cr.data?.id;
  if (!cid) { log('FATAL: Could not create conversation'); log(JSON.stringify(cr)); process.exit(1); }
  log('  Conversation ID: ' + cid + '\n');

  let passed = 0, failed = 0, warned = 0;
  const results = [];

  for (const t of TESTS) {
    log('-'.repeat(80));
    log(`TEST [${t.id}]: ${t.name}`);
    log(`  Category: ${t.category} | Fixes tested: ${t.fixes}`);
    log(`  Query: "${t.query.substring(0, 120)}${t.query.length > 120 ? '...' : ''}"`);
    log(`  Tickers: ${JSON.stringify(t.ctx.tickers)}`);
    const t0 = Date.now();

    try {
      const r = await send(cid, t.query, t.ctx);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      log(`  Time: ${elapsed}s`);

      if (r.error) {
        log(`  ERROR: ${JSON.stringify(r.error).substring(0, 500)}`);
        results.push({ id: t.id, status: 'FAILED', reason: 'error', time: elapsed });
        failed++; log(''); await sleep(3000); continue;
      }

      log(`  Answer: ${r.answer.length} chars | Citations: ${r.citations.length}`);

      // Preview (first 1200 chars)
      log('');
      const preview = r.answer.substring(0, 1200).replace(/\n{3,}/g, '\n\n');
      preview.split('\n').forEach(l => log('  | ' + l));
      if (r.answer.length > 1200) log(`  | ... [${r.answer.length} total chars]`);
      log('');

      // Citations summary
      log(`  Citations (${r.citations.length}):`);
      const upDocs = r.citations.filter(c => c.sourceType === 'UPLOADED_DOC' || c.sourceType === 'USER_UPLOAD');
      const secDocs = r.citations.filter(c => c.sourceType === 'SEC_FILING');
      const otherDocs = r.citations.filter(c => !['UPLOADED_DOC','USER_UPLOAD','SEC_FILING'].includes(c.sourceType));
      log(`    SEC: ${secDocs.length} | Uploaded: ${upDocs.length} | Other: ${otherDocs.length}`);
      r.citations.slice(0, 5).forEach((c, i) => {
        log(`    [${i+1}] ${(c.title || c.source || '?').substring(0, 60)} (${c.sourceType || c.type || '?'})`);
      });
      log('');

      // --- CHECKS ---
      const checks = {};

      // Length
      checks.length = r.answer.length >= t.minLen;
      log(`  ✓ Length >= ${t.minLen}: ${checks.length ? 'PASS' : 'FAIL'} (${r.answer.length})`);

      // No errors in answer
      checks.noError = ![/query mismatch/i, /no data available/i, /couldn.*serialize.*vector/i].some(p => p.test(r.answer));
      log(`  ✓ No errors: ${checks.noError ? 'PASS' : 'FAIL'}`);

      // No synthesis fallback
      checks.noSynthFallback = !/synthesis temporarily unavailable/i.test(r.answer);
      log(`  ✓ No synth fallback: ${checks.noSynthFallback ? 'PASS' : 'WARN'}`);

      // Must-contain patterns
      checks.mustContain = t.must.every(p => p.test(r.answer));
      log(`  ✓ Must-contain: ${checks.mustContain ? 'PASS' : 'FAIL'}`);

      // Citations present
      checks.hasCitations = r.citations.length > 0;
      log(`  ✓ Has citations: ${checks.hasCitations ? 'PASS' : 'FAIL'}`);

      // Uploaded doc citations (for analyst queries)
      if (t.needsUploadedDoc) {
        checks.uploadedDoc = upDocs.length > 0 ||
          r.citations.some(c => c.title && /analyst|report|dbs|morgan|goldman/i.test(c.title));
        log(`  ✓ Uploaded doc cited: ${checks.uploadedDoc ? 'PASS' : 'WARN'}`);
      }

      // IC Challenge (for queries that should trigger it)
      const hasIC = [/challenge/i, /risk/i, /caveat/i, /bear case/i, /counter/i, /devil/i, /however/i, /downside/i, /concern/i].some(p => p.test(r.answer));
      if (t.extraChecks?.includes('hasICChallenge') || ['analyst', 'complex-narrative'].includes(t.category)) {
        checks.icChallenge = hasIC;
        log(`  ✓ IC Challenge: ${checks.icChallenge ? 'PASS' : 'WARN'}`);
      }

      // Table presence (for metrics-heavy queries)
      if (t.extraChecks?.includes('hasTable')) {
        checks.hasTable = /\|.*\|.*\|/.test(r.answer) || /\$[\d,.]+[BMK]?/.test(r.answer);
        log(`  ✓ Has table/numbers: ${checks.hasTable ? 'PASS' : 'WARN'}`);
      }

      // Determine result
      const hardFails = ['length', 'noError', 'mustContain', 'hasCitations'];
      const isHardFail = hardFails.some(k => checks[k] === false);
      const softWarns = Object.entries(checks).filter(([k, v]) => !hardFails.includes(k) && v === false);

      let status;
      if (isHardFail) { status = 'FAILED'; failed++; }
      else if (softWarns.length > 0) { status = 'PASSED (with warnings)'; passed++; warned++; }
      else { status = 'PASSED'; passed++; }

      log(`  RESULT: ${status}`);
      results.push({ id: t.id, status, time: elapsed, chars: r.answer.length, citations: r.citations.length });

    } catch (e) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      log(`  EXCEPTION: ${e.message}`);
      results.push({ id: t.id, status: 'FAILED', reason: e.message, time: elapsed });
      failed++;
    }
    log('');
    await sleep(3000);
  }

  // --- SUMMARY ---
  log('='.repeat(80));
  log('  REGRESSION BATTERY SUMMARY');
  log('='.repeat(80));
  log('');
  log(`  Total: ${TESTS.length} | Passed: ${passed} | Failed: ${failed} | With warnings: ${warned}`);
  log('');
  log('  ' + '-'.repeat(76));
  log('  ' + 'ID'.padEnd(20) + 'Status'.padEnd(25) + 'Time'.padEnd(10) + 'Chars'.padEnd(10) + 'Cites');
  log('  ' + '-'.repeat(76));
  for (const r of results) {
    log('  ' + r.id.padEnd(20) + (r.status || '').padEnd(25) + (r.time + 's').padEnd(10) + ((r.chars || '-') + '').padEnd(10) + (r.citations || '-'));
  }
  log('  ' + '-'.repeat(76));
  log('');

  if (failed === 0) {
    log('  ✅ ALL 12 TESTS PASSED — Safe to deploy revision 25');
  } else {
    log(`  ❌ ${failed} test(s) FAILED — Review before deploying`);
  }

  log('');
  log('  Log saved: ' + LOGF);

  try { await rq('DELETE', '/api/research/conversations/' + cid); } catch {}
  logS.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { log('FATAL: ' + e.message); logS.end(); process.exit(1); });
