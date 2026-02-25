#!/usr/bin/env node
/**
 * Sync existing intel_document_chunks to S3 kb-ready/ prefix for Bedrock KB ingestion.
 * This fills the gap where enrichDocument's prepareKBChunks didn't run.
 */
const { Client } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const DB_URL = 'postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db?sslmode=no-verify';
const BUCKET = process.env.S3_BUCKET_NAME || 'fundlens-documents-dev';
const REGION = 'us-east-1';

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const s3 = new S3Client({ region: REGION });

  // Get all documents
  const docs = await db.query(`
    SELECT d.document_id, d.tenant_id, d.deal_id, d.file_name, d.document_type, d.company_ticker
    FROM intel_documents d
    WHERE d.status = 'queryable'
    ORDER BY d.created_at
  `);

  console.log(`Found ${docs.rows.length} queryable documents`);

  for (const doc of docs.rows) {
    console.log(`\n--- ${doc.file_name} (${doc.document_id}) ---`);

    // Get chunks for this document
    const chunks = await db.query(`
      SELECT chunk_index, content, section_type, page_number, token_estimate
      FROM intel_document_chunks
      WHERE document_id = $1
      ORDER BY chunk_index
    `, [doc.document_id]);

    console.log(`  ${chunks.rows.length} chunks to sync`);

    const safeName = (doc.file_name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
    let uploaded = 0;

    for (const chunk of chunks.rows) {
      const chunkKey = `kb-ready/${doc.tenant_id}/${doc.deal_id}/uploads/${safeName}_chunk_${String(chunk.chunk_index + 1).padStart(3, '0')}.json`;

      const payload = {
        content: chunk.content,
        metadata: {
          tenant_id: doc.tenant_id,
          deal_id: doc.deal_id,
          document_id: doc.document_id,
          document_type: doc.document_type || 'generic',
          source: 'upload',
          company_ticker: doc.company_ticker || '',
          file_name: doc.file_name || '',
          section_type: chunk.section_type || 'general',
          page_number: chunk.page_number || null,
          chunk_index: chunk.chunk_index,
          total_chunks: chunks.rows.length,
        },
      };

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: chunkKey,
        Body: JSON.stringify(payload),
        ContentType: 'application/json',
      }));
      uploaded++;
    }

    console.log(`  ✅ Uploaded ${uploaded} chunks to s3://${BUCKET}/kb-ready/...`);

    // Update kb_sync_status
    await db.query(
      `UPDATE intel_documents SET kb_sync_status = 'prepared', updated_at = NOW() WHERE document_id = $1`,
      [doc.document_id],
    );
    console.log(`  ✅ kb_sync_status = 'prepared'`);
  }

  await db.end();
  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });
