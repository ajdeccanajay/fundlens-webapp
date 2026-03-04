#!/usr/bin/env node
/* Pre-deployment Validation: Valuation Comparison Queries */
const http = require('http');
const fs = require('fs');
const BASE = 'http://localhost:3000';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJjdXN0b206dGVuYW50X2lkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIiwiY3VzdG9tOnRlbmFudF9zbHVnIjoiZGVmYXVsdCIsImN1c3RvbTp0ZW5hbnRfcm9sZSI6ImFkbWluIiwidXNlcm5hbWUiOiJ0ZXN0QHRlc3QuY29tIn0.test_signature';
const TIMEOUT = 120000;
const LOGF = '/tmp/fundlens-valuation-test.log';
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
  { id: 'AMZN-1', name: 'AMZN Analyst Forecasts, EV, Multiples & Thesis', query: 'Compare analyst forecasts, enterprise values and multiples and thesis on Amazon', ctx: { tickers: ['AMZN'] }, must: [/amazon|amzn/i] },
  { id: 'AMZN-2', name: 'AMZN Analyst Sentiment & Key Differences', query: 'What is analyst sentiment about AMZN? What are they saying and point out key differences', ctx: { tickers: ['AMZN'] }, must: [/amazon|amzn/i] },
  { id: 'AAPL-1', name: 'AAPL Analyst Forecasts, EV, Multiples & Thesis', query: 'Compare analyst forecasts, enterprise values and multiples and thesis on Apple', ctx: { tickers: ['AAPL'] }, must: [/apple|aapl/i] },
  { id: 'AAPL-2', name: 'AAPL Analyst Sentiment', query: 'What is analyst sentiment about AAPL? What are they saying and point out key differences', ctx: { tickers: ['AAPL'] }, must: [/apple|aapl/i] },
  { id: 'CROSS-1', name: 'Cross-Company: AMZN vs AAPL Valuation', query: 'Compare enterprise value, EBITDA multiples and valuation between Amazon and Apple. Which looks more attractive?', ctx: { tickers: ['AMZN', 'AAPL'] }, must: [/amazon|amzn/i, /apple|aapl/i] },
  { id: 'CROSS-2', name: 'Cross-Company: Analyst Consensus', query: 'Compare analyst consensus and key thesis differences between AMZN and AAPL', ctx: { tickers: ['AMZN', 'AAPL'] }, must: [/amazon|amzn/i, /apple|aapl/i] },
];

async function main() {
  log(''); log('='.repeat(70));
  log('  FUNDLENS PRE-DEPLOYMENT VALIDATION');
  log('  Date: ' + new Date().toISOString());
  log('='.repeat(70));

  log('\nHealth check...');
  try { const h = await rq('GET', '/api/health'); log('  Status: ' + h.status); }
  catch (e) { log('FATAL: ' + e.message); process.exit(1); }

  log('\nCreating conversation...');
  const cr = await rq('POST', '/api/research/conversations', { title: 'Valuation Test' });
  const cid = cr.data?.data?.id || cr.data?.id;
  log('  ID: ' + cid + '\n');

  let passed = 0, failed = 0;
  for (const t of TESTS) {
    log('-'.repeat(70));
    log('TEST [' + t.id + ']: ' + t.name);
    log('  Query: "' + t.query + '"');
    log('  Tickers: ' + JSON.stringify(t.ctx.tickers));
    const t0 = Date.now();
    try {
      const r = await send(cid, t.query, t.ctx);
      const el = ((Date.now() - t0) / 1000).toFixed(1);
      log('  Time: ' + el + 's');
      if (r.error) { log('  ERROR: ' + JSON.stringify(r.error)); failed++; log(''); await sleep(2000); continue; }
      log('  Answer: ' + r.answer.length + ' chars');
      log('');
      const preview = r.answer.substring(0, 1500).replace(/\n{3,}/g, '\n\n');
      preview.split('\n').forEach(l => log('  | ' + l));
      if (r.answer.length > 1500) log('  | ... [' + r.answer.length + ' total]');
      log('');
      log('  Citations (' + r.citations.length + '):');
      r.citations.slice(0, 10).forEach((c, i) => {
        log('    [' + (i+1) + '] ' + (c.title || c.source || '?') + ' (' + (c.sourceType || c.type || '?') + ')');
      });
      log('');
      const lenOk = r.answer.length >= 500;
      const noErr = ![/query mismatch/i, /no data available/i].some(p => p.test(r.answer));
      const mustOk = t.must.every(p => p.test(r.answer));
      const citOk = r.citations.length > 0;
      const rich = r.citations.some(c => c.title && c.title.length > 15);
      const upDoc = r.citations.some(c => c.sourceType === 'UPLOADED_DOC' || (c.title && /analyst|report|dbs|morgan|goldman/i.test(c.title)));
      const ic = [/challenge/i, /risk/i, /caveat/i, /bear case/i, /counter/i, /devil/i].some(p => p.test(r.answer));
      log('  Checks:');
      log('    Length>=500:    ' + (lenOk ? 'PASS' : 'FAIL') + ' (' + r.answer.length + ')');
      log('    No errors:     ' + (noErr ? 'PASS' : 'FAIL'));
      log('    Must-contain:  ' + (mustOk ? 'PASS' : 'FAIL'));
      log('    Citations:     ' + (citOk ? 'PASS' : 'FAIL'));
      log('    Rich titles:   ' + (rich ? 'PASS' : 'WARN'));
      log('    Uploaded docs: ' + (upDoc ? 'PASS' : 'WARN'));
      log('    IC Challenge:  ' + (ic ? 'PASS' : 'WARN'));
      const ok = lenOk && noErr && mustOk && citOk;
      log('  RESULT: ' + (ok ? 'PASSED' : 'FAILED'));
      if (ok) passed++; else failed++;
    } catch (e) { log('  EXCEPTION: ' + e.message); failed++; }
    log('');
    await sleep(2000);
  }

  log('='.repeat(70));
  log('SUMMARY: ' + passed + '/' + (passed+failed) + ' passed');
  if (failed === 0) log('ALL TESTS PASSED — Safe to deploy');
  else log(failed + ' test(s) need review');
  log('\nLog: ' + LOGF);
  try { await rq('DELETE', '/api/research/conversations/' + cid); } catch {}
  logS.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { log('FATAL: ' + e.message); logS.end(); process.exit(1); });
