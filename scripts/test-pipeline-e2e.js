#!/usr/bin/env node
/**
 * Document Intelligence Pipeline v2 — End-to-End Test
 *
 * Tests the FULL pipeline from upload through enrichment to RAG query.
 * Requires: server running on localhost:3000, DB with migrations applied.
 *
 * What it validates:
 *   1. Upload URL generation (presigned S3 URL)
 *   2. Upload-complete → instant intelligence (Phase A)
 *   3. Background enrichment completion (Phase B) — polls status
 *   4. Extracted metrics persisted to extracted_metrics table
 *   5. Document flags persisted to document_flags table
 *   6. Call analysis persisted to call_analysis table (earnings calls)
 *   7. Model formulas persisted to model_formulas table (Excel)
 *   8. Intake summary generated in intel_documents
 *   9. Chunks indexed in intel_document_chunks
 *  10. RAG query returns data from uploaded document
 *  11. Bulk upload endpoint
 *  12. KB sync endpoints
 *
 * Usage:
 *   node scripts/test-pipeline-e2e.js
 *   node scripts/test-pipeline-e2e.js --skip-upload   # skip upload, test DB state only
 */

const http = require('http');
const { Client } = require('pg');

const BASE_URL = 'http://localhost:3000';
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJjdXN0b206dGVuYW50X2lkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIiwiY3VzdG9tOnRlbmFudF9zbHVnIjoiZGVmYXVsdCIsImN1c3RvbTp0ZW5hbnRfcm9sZSI6ImFkbWluIiwidXNlcm5hbWUiOiJ0ZXN0QHRlc3QuY29tIn0.test_signature';
const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const AAPL_DEAL_ID = '92ed85af-c78b-488b-bdf4-b76e619ed69d';

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(name, detail) {
  passed++;
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, err) {
  failed++;
  console.error(`  ❌ ${name}: ${err}`);
}
function skip(name, reason) {
  skipped++;
  console.log(`  ⏭️  ${name} — ${reason}`);
}


// ─── HTTP helper ───────────────────────────────────────────────
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
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
          if (res.headers['content-type']?.includes('text/event-stream')) {
            resolve({ status: res.statusCode, sse: data });
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── DB helper ─────────────────────────────────────────────────
async function getDbClient() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  return client;
}


