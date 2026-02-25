#!/usr/bin/env node
/**
 * Minimal document reprocessor — processes one chunk at a time.
 * Uses raw pg + AWS SDK only. No NestJS, no heavy deps.
 */
const { Client } = require('pg');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL.split('?')[0];
const region = process.env.AWS_REGION || 'us-east-1';
const bucket = process.env.S3_BUCKET_NAME || 'fundlens-documents-dev';

const bedrock = new BedrockRuntimeClient({ region });
const s3 = new S3Client({ region });

async function getS3Text(key) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const resp = await s3.send(cmd);
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function getS3Buffer(key) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const resp = await s3.send(cmd);
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function embed(text) {
  const cmd = new InvokeModelCommand({
    modelId: 'amazon.titan-embed-text-v2:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputText: text.substring(0, 8000), dimensions: 1024, normalize: true }),
  });
  const resp = await bedrock.send(cmd);
  const body = JSON.parse(new TextDecoder().decode(resp.body));
  return body.embedding;
}

function chunkText(text, maxChars = 2400, overlap = 100) {
  const chunks = [];
  let idx = 0, start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const seg = text.substring(start, end);
      const bp = Math.max(seg.lastIndexOf('. '), seg.lastIndexOf('\n'));
      if (bp > maxChars * 0.5) end = start + bp + 1;
    }
    const content = text.substring(start, end).trim();
    if (content.length > 50) {
      chunks.push({ idx: idx++, content, section: 'narrative' });
    }
    start = end - overlap;
    if (start >= text.length) break;
  }
  return chunks;
}

async function extractPdfText(buffer) {
  // Use pdf-parse v2 class API
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text || '';
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to RDS');

  const { rows: docs } = await client.query(
    `SELECT document_id, file_name, status, processing_mode, chunk_count,
            tenant_id, deal_id, raw_text_s3_key, s3_key, file_type, document_type
     FROM intel_documents ORDER BY created_at`
  );
  console.log(`Found ${docs.length} documents\n`);

  for (const doc of docs) {
    const docId = doc.document_id;
    console.log(`=== ${doc.file_name} (${docId}) ===`);
    console.log(`  status=${doc.status}, mode=${doc.processing_mode}, chunks=${doc.chunk_count}`);

    // Step 1: Get raw text
    let rawText = '';
    if (doc.raw_text_s3_key) {
      console.log('  Reading raw text from S3...');
      rawText = await getS3Text(doc.raw_text_s3_key);
    } else if (doc.s3_key) {
      console.log('  Extracting text from PDF...');
      const buf = await getS3Buffer(doc.s3_key);
      rawText = await extractPdfText(buf);
      // Store raw text to S3
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      const rawKey = `extracted/${doc.tenant_id}/${doc.deal_id}/${docId}/raw_text.txt`;
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: rawKey,
        Body: Buffer.from(rawText, 'utf-8'), ContentType: 'text/plain',
      }));
      await client.query(
        `UPDATE intel_documents SET raw_text_s3_key = $1, status = 'queryable',
         processing_mode = 'long-context-fallback', page_count = $2, updated_at = NOW()
         WHERE document_id = $3::uuid`,
        [rawKey, Math.max(1, Math.ceil(rawText.length / 3000)), docId]
      );
      console.log(`  Extracted ${rawText.length} chars, stored to S3`);
    } else {
      console.log('  ❌ No text source, skipping');
      continue;
    }

    if (rawText.length < 100) {
      console.log('  ⚠️ Text too short, skipping');
      continue;
    }
    console.log(`  Raw text: ${rawText.length} chars`);

    // Step 2: Clear existing chunks
    await client.query('DELETE FROM intel_document_chunks WHERE document_id = $1::uuid', [docId]);

    // Step 3: Chunk
    const chunks = chunkText(rawText);
    console.log(`  Created ${chunks.length} chunks`);

    // Step 4: Embed + index one at a time
    let indexed = 0;
    for (let i = 0; i < chunks.length; i++) {
      try {
        const emb = await embed(chunks[i].content);
        const embStr = '[' + emb.join(',') + ']';
        await client.query(
          `INSERT INTO intel_document_chunks
           (id, document_id, tenant_id, deal_id, chunk_index, content, section_type, token_estimate, embedding, created_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::vector, NOW())`,
          [docId, doc.tenant_id, doc.deal_id, chunks[i].idx, chunks[i].content, chunks[i].section,
           Math.ceil(chunks[i].content.length / 4), embStr]
        );
        indexed++;
        if ((i + 1) % 5 === 0 || i === chunks.length - 1) {
          console.log(`  Indexed ${indexed}/${chunks.length} chunks`);
        }
      } catch (e) {
        console.log(`  ⚠️ Chunk ${i} failed: ${e.message}`);
      }
    }

    // Step 5: Update document status
    await client.query(
      `UPDATE intel_documents SET processing_mode = 'fully-indexed', chunk_count = $1,
       status = 'queryable', error = NULL, updated_at = NOW() WHERE document_id = $2::uuid`,
      [indexed, docId]
    );
    console.log(`  ✅ ${indexed} chunks indexed, status=fully-indexed`);
  }

  // Final status
  console.log('\n========== FINAL STATUS ==========');
  const { rows: final } = await client.query(
    'SELECT file_name, status, processing_mode, chunk_count FROM intel_documents ORDER BY created_at'
  );
  for (const r of final) {
    const icon = r.processing_mode === 'fully-indexed' && r.chunk_count > 0 ? '✅' : '⚠️';
    console.log(`${icon} ${r.file_name}: status=${r.status}, mode=${r.processing_mode}, chunks=${r.chunk_count}`);
  }

  const { rows: chunkCount } = await client.query('SELECT COUNT(*) FROM intel_document_chunks');
  console.log(`Total chunks in DB: ${chunkCount[0].count}`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
