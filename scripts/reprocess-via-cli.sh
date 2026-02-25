#!/bin/bash
# Reprocess documents using AWS CLI for embeddings (no SDK memory overhead)
# Avoids OOM by spawning fresh aws cli process per embedding call.
set -e

# Extract env vars using node (safe for .env with special chars)
eval $(node -e "
require('dotenv').config();
console.log('export DATABASE_URL_CLEAN=\"' + process.env.DATABASE_URL.split('?')[0] + '\"');
console.log('export AWS_REGION=\"' + (process.env.AWS_REGION || 'us-east-1') + '\"');
console.log('export S3_BUCKET=\"' + (process.env.S3_BUCKET_NAME || 'fundlens-documents-dev') + '\"');
")

echo "=== Document Reprocessor (CLI-based) ==="
echo "Region: $AWS_REGION, Bucket: $S3_BUCKET"

# First handle Doc 2 which needs text extraction
echo ""
echo "--- Checking for docs needing text extraction ---"
node --max-old-space-size=256 -e "
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: '$DATABASE_URL_CLEAN', ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(\"SELECT document_id, file_name, raw_text_s3_key, s3_key, tenant_id, deal_id FROM intel_documents WHERE raw_text_s3_key IS NULL AND s3_key IS NOT NULL\");
  if (r.rows.length === 0) { console.log('All docs have raw text.'); await c.end(); return; }
  for (const doc of r.rows) {
    console.log('Doc ' + doc.document_id + ' (' + doc.file_name + ') needs text extraction.');
    console.log('  Will extract via PyPDF2...');
  }
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
"

# Extract text for Doc 2 using a tiny Python script (no boto3 SDK overhead — uses aws cli)
echo ""
echo "--- Extracting text for docs without raw_text ---"
node --max-old-space-size=256 -e "
const { Client } = require('pg');
const { execSync } = require('child_process');
const fs = require('fs');
(async () => {
  const c = new Client({ connectionString: '$DATABASE_URL_CLEAN', ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(\"SELECT document_id, file_name, s3_key, tenant_id, deal_id FROM intel_documents WHERE raw_text_s3_key IS NULL AND s3_key IS NOT NULL\");
  for (const doc of r.rows) {
    console.log('Extracting: ' + doc.file_name);
    // Download PDF via aws cli
    execSync('aws s3 cp s3://$S3_BUCKET/' + doc.s3_key + ' /tmp/doc.pdf --region $AWS_REGION', { stdio: 'pipe' });
    // Extract text via Python helper script
    const text = execSync('python3 scripts/extract_pdf_text.py /tmp/doc.pdf', { maxBuffer: 50*1024*1024 }).toString();
    console.log('  Extracted ' + text.length + ' chars');
    // Upload raw text via aws cli
    const rawKey = 'extracted/' + doc.tenant_id + '/' + doc.deal_id + '/' + doc.document_id + '/raw_text.txt';
    fs.writeFileSync('/tmp/raw_text.txt', text);
    execSync('aws s3 cp /tmp/raw_text.txt s3://$S3_BUCKET/' + rawKey + ' --content-type text/plain --region $AWS_REGION', { stdio: 'pipe' });
    // Update DB
    await c.query('UPDATE intel_documents SET raw_text_s3_key = \$1, status = \$2, processing_mode = \$3, page_count = \$4, updated_at = NOW() WHERE document_id = \$5::uuid',
      [rawKey, 'queryable', 'long-context-fallback', Math.max(1, Math.ceil(text.length / 3000)), doc.document_id]);
    console.log('  ✅ Stored raw text to S3');
    fs.unlinkSync('/tmp/doc.pdf');
    fs.unlinkSync('/tmp/raw_text.txt');
  }
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
"

# Now process all docs: chunk + embed + index
echo ""
echo "--- Chunking + Embedding + Indexing ---"
node --max-old-space-size=256 -e "
const { Client } = require('pg');
const { execSync } = require('child_process');
const fs = require('fs');

function chunkText(text) {
  const maxChars = 2400, overlap = 100, chunks = [];
  let idx = 0, start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const seg = text.substring(start, end);
      const bp = Math.max(seg.lastIndexOf('. '), seg.lastIndexOf('\\n'));
      if (bp > maxChars * 0.5) end = start + bp + 1;
    }
    const content = text.substring(start, end).trim();
    if (content.length > 50) chunks.push({ idx: idx++, content });
    start = end - overlap;
    if (start >= text.length) break;
  }
  return chunks;
}

function getEmbedding(text) {
  const payload = JSON.stringify({ inputText: text.substring(0, 8000), dimensions: 1024, normalize: true });
  fs.writeFileSync('/tmp/emb_in.json', payload);
  execSync('aws bedrock-runtime invoke-model --model-id amazon.titan-embed-text-v2:0 --content-type application/json --accept application/json --region $AWS_REGION --body file:///tmp/emb_in.json /tmp/emb_out.json', { stdio: 'pipe' });
  const result = JSON.parse(fs.readFileSync('/tmp/emb_out.json', 'utf-8'));
  return result.embedding;
}

(async () => {
  const c = new Client({ connectionString: '$DATABASE_URL_CLEAN', ssl: { rejectUnauthorized: false } });
  await c.connect();
  const docs = (await c.query('SELECT document_id, file_name, tenant_id, deal_id, raw_text_s3_key FROM intel_documents WHERE raw_text_s3_key IS NOT NULL ORDER BY created_at')).rows;
  console.log('Processing ' + docs.length + ' documents');

  for (const doc of docs) {
    console.log('\\n=== ' + doc.file_name + ' ===');
    // Get raw text via aws cli
    execSync('aws s3 cp s3://$S3_BUCKET/' + doc.raw_text_s3_key + ' /tmp/raw.txt --region $AWS_REGION', { stdio: 'pipe' });
    const rawText = fs.readFileSync('/tmp/raw.txt', 'utf-8');
    console.log('  ' + rawText.length + ' chars');

    // Clear old chunks
    await c.query('DELETE FROM intel_document_chunks WHERE document_id = \$1::uuid', [doc.document_id]);

    // Chunk
    const chunks = chunkText(rawText);
    console.log('  ' + chunks.length + ' chunks');

    // Embed + insert one at a time
    let indexed = 0;
    for (let i = 0; i < chunks.length; i++) {
      try {
        const emb = getEmbedding(chunks[i].content);
        const embStr = '[' + emb.join(',') + ']';
        await c.query(
          'INSERT INTO intel_document_chunks (id, document_id, tenant_id, deal_id, chunk_index, content, section_type, token_estimate, embedding, created_at) VALUES (gen_random_uuid(), \$1::uuid, \$2::uuid, \$3::uuid, \$4, \$5, \$6, \$7, \$8::vector, NOW())',
          [doc.document_id, doc.tenant_id, doc.deal_id, chunks[i].idx, chunks[i].content, 'narrative', Math.ceil(chunks[i].content.length / 4), embStr]
        );
        indexed++;
        if ((i+1) % 3 === 0 || i === chunks.length - 1) console.log('  Indexed ' + indexed + '/' + chunks.length);
      } catch (e) {
        console.log('  ⚠️ Chunk ' + i + ': ' + e.message);
      }
    }

    await c.query('UPDATE intel_documents SET processing_mode = \$1, chunk_count = \$2, status = \$3, error = NULL, updated_at = NOW() WHERE document_id = \$4::uuid',
      ['fully-indexed', indexed, 'queryable', doc.document_id]);
    console.log('  ✅ ' + indexed + ' chunks indexed');
  }

  // Final
  console.log('\\n========== FINAL STATUS ==========');
  const f = await c.query('SELECT file_name, status, processing_mode, chunk_count FROM intel_documents ORDER BY created_at');
  for (const r of f.rows) {
    const icon = r.processing_mode === 'fully-indexed' && r.chunk_count > 0 ? '✅' : '⚠️';
    console.log(icon + ' ' + r.file_name + ': status=' + r.status + ', mode=' + r.processing_mode + ', chunks=' + r.chunk_count);
  }
  const cc = await c.query('SELECT COUNT(*) FROM intel_document_chunks');
  console.log('Total chunks: ' + cc.rows[0].count);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
"

echo ""
echo "=== DONE ==="