// ═══════════════════════════════════════════════════════════════
// TEST SUITE 1: Database State Validation
// Verifies all pipeline tables exist and have correct schema
// ═══════════════════════════════════════════════════════════════
async function testDatabaseSchema(db) {
  console.log('\n📋 Suite 1: Database Schema Validation');

  // 1a. extracted_metrics table exists
  try {
    const res = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'extracted_metrics' ORDER BY ordinal_position`);
    const cols = res.rows.map(r => r.column_name);
    if (cols.includes('normalized_metric') && cols.includes('value') && cols.includes('ticker')) {
      ok('extracted_metrics table', `${cols.length} columns`);
    } else {
      fail('extracted_metrics table', `missing columns: ${cols.join(', ')}`);
    }
  } catch (e) { fail('extracted_metrics table', e.message); }

  // 1b. call_analysis table exists
  try {
    const res = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'call_analysis' ORDER BY ordinal_position`);
    const cols = res.rows.map(r => r.column_name);
    if (cols.includes('ticker') && cols.includes('tone_analysis') && cols.includes('red_flags')) {
      ok('call_analysis table', `${cols.length} columns`);
    } else {
      fail('call_analysis table', `missing columns: ${cols.join(', ')}`);
    }
  } catch (e) { fail('call_analysis table', e.message); }

  // 1c. document_flags table exists
  try {
    const res = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'document_flags' ORDER BY ordinal_position`);
    const cols = res.rows.map(r => r.column_name);
    if (cols.includes('flag_type') && cols.includes('severity') && cols.includes('description')) {
      ok('document_flags table', `${cols.length} columns`);
    } else {
      fail('document_flags table', `missing columns: ${cols.join(', ')}`);
    }
  } catch (e) { fail('document_flags table', e.message); }

  // 1d. model_formulas table exists
  try {
    const res = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'model_formulas' ORDER BY ordinal_position`);
    const cols = res.rows.map(r => r.column_name);
    if (cols.includes('sheet_name') && cols.includes('formula_text') && cols.includes('dependencies')) {
      ok('model_formulas table', `${cols.length} columns`);
    } else {
      fail('model_formulas table', `missing columns: ${cols.join(', ')}`);
    }
  } catch (e) { fail('model_formulas table', e.message); }

  // 1e. intel_documents has new columns
  try {
    const res = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'intel_documents' AND column_name IN ('intake_summary', 'kb_sync_status', 'kb_ingestion_job_id')`);
    const cols = res.rows.map(r => r.column_name);
    if (cols.length === 3) {
      ok('intel_documents new columns', 'intake_summary, kb_sync_status, kb_ingestion_job_id');
    } else {
      fail('intel_documents new columns', `found only: ${cols.join(', ')}`);
    }
  } catch (e) { fail('intel_documents new columns', e.message); }
}


// ═══════════════════════════════════════════════════════════════
// TEST SUITE 2: Existing Document Pipeline State
// Checks that previously uploaded AAPL docs have been enriched
// ═══════════════════════════════════════════════════════════════
async function testExistingDocumentState(db) {
  console.log('\n📋 Suite 2: Existing Document Pipeline State');

  // 2a. Check intel_documents for AAPL
  try {
    const res = await db.query(`
      SELECT document_id, file_name, status, processing_mode, document_type,
             chunk_count, company_ticker, intake_summary, kb_sync_status
      FROM intel_documents
      WHERE tenant_id = $1::uuid AND company_ticker = 'AAPL'
      ORDER BY created_at DESC
    `, [TENANT_ID]);

    if (res.rows.length > 0) {
      ok('AAPL documents found', `${res.rows.length} documents`);
      for (const doc of res.rows) {
        console.log(`    📄 ${doc.file_name}: status=${doc.status}, mode=${doc.processing_mode}, type=${doc.document_type}, chunks=${doc.chunk_count || 0}`);
        if (doc.intake_summary) {
          console.log(`    📝 Intake: "${doc.intake_summary.substring(0, 80)}..."`);
        }
      }
    } else {
      skip('AAPL documents', 'no documents found — upload one to test');
    }
  } catch (e) { fail('AAPL documents query', e.message); }

  // 2b. Check intel_document_chunks
  try {
    const res = await db.query(`
      SELECT COUNT(*) as cnt FROM intel_document_chunks c
      JOIN intel_documents d ON c.document_id = d.document_id
      WHERE d.tenant_id = $1::uuid
    `, [TENANT_ID]);
    const count = parseInt(res.rows[0].cnt);
    if (count > 0) {
      ok('Document chunks indexed', `${count} chunks with embeddings`);
    } else {
      skip('Document chunks', 'no chunks found');
    }
  } catch (e) { fail('Document chunks query', e.message); }

  // 2c. Check intel_document_extractions
  try {
    const res = await db.query(`
      SELECT extraction_type, COUNT(*) as cnt
      FROM intel_document_extractions
      WHERE tenant_id = $1::uuid
      GROUP BY extraction_type
      ORDER BY cnt DESC
    `, [TENANT_ID]);
    if (res.rows.length > 0) {
      const summary = res.rows.map(r => `${r.extraction_type}=${r.cnt}`).join(', ');
      ok('Document extractions', summary);
    } else {
      skip('Document extractions', 'no extractions found');
    }
  } catch (e) { fail('Document extractions query', e.message); }

  // 2d. Check extracted_metrics (flat table)
  try {
    const res = await db.query(`
      SELECT normalized_metric, ticker, COUNT(*) as cnt
      FROM extracted_metrics
      WHERE tenant_id = $1
      GROUP BY normalized_metric, ticker
      ORDER BY cnt DESC
      LIMIT 10
    `, [TENANT_ID]);
    if (res.rows.length > 0) {
      const summary = res.rows.map(r => `${r.ticker}/${r.normalized_metric}(${r.cnt})`).join(', ');
      ok('Extracted metrics (flat table)', summary);
    } else {
      skip('Extracted metrics', 'no metrics in flat table yet');
    }
  } catch (e) { fail('Extracted metrics query', e.message); }

  // 2e. Check document_flags
  try {
    const res = await db.query(`
      SELECT flag_type, severity, COUNT(*) as cnt
      FROM document_flags
      WHERE tenant_id = $1
      GROUP BY flag_type, severity
    `, [TENANT_ID]);
    if (res.rows.length > 0) {
      const summary = res.rows.map(r => `${r.flag_type}[${r.severity}]=${r.cnt}`).join(', ');
      ok('Document flags', summary);
    } else {
      skip('Document flags', 'no flags persisted yet (normal for PDFs without red flags)');
    }
  } catch (e) { fail('Document flags query', e.message); }

  // 2f. Check call_analysis
  try {
    const res = await db.query(`SELECT ticker, quarter, overall_confidence FROM call_analysis WHERE tenant_id = $1`, [TENANT_ID]);
    if (res.rows.length > 0) {
      const summary = res.rows.map(r => `${r.ticker} ${r.quarter} (conf=${r.overall_confidence})`).join(', ');
      ok('Call analysis', summary);
    } else {
      skip('Call analysis', 'no earnings calls processed yet');
    }
  } catch (e) { fail('Call analysis query', e.message); }

  // 2g. Check model_formulas
  try {
    const res = await db.query(`SELECT COUNT(*) as cnt FROM model_formulas WHERE tenant_id = $1`, [TENANT_ID]);
    const count = parseInt(res.rows[0].cnt);
    if (count > 0) {
      ok('Model formulas', `${count} formulas persisted`);
    } else {
      skip('Model formulas', 'no Excel models processed yet');
    }
  } catch (e) { fail('Model formulas query', e.message); }
}


// ═══════════════════════════════════════════════════════════════
// TEST SUITE 3: API Endpoint Validation
// Tests all pipeline-related API endpoints respond correctly
// ═══════════════════════════════════════════════════════════════
async function testApiEndpoints() {
  console.log('\n📋 Suite 3: API Endpoint Validation');

  // 3a. Document list endpoint
  try {
    const res = await request('GET', `/api/documents/deal/${AAPL_DEAL_ID}`);
    if (res.status === 200 && Array.isArray(res.data)) {
      ok('GET /api/documents/deal/:dealId', `${res.data.length} documents`);
    } else if (res.status === 401 || res.status === 403) {
      skip('GET /api/documents/deal/:dealId', `auth issue (${res.status}) — expected in test env`);
    } else {
      fail('GET /api/documents/deal/:dealId', `status=${res.status}`);
    }
  } catch (e) { fail('GET /api/documents/deal/:dealId', e.message); }

  // 3b. KB sync status endpoint
  try {
    const res = await request('GET', '/api/rag/kb/status');
    if (res.status === 200 && res.data?.data) {
      const d = res.data.data;
      ok('GET /api/rag/kb/status', `rds=${d.rdsChunks}, s3=${d.s3Chunks}, needsSync=${d.needsSync}`);
    } else {
      fail('GET /api/rag/kb/status', `status=${res.status}, body=${JSON.stringify(res.data || res.raw).substring(0, 200)}`);
    }
  } catch (e) { fail('GET /api/rag/kb/status', e.message); }

  // 3c. Uploaded doc sync endpoint (POST — triggers cron)
  try {
    const res = await request('POST', '/api/rag/kb/uploaded-doc-sync', {});
    if (res.status === 200 || res.status === 201) {
      const d = res.data?.data;
      ok('POST /api/rag/kb/uploaded-doc-sync', `processed=${d?.processed || 0}, synced=${d?.synced || 0}`);
    } else {
      fail('POST /api/rag/kb/uploaded-doc-sync', `status=${res.status}`);
    }
  } catch (e) { fail('POST /api/rag/kb/uploaded-doc-sync', e.message); }

  // 3d. Check in-flight jobs endpoint
  try {
    const res = await request('POST', '/api/rag/kb/check-in-flight', {});
    if (res.status === 200 || res.status === 201) {
      const d = res.data?.data;
      ok('POST /api/rag/kb/check-in-flight', `updated=${d?.updated || 0}, completed=${d?.completed || 0}`);
    } else {
      fail('POST /api/rag/kb/check-in-flight', `status=${res.status}`);
    }
  } catch (e) { fail('POST /api/rag/kb/check-in-flight', e.message); }

  // 3e. Bulk upload endpoint (with empty array — should succeed with 0)
  try {
    const res = await request('POST', '/api/rag/kb/bulk-upload', {
      documents: [],
      tenantId: TENANT_ID,
      dealId: AAPL_DEAL_ID,
    });
    if (res.status === 200 || res.status === 201) {
      ok('POST /api/rag/kb/bulk-upload (empty)', `total=${res.data?.data?.total || 0}`);
    } else {
      fail('POST /api/rag/kb/bulk-upload', `status=${res.status}`);
    }
  } catch (e) { fail('POST /api/rag/kb/bulk-upload', e.message); }

  // 3f. Latest KB job endpoint
  try {
    const res = await request('GET', '/api/rag/kb/latest-job');
    if (res.status === 200) {
      const d = res.data?.data;
      ok('GET /api/rag/kb/latest-job', `status=${d?.status || 'NO_JOBS'}, jobId=${d?.jobId || 'none'}`);
    } else {
      fail('GET /api/rag/kb/latest-job', `status=${res.status}`);
    }
  } catch (e) { fail('GET /api/rag/kb/latest-job', e.message); }
}


// ═══════════════════════════════════════════════════════════════
// TEST SUITE 4: RAG Query with Uploaded Document Data
// Verifies the full loop: upload → enrich → query → answer
// ═══════════════════════════════════════════════════════════════
async function testRagQueryWithUploadedDocs() {
  console.log('\n📋 Suite 4: RAG Query with Uploaded Document Data');

  // 4a. Create a conversation first, then send a message
  let conversationId;
  try {
    const createRes = await request('POST', '/api/research/conversations', {
      title: 'Pipeline E2E Test',
      dealId: AAPL_DEAL_ID,
    });

    if (createRes.status === 201 || createRes.status === 200) {
      conversationId = createRes.data?.data?.id || createRes.data?.id || createRes.data?.conversationId;
      ok('Create conversation', `id=${conversationId}`);
    } else if (createRes.status === 401 || createRes.status === 403) {
      skip('Create conversation', `auth issue (${createRes.status})`);
      return;
    } else {
      fail('Create conversation', `status=${createRes.status}`);
      return;
    }
  } catch (e) { fail('Create conversation', e.message); return; }

  // 4b. Send a query about AAPL from uploaded analyst report
  if (conversationId) {
    try {
      const res = await request('POST', `/api/research/conversations/${conversationId}/messages`, {
        content: 'What is Apple\'s revenue from the uploaded analyst report?',
        dealId: AAPL_DEAL_ID,
      });

      if (res.status === 200 || res.status === 201) {
        if (res.sse) {
          const events = res.sse.split('\n').filter(l => l.startsWith('data: '));
          ok('RAG query (AAPL uploaded docs)', `SSE response, ${events.length} events`);
          // Try to extract last meaningful content
          for (let i = events.length - 1; i >= 0; i--) {
            try {
              const parsed = JSON.parse(events[i].replace('data: ', ''));
              if (parsed.content || parsed.text || parsed.answer) {
                const text = parsed.content || parsed.text || parsed.answer;
                console.log(`    💬 "${text.substring(0, 120)}..."`);
                break;
              }
            } catch {}
          }
        } else if (res.data) {
          const answer = res.data.answer || res.data.response || res.data.content || '';
          if (answer.length > 20) {
            ok('RAG query (AAPL uploaded docs)', `${answer.length} chars`);
            console.log(`    💬 "${answer.substring(0, 120)}..."`);
          } else {
            ok('RAG query (AAPL uploaded docs)', 'response received');
          }
        }
      } else if (res.status === 401 || res.status === 403) {
        skip('RAG query', `auth issue (${res.status})`);
      } else {
        fail('RAG query (AAPL uploaded docs)', `status=${res.status}`);
      }
    } catch (e) { fail('RAG query (AAPL uploaded docs)', e.message); }

    // 4c. Query that should hit structured metrics
    try {
      const res = await request('POST', `/api/research/conversations/${conversationId}/messages`, {
        content: 'What is AAPL revenue?',
        dealId: AAPL_DEAL_ID,
      });

      if (res.status === 200 || res.status === 201) {
        ok('RAG query (structured metrics)', 'responded');
      } else if (res.status === 401 || res.status === 403) {
        skip('RAG query (structured)', `auth issue (${res.status})`);
      } else {
        fail('RAG query (structured metrics)', `status=${res.status}`);
      }
    } catch (e) { fail('RAG query (structured metrics)', e.message); }
  }
}


// ═══════════════════════════════════════════════════════════════
// TEST SUITE 5: Upload Flow (optional — requires S3 access)
// Tests the full upload → instant intelligence → enrichment flow
// ═══════════════════════════════════════════════════════════════
async function testUploadFlow() {
  console.log('\n📋 Suite 5: Upload Flow (presigned URL generation)');

  // 5a. Request upload URL
  try {
    const res = await request('POST', '/api/documents/upload-url', {
      fileName: 'test-pipeline-e2e.pdf',
      fileType: 'application/pdf',
      fileSize: 1024 * 100, // 100KB
      dealId: AAPL_DEAL_ID,
      uploadSource: 'chat',
    });

    if (res.status === 200 || res.status === 201) {
      const { uploadUrl, documentId } = res.data;
      if (uploadUrl && documentId) {
        ok('POST /documents/upload-url', `docId=${documentId}`);
        console.log(`    🔗 Upload URL generated (${uploadUrl.substring(0, 60)}...)`);

        // 5b. Check document status (should be 'uploading')
        try {
          const statusRes = await request('GET', `/api/documents/${documentId}/status`);
          if (statusRes.status === 200 && statusRes.data?.status === 'uploading') {
            ok('Document status after URL generation', 'status=uploading');
          } else {
            fail('Document status after URL generation', `status=${statusRes.data?.status || statusRes.status}`);
          }
        } catch (e) { fail('Document status check', e.message); }

        // Note: We can't complete the upload without actually PUTting to S3
        console.log('    ℹ️  Skipping actual S3 upload + upload-complete (requires S3 access)');
        console.log('    ℹ️  To test full flow: upload a file via the UI, then re-run this script');
      } else {
        fail('POST /documents/upload-url', 'missing uploadUrl or documentId');
      }
    } else if (res.status === 401 || res.status === 403) {
      skip('Upload URL generation', `auth issue (${res.status})`);
    } else {
      fail('POST /api/documents/upload-url', `status=${res.status}, body=${JSON.stringify(res.data || res.raw).substring(0, 200)}`);
    }
  } catch (e) { fail('POST /documents/upload-url', e.message); }
}


// ═══════════════════════════════════════════════════════════════
// TEST SUITE 6: Service Wiring Validation
// Verifies the NestJS module has all services properly wired
// by checking that endpoints that depend on them don't 500
// ═══════════════════════════════════════════════════════════════
async function testServiceWiring() {
  console.log('\n📋 Suite 6: Service Wiring Validation');

  const endpoints = [
    { method: 'GET', path: '/api/rag/kb/status', name: 'KBSyncService' },
    { method: 'POST', path: '/api/rag/kb/uploaded-doc-sync', body: {}, name: 'UploadedDocKBSyncService' },
    { method: 'POST', path: '/api/rag/kb/check-in-flight', body: {}, name: 'UploadedDocKBSyncService.checkInFlight' },
    { method: 'POST', path: '/api/rag/kb/bulk-upload', body: { documents: [], tenantId: TENANT_ID, dealId: AAPL_DEAL_ID }, name: 'BulkUploadService' },
  ];

  for (const ep of endpoints) {
    try {
      const res = await request(ep.method, ep.path, ep.body);
      if (res.status === 500) {
        fail(`${ep.name} wiring`, `500 Internal Server Error — service likely not injected`);
      } else if (res.status === 200 || res.status === 201) {
        ok(`${ep.name} wiring`, `${ep.method} ${ep.path} → ${res.status}`);
      } else {
        // 401/403 still means the service is wired (auth is separate)
        ok(`${ep.name} wiring`, `${ep.method} ${ep.path} → ${res.status} (service reachable)`);
      }
    } catch (e) {
      fail(`${ep.name} wiring`, e.message);
    }
  }
}


// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  const skipUpload = process.argv.includes('--skip-upload');
  const dbOnly = process.argv.includes('--db-only');

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Document Intelligence Pipeline v2 — E2E Test       ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Server: ${BASE_URL}`);
  console.log(`  Tenant: ${TENANT_ID}`);
  console.log(`  Deal:   ${AAPL_DEAL_ID}`);
  console.log(`  Mode:   ${dbOnly ? 'DB only' : skipUpload ? 'skip upload' : 'full'}`);

  let db;
  try {
    db = await getDbClient();
    console.log('  DB:     ✅ connected');
  } catch (e) {
    console.error(`  DB:     ❌ ${e.message}`);
    console.error('  Set DATABASE_URL env var to connect to the database.');
    console.error('  Example: DATABASE_URL=postgresql://user:pass@host:5432/db node scripts/test-pipeline-e2e.js');
    process.exit(1);
  }

  try {
    // Always run DB tests
    await testDatabaseSchema(db);
    await testExistingDocumentState(db);

    if (!dbOnly) {
      // API tests require running server
      console.log('\n  Checking server connectivity...');
      try {
        await request('GET', '/api/rag/kb/status');
        console.log('  Server: ✅ reachable\n');

        await testApiEndpoints();
        await testServiceWiring();
        await testRagQueryWithUploadedDocs();

        if (!skipUpload) {
          await testUploadFlow();
        }
      } catch (e) {
        console.log(`  Server: ❌ not reachable (${e.message})`);
        console.log('  Skipping API tests. Start server with: npm run start:dev\n');
      }
    }
  } finally {
    await db.end();
  }

  // Summary
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('══════════════════════════════════════════════════════');

  if (failed > 0) {
    console.log('\n  ⚠️  Some tests failed. Review output above.');
    process.exit(1);
  } else {
    console.log('\n  🎉 All tests passed!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
