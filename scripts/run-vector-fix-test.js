#!/usr/bin/env node
/* Targeted retest: AMZN-2, AAPL-2, CROSS-2 — the 3 queries that failed/fell back */
const http = require('http');
const BASE = 'http://localhost:3000';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJjdXN0b206dGVuYW50X2lkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIiwiY3VzdG9tOnRlbmFudF9zbHVnIjoiZGVmYXVsdCIsImN1c3RvbTp0ZW5hbnRfcm9sZSI6ImFkbWluIiwidXNlcm5hbWUiOiJ0ZXN0QHRlc3QuY29tIn0.test_signature';
const TIMEOUT = 120000;

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
  { id: 'AMZN-2', name: 'AMZN Analyst Sentiment & Key Differences', query: 'What is analyst sentiment about AMZN? What are they saying and point out key differences', ctx: { tickers: ['AMZN'] }, must: [/amazon|amzn/i] },
  { id: 'AAPL-2', name: 'AAPL Analyst Sentiment', query: 'What is analyst sentiment about AAPL? What are they saying and point out key differences', ctx: { tickers: ['AAPL'] }, must: [/apple|aapl/i] },
  { id: 'CROSS-2', name: 'Cross-Company: Analyst Consensus', query: 'Compare analyst consensus and key thesis differences between AMZN and AAPL', ctx: { tickers: ['AMZN', 'AAPL'] }, must: [/amazon|amzn/i, /apple|aapl/i] },
];

async function main() {
  console.log('');
  console.log('='.repeat(70));
  console.log('  VECTOR FIX RETEST — AMZN-2, AAPL-2, CROSS-2');
  console.log('  Date: ' + new Date().toISOString());
  console.log('='.repeat(70));

  console.log('\nHealth check...');
  try { const h = await rq('GET', '/api/health'); console.log('  Status: ' + h.status); }
  catch (e) { console.log('FATAL: ' + e.message); process.exit(1); }

  console.log('\nCreating conversation...');
  const cr = await rq('POST', '/api/research/conversations', { title: 'Vector Fix Retest' });
  const cid = cr.data?.data?.id || cr.data?.id;
  console.log('  ID: ' + cid + '\n');

  let passed = 0, failed = 0;
  for (const t of TESTS) {
    console.log('-'.repeat(70));
    console.log('TEST [' + t.id + ']: ' + t.name);
    console.log('  Query: "' + t.query + '"');
    console.log('  Tickers: ' + JSON.stringify(t.ctx.tickers));
    const t0 = Date.now();
    try {
      const r = await send(cid, t.query, t.ctx);
      const el = ((Date.now() - t0) / 1000).toFixed(1);
      console.log('  Time: ' + el + 's');
      if (r.error) { console.log('  ERROR: ' + JSON.stringify(r.error)); failed++; console.log(''); await sleep(2000); continue; }
      console.log('  Answer: ' + r.answer.length + ' chars');
      console.log('');
      const preview = r.answer.substring(0, 2000).replace(/\n{3,}/g, '\n\n');
      preview.split('\n').forEach(l => console.log('  | ' + l));
      if (r.answer.length > 2000) console.log('  | ... [' + r.answer.length + ' total]');
      console.log('');
      console.log('  Citations (' + r.citations.length + '):');
      r.citations.slice(0, 10).forEach((c, i) => {
        console.log('    [' + (i+1) + '] ' + (c.title || c.source || '?') + ' (' + (c.sourceType || c.type || '?') + ')');
      });
      console.log('');

      // Key checks
      const lenOk = r.answer.length >= 500;
      const noSynthFallback = !/synthesis temporarily unavailable/i.test(r.answer);
      const noVectorErr = !/couldn.*serialize.*vector/i.test(r.answer);
      const mustOk = t.must.every(p => p.test(r.answer));
      const citOk = r.citations.length > 0;
      const upDoc = r.citations.some(c => c.sourceType === 'UPLOADED_DOC' || (c.title && /analyst|report|dbs|morgan|goldman/i.test(c.title)));

      console.log('  Checks:');
      console.log('    Length>=500:          ' + (lenOk ? 'PASS' : 'FAIL') + ' (' + r.answer.length + ')');
      console.log('    No vector error:     ' + (noVectorErr ? 'PASS' : 'FAIL'));
      console.log('    No synth fallback:   ' + (noSynthFallback ? 'PASS' : 'WARN'));
      console.log('    Must-contain:        ' + (mustOk ? 'PASS' : 'FAIL'));
      console.log('    Citations:           ' + (citOk ? 'PASS' : 'FAIL'));
      console.log('    Uploaded docs cited: ' + (upDoc ? 'PASS' : 'WARN'));

      const ok = lenOk && noVectorErr && mustOk && citOk;
      console.log('  RESULT: ' + (ok ? 'PASSED' : 'FAILED'));
      if (ok) passed++; else failed++;
    } catch (e) { console.log('  EXCEPTION: ' + e.message); failed++; }
    console.log('');
    await sleep(2000);
  }

  console.log('='.repeat(70));
  console.log('SUMMARY: ' + passed + '/' + (passed+failed) + ' passed');
  if (failed === 0) console.log('ALL 3 RETESTS PASSED — Vector fix confirmed');
  else console.log(failed + ' test(s) still failing');
  try { await rq('DELETE', '/api/research/conversations/' + cid); } catch {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.log('FATAL: ' + e.message); process.exit(1); });
