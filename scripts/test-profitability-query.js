#!/usr/bin/env node
/**
 * Test the profitability comparison query that was failing
 */
const http = require('http');

const BASE_URL = 'http://localhost:3000';
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJjdXN0b206dGVuYW50X2lkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIiwiY3VzdG9tOnRlbmFudF9zbHVnIjoiZGVmYXVsdCIsImN1c3RvbTp0ZW5hbnRfcm9sZSI6ImFkbWluIiwidXNlcm5hbWUiOiJ0ZXN0QHRlc3QuY29tIn0.test_signature';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname, port: url.port, path: url.pathname, method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTH_TOKEN}` },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.headers['content-type']?.includes('text/event-stream')) {
            resolve({ status: res.statusCode, sse: data });
          } else {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          }
        } catch (e) { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function parseSSE(raw) {
  const events = [];
  const lines = raw.split('\n');
  let currentEvent = {};
  for (const line of lines) {
    if (line.startsWith('event: ')) currentEvent.type = line.slice(7).trim();
    else if (line.startsWith('data: ')) {
      try { currentEvent.data = JSON.parse(line.slice(6)); } catch { currentEvent.data = line.slice(6); }
      if (currentEvent.type) { events.push({ ...currentEvent }); currentEvent = {}; }
    }
  }
  return events;
}

async function run() {
  console.log('🧪 Testing: "What is the view on Apple\'s profitability? How does it compare to ABNB?"');
  console.log('   Context: ABNB workspace\n');

  // Create conversation
  const convRes = await request('POST', '/api/research/conversations', { title: 'Profitability Test' });
  const conversationId = convRes.data.data.id;
  console.log(`   Conversation: ${conversationId}`);

  // Send the failing query
  const res = await request('POST', `/api/research/conversations/${conversationId}/messages`, {
    content: "What is the view on Apple's profitability? How does it compare to ABNB?",
    context: { tickers: ['ABNB'] },
  });

  if (res.sse) {
    const events = parseSSE(res.sse);
    const tokens = events.filter(e => e.type === 'token').map(e => e.data.text).join('');
    const citations = events.find(e => e.type === 'citations')?.data?.citations || [];
    const viz = events.find(e => e.type === 'visualization')?.data;
    const error = events.find(e => e.type === 'error');

    console.log('\n' + '─'.repeat(60));
    console.log('ANSWER:');
    console.log(tokens);
    console.log('─'.repeat(60));

    // Check for the bugs
    const hasDegradationMsg = tokens.includes("don't have a metric mapped");
    const mentionsAAPL = tokens.toLowerCase().includes('aapl') || tokens.toLowerCase().includes('apple');
    const mentionsABNB = tokens.toLowerCase().includes('abnb') || tokens.toLowerCase().includes('airbnb');
    const hasMarginData = tokens.toLowerCase().includes('margin') || tokens.toLowerCase().includes('%');
    const hasUploadedDocCitations = citations.some(c => c.sourceType === 'UPLOADED_DOC' || c.type === 'uploaded_document');

    console.log('\n📊 CHECKS:');
    console.log(`   ❌ Degradation message present: ${hasDegradationMsg ? '❌ YES (BUG)' : '✅ NO (FIXED)'}`);
    console.log(`   Mentions AAPL/Apple: ${mentionsAAPL ? '✅' : '❌'}`);
    console.log(`   Mentions ABNB/Airbnb: ${mentionsABNB ? '✅' : '❌'}`);
    console.log(`   Has margin/% data: ${hasMarginData ? '✅' : '❌'}`);
    console.log(`   Citations: ${citations.length}`);
    console.log(`   Uploaded doc citations: ${hasUploadedDocCitations ? '✅' : '⚠️ none'}`);
    console.log(`   Visualization: ${viz ? viz.chartType : 'none'}`);

    if (error) console.log(`   ❌ Error: ${JSON.stringify(error.data)}`);
  } else {
    console.log('❌ No SSE response:', res.data || res.raw);
  }

  // Cleanup
  await request('DELETE', `/api/research/conversations/${conversationId}`);
  console.log('\n🧹 Cleaned up');
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
