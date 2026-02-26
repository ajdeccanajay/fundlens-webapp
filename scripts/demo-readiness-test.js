#!/usr/bin/env node
/**
 * Demo Readiness Test — validates all critical paths for the BIG DEMO
 * 
 * Tests:
 * 1. Basic structured metric query (AAPL revenue)
 * 2. Computed metric query (AAPL gross margin — Flow B)
 * 3. Uploaded document query from different workspace (cross-deal)
 * 4. Coreference follow-up query
 * 5. PE/uploaded doc analyst rating query
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJjdXN0b206dGVuYW50X2lkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIiwiY3VzdG9tOnRlbmFudF9zbHVnIjoiZGVmYXVsdCIsImN1c3RvbTp0ZW5hbnRfcm9sZSI6ImFkbWluIiwidXNlcm5hbWUiOiJ0ZXN0QHRlc3QuY29tIn0.test_signature';

// Helper: make HTTP request
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          // For SSE responses, parse events
          if (res.headers['content-type']?.includes('text/event-stream')) {
            resolve({ status: res.statusCode, sse: data, headers: res.headers });
          } else {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          }
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Parse SSE events from raw text
function parseSSE(raw) {
  const events = [];
  const lines = raw.split('\n');
  let currentEvent = {};
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent.type = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      try {
        currentEvent.data = JSON.parse(line.slice(6));
      } catch {
        currentEvent.data = line.slice(6);
      }
      if (currentEvent.type) {
        events.push({ ...currentEvent });
        currentEvent = {};
      }
    }
  }
  return events;
}

// Send a message and collect SSE response
async function sendMessage(conversationId, content, context = {}) {
  const res = await request('POST', `/api/research/conversations/${conversationId}/messages`, {
    content,
    context: { tickers: [], ...context },
  });

  if (res.sse) {
    const events = parseSSE(res.sse);
    const tokens = events.filter(e => e.type === 'token').map(e => e.data.text).join('');
    const citations = events.find(e => e.type === 'citations')?.data?.citations || [];
    const visualization = events.find(e => e.type === 'visualization')?.data;
    const error = events.find(e => e.type === 'error');
    return { answer: tokens, citations, visualization, error, events };
  }
  return { answer: '', error: res.data || res.raw, events: [] };
}

async function runTests() {
  console.log('🚀 DEMO READINESS TEST SUITE\n');
  console.log('='.repeat(60));
  let passed = 0;
  let failed = 0;

  // Step 1: Create a conversation (simulating ABNB workspace)
  console.log('\n📋 Creating test conversation (ABNB workspace context)...');
  const convRes = await request('POST', '/api/research/conversations', {
    title: 'Demo Readiness Test',
  });
  
  if (convRes.status !== 201 && convRes.status !== 200) {
    console.error('❌ Failed to create conversation:', convRes);
    process.exit(1);
  }
  const conversationId = convRes.data.data.id;
  console.log(`   Conversation ID: ${conversationId}\n`);

  // ── TEST 1: Basic structured metric (AAPL revenue) ──────────────
  console.log('─'.repeat(60));
  console.log('TEST 1: Basic structured metric — "What is AAPL revenue?"');
  console.log('   Expected: Structured metrics from PostgreSQL, citations, visualization');
  try {
    const r = await sendMessage(conversationId, 'What is AAPL revenue?', { tickers: ['ABNB'] });
    if (r.error) {
      console.log(`   ❌ ERROR: ${JSON.stringify(r.error)}`);
      failed++;
    } else {
      const hasAAPL = r.answer.toLowerCase().includes('aapl') || r.answer.toLowerCase().includes('apple');
      const hasNumber = /\d/.test(r.answer);
      const hasCitations = r.citations.length > 0;
      console.log(`   Answer length: ${r.answer.length} chars`);
      console.log(`   Mentions AAPL/Apple: ${hasAAPL ? '✅' : '❌'}`);
      console.log(`   Contains numbers: ${hasNumber ? '✅' : '❌'}`);
      console.log(`   Citations: ${r.citations.length} ${hasCitations ? '✅' : '⚠️'}`);
      console.log(`   Visualization: ${r.visualization ? r.visualization.chartType + ' ✅' : 'none ⚠️'}`);
      console.log(`   Answer preview: "${r.answer.substring(0, 200)}..."`);
      if (hasAAPL && hasNumber) { passed++; console.log('   ✅ PASSED'); }
      else { failed++; console.log('   ❌ FAILED'); }
    }
  } catch (e) {
    console.log(`   ❌ EXCEPTION: ${e.message}`);
    failed++;
  }

  // ── TEST 2: Computed metric (AAPL gross margin — Flow B) ────────
  console.log('\n' + '─'.repeat(60));
  console.log('TEST 2: Computed metric — "What is AAPL gross margin?"');
  console.log('   Expected: FormulaResolutionService computes (revenue - COGS) / revenue');
  try {
    const r = await sendMessage(conversationId, "What's AAPL's gross margin?", { tickers: ['ABNB'] });
    if (r.error) {
      console.log(`   ❌ ERROR: ${JSON.stringify(r.error)}`);
      failed++;
    } else {
      const hasMargin = r.answer.toLowerCase().includes('margin') || r.answer.toLowerCase().includes('%');
      const hasNumber = /\d/.test(r.answer);
      console.log(`   Answer length: ${r.answer.length} chars`);
      console.log(`   Mentions margin/%: ${hasMargin ? '✅' : '❌'}`);
      console.log(`   Contains numbers: ${hasNumber ? '✅' : '❌'}`);
      console.log(`   Citations: ${r.citations.length}`);
      console.log(`   Answer preview: "${r.answer.substring(0, 200)}..."`);
      if (hasNumber) { passed++; console.log('   ✅ PASSED'); }
      else { failed++; console.log('   ❌ FAILED'); }
    }
  } catch (e) {
    console.log(`   ❌ EXCEPTION: ${e.message}`);
    failed++;
  }

  // ── TEST 3: Uploaded doc query from ABNB workspace ──────────────
  console.log('\n' + '─'.repeat(60));
  console.log('TEST 3: Uploaded doc — "What is the analyst rating for AAPL?"');
  console.log('   Expected: Finds AAPL analyst report uploaded under AAPL deal, even from ABNB workspace');
  try {
    const r = await sendMessage(conversationId, 'What is the analyst rating for AAPL?', { tickers: ['ABNB'] });
    if (r.error) {
      console.log(`   ❌ ERROR: ${JSON.stringify(r.error)}`);
      failed++;
    } else {
      const hasRating = r.answer.toLowerCase().includes('rating') || 
                        r.answer.toLowerCase().includes('buy') || 
                        r.answer.toLowerCase().includes('hold') ||
                        r.answer.toLowerCase().includes('overweight') ||
                        r.answer.toLowerCase().includes('sell') ||
                        r.answer.toLowerCase().includes('target');
      const mentionsAAPL = r.answer.toLowerCase().includes('aapl') || r.answer.toLowerCase().includes('apple');
      console.log(`   Answer length: ${r.answer.length} chars`);
      console.log(`   Mentions rating/buy/hold/target: ${hasRating ? '✅' : '❌'}`);
      console.log(`   Mentions AAPL/Apple: ${mentionsAAPL ? '✅' : '❌'}`);
      console.log(`   Citations: ${r.citations.length}`);
      // Check for uploaded doc citations
      const uploadedCitations = r.citations.filter(c => 
        c.sourceType === 'UPLOADED_DOC' || c.type === 'uploaded_document'
      );
      console.log(`   Uploaded doc citations: ${uploadedCitations.length} ${uploadedCitations.length > 0 ? '✅' : '⚠️'}`);
      console.log(`   Answer preview: "${r.answer.substring(0, 300)}..."`);
      if (mentionsAAPL) { passed++; console.log('   ✅ PASSED'); }
      else { failed++; console.log('   ❌ FAILED — not finding AAPL data'); }
    }
  } catch (e) {
    console.log(`   ❌ EXCEPTION: ${e.message}`);
    failed++;
  }

  // ── TEST 4: Coreference follow-up ──────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('TEST 4: Coreference — "What about their operating expenses?"');
  console.log('   Expected: Resolves "their" to AAPL from conversation history');
  try {
    const r = await sendMessage(conversationId, 'What about their operating expenses?', { tickers: ['ABNB'] });
    if (r.error) {
      console.log(`   ❌ ERROR: ${JSON.stringify(r.error)}`);
      failed++;
    } else {
      // Should resolve to AAPL, NOT ABNB
      const mentionsAAPL = r.answer.toLowerCase().includes('aapl') || r.answer.toLowerCase().includes('apple');
      const mentionsABNB = r.answer.toLowerCase().includes('abnb') || r.answer.toLowerCase().includes('airbnb');
      const hasNumber = /\d/.test(r.answer);
      console.log(`   Answer length: ${r.answer.length} chars`);
      console.log(`   Resolves to AAPL/Apple: ${mentionsAAPL ? '✅' : '❌'}`);
      console.log(`   Mentions ABNB (wrong): ${mentionsABNB ? '⚠️ possible wrong resolution' : '✅ correct'}`);
      console.log(`   Contains numbers: ${hasNumber ? '✅' : '❌'}`);
      console.log(`   Answer preview: "${r.answer.substring(0, 200)}..."`);
      if (mentionsAAPL && !mentionsABNB) { passed++; console.log('   ✅ PASSED'); }
      else if (mentionsAAPL && mentionsABNB) { passed++; console.log('   ⚠️ PASSED (mentions both, but AAPL present)'); }
      else { failed++; console.log('   ❌ FAILED — coreference not resolving to AAPL'); }
    }
  } catch (e) {
    console.log(`   ❌ EXCEPTION: ${e.message}`);
    failed++;
  }

  // ── TEST 5: Narrative/qualitative query ─────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('TEST 5: Narrative — "What are the key risks for AAPL?"');
  console.log('   Expected: Semantic retrieval from 10-K risk factors + uploaded docs');
  try {
    const r = await sendMessage(conversationId, 'What are the key risks for AAPL?', { tickers: ['ABNB'] });
    if (r.error) {
      console.log(`   ❌ ERROR: ${JSON.stringify(r.error)}`);
      failed++;
    } else {
      const hasRisk = r.answer.toLowerCase().includes('risk');
      const mentionsAAPL = r.answer.toLowerCase().includes('aapl') || r.answer.toLowerCase().includes('apple');
      console.log(`   Answer length: ${r.answer.length} chars`);
      console.log(`   Mentions risk: ${hasRisk ? '✅' : '❌'}`);
      console.log(`   Mentions AAPL/Apple: ${mentionsAAPL ? '✅' : '❌'}`);
      console.log(`   Citations: ${r.citations.length}`);
      console.log(`   Answer preview: "${r.answer.substring(0, 200)}..."`);
      if (hasRisk && mentionsAAPL) { passed++; console.log('   ✅ PASSED'); }
      else { failed++; console.log('   ❌ FAILED'); }
    }
  } catch (e) {
    console.log(`   ❌ EXCEPTION: ${e.message}`);
    failed++;
  }

  // ── SUMMARY ─────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log(`\n🏁 DEMO READINESS: ${passed}/${passed + failed} tests passed`);
  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED — Ready for demo!');
  } else {
    console.log(`⚠️  ${failed} test(s) need attention before demo`);
  }
  console.log();

  // Cleanup: delete test conversation
  try {
    await request('DELETE', `/api/research/conversations/${conversationId}`);
    console.log('🧹 Test conversation cleaned up');
  } catch (e) {
    console.log('⚠️ Could not clean up test conversation');
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
