/**
 * Reprocess documents: clean up partial enrichment data, then re-trigger
 * the full pipeline (Phase A + Phase B) one document at a time.
 *
 * Usage: node scripts/reprocess-documents.js
 */
require('dotenv').config();
const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL;
const BASE_URL = 'http://localhost:3000';
const TENANT_ID = '00000000-0000-0000-0000-000000000000';

// Craft a minimal JWT that passes decode-only mode
function makeDevToken(tenantId) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'reprocess-script',
    'custom:tenant_id': tenantId,
    'custom:tenant_role': 'admin',
    'custom:tenant_slug': 'default',
    username: 'admin@fundlens.dev',
  })).toString('base64url');
  return `${header}.${payload}.nosig`;
}

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to DB');

  const token = makeDevToken(TENANT_ID);
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // Get all documents
  const { rows: docs } = await client.query(
    `SELECT document_id, file_name, status, processing_mode, chunk_count, 
            tenant_id, deal_id, s3_key, file_type
     FROM intel_documents ORDER BY created_at`
  );

  console.log(`Found ${docs.length} documents to reprocess\n`);

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    console.log(`\n[${i + 1}/${docs.length}] ${doc.file_name} (${doc.document_id})`);
    console.log(`  Current: status=${doc.status}, mode=${doc.processing_mode}, chunks=${doc.chunk_count}`);

    // Step 1: Clean up partial vision extractions (keep headline extractions from Phase A)
    const delVision = await client.query(
      `DELETE FROM intel_document_extractions WHERE document_id = $1::uuid AND source_layer = 'vision'`,
      [doc.document_id]
    );
    console.log(`  Cleaned ${delVision.rowCount} partial vision extractions`);

    // Step 2: Clean up any partial chunks
    try {
      const chunkDel = await client.query(
        `DELETE FROM intel_document_chunks WHERE document_id = $1::uuid`,
        [doc.document_id]
      );
      console.log(`  Cleaned ${chunkDel.rowCount} partial chunks`);
    } catch (e) {
      console.log(`  No chunks to clean`);
    }

    // Step 3: Delete headline extractions too (they'll be re-created)
    await client.query(
      `DELETE FROM intel_document_extractions WHERE document_id = $1::uuid`,
      [doc.document_id]
    );

    // Step 4: Reset document to uploading so upload-complete will re-run full pipeline
    await client.query(
      `UPDATE intel_documents SET
        status = 'uploading',
        processing_mode = NULL,
        chunk_count = 0,
        metric_count = 0,
        raw_text_s3_key = NULL,
        document_type = NULL,
        company_ticker = NULL,
        company_name = NULL,
        page_count = NULL,
        error = NULL,
        retry_count = 0,
        kb_sync_status = 'pending',
        updated_at = NOW()
      WHERE document_id = $1::uuid`,
      [doc.document_id]
    );
    console.log(`  Reset to clean uploading state`);

    // Step 5: Trigger via upload-complete endpoint
    console.log(`  Triggering full pipeline (Phase A + B)...`);
    try {
      const resp = await fetch(`${BASE_URL}/api/documents/${doc.document_id}/upload-complete`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (resp.ok) {
        const result = await resp.json();
        console.log(`  Phase A complete: type=${result.documentType}, company=${result.companyName}, ticker=${result.ticker}`);
        console.log(`  Phase B (enrichment) running in background...`);
      } else {
        const text = await resp.text();
        console.log(`  ❌ API returned ${resp.status}: ${text}`);
        continue;
      }
    } catch (e) {
      console.log(`  ❌ API call failed: ${e.message}`);
      continue;
    }

    // Step 6: Poll for enrichment completion (every 5s, max 4 min)
    let attempts = 0;
    const maxAttempts = 48; // 4 minutes
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 5000));
      const { rows } = await client.query(
        `SELECT status, processing_mode, chunk_count, error FROM intel_documents WHERE document_id = $1::uuid`,
        [doc.document_id]
      );
      const current = rows[0];
      attempts++;

      if (current.processing_mode === 'fully-indexed' && current.chunk_count > 0) {
        console.log(`  ✅ DONE: ${current.chunk_count} chunks indexed, mode=fully-indexed`);
        break;
      }
      if (current.error && current.error.includes('permanently')) {
        console.log(`  ❌ FAILED: ${current.error}`);
        break;
      }
      if (attempts % 4 === 0) {
        console.log(`  ... ${attempts * 5}s elapsed — mode=${current.processing_mode}, chunks=${current.chunk_count}, error=${current.error || 'none'}`);
      }
    }

    if (attempts >= maxAttempts) {
      // Check final state
      const { rows } = await client.query(
        `SELECT status, processing_mode, chunk_count, error FROM intel_documents WHERE document_id = $1::uuid`,
        [doc.document_id]
      );
      const final = rows[0];
      console.log(`  ⚠️ Timed out — final: mode=${final.processing_mode}, chunks=${final.chunk_count}, error=${final.error || 'none'}`);
    }

    // Wait between documents to let GC recover
    if (i < docs.length - 1) {
      console.log(`  Cooling down 10s before next document...`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  // Final status
  console.log('\n\n========== FINAL STATUS ==========');
  const { rows: final } = await client.query(
    `SELECT document_id, file_name, status, processing_mode, chunk_count, metric_count, kb_sync_status, error
     FROM intel_documents ORDER BY created_at`
  );
  for (const d of final) {
    const icon = d.processing_mode === 'fully-indexed' && d.chunk_count > 0 ? '✅' : '⚠️';
    console.log(`${icon} ${d.file_name}`);
    console.log(`   status=${d.status}, mode=${d.processing_mode}, chunks=${d.chunk_count}, metrics=${d.metric_count}, kb=${d.kb_sync_status}`);
    if (d.error) console.log(`   error: ${d.error}`);
  }

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
