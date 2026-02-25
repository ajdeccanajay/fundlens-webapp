/**
 * Direct document reprocessing — bypasses NestJS server entirely.
 * Reads raw text from S3, chunks it, embeds with Titan V2, stores in pgvector.
 * 
 * Usage: node --max-old-space-size=4096 scripts/reprocess-documents-direct.js
 */
require('dotenv').config();
const { Client } = require('pg');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const DB_URL = process.env.DATABASE_URL;
const REGION = process.env.AWS_REGION || 'us-east-1';
const S3_BUCKET = process.env.S3_BUCKET_NAME || 'fundlens-documents-dev';

const s3 = new S3Client({ region: REGION });
const bedrock = new BedrockRuntimeClient({ region: REGION });

async function getS3Buffer(key) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function generateEmbedding(text) {
  const truncated = text.substring(0, 32000);
  const cmd = new InvokeModelCommand({
    modelId: 'amazon.titan-embed-text-v2:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputText: truncated }),
  });
  const resp = await bedrock.send(cmd);
  const result = JSON.parse(Buffer.from(resp.body).toString());
  return result.embedding;
}

function chunkText(rawText) {
  const maxChars = 2400;
  const overlapChars = 100;
  const sections = rawText.split(/\f|\n{3,}/).filter(s => s.trim().length > 50);
  const chunks = [];
  let idx = 0;

  // If only 1 section (no page breaks), split the whole text
  if (sections.length <= 1) {
    const text = rawText.trim();
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + maxChars, text.length);
      if (end < text.length) {
        const seg = text.substring(start, end);
        const bp = Math.max(seg.lastIndexOf('. '), seg.lastIndexOf('\n'));
        if (bp > maxChars * 0.5) end = start + bp + 1;
      }
      const content = text.substring(start, end).trim();
      if (content.length > 50) {
        chunks.push({ chunkIndex: idx++, content, sectionType: 'narrative' });
      }
      start = end - overlapChars;
      if (start >= text.length) break;
    }
  } else {
    for (const section of sections) {
      if (section.length <= maxChars) {
        chunks.push({ chunkIndex: idx++, content: section.trim(), sectionType: 'narrative' });
      } else {
        let start = 0;
        while (start < section.length) {
          let end = Math.min(start + maxChars, section.length);
          if (end < section.length) {
            const seg = section.substring(start, end);
            const bp = Math.max(seg.lastIndexOf('. '), seg.lastIndexOf('\n'));
            if (bp > maxChars * 0.5) end = start + bp + 1;
          }
          const content = section.substring(start, end).trim();
          if (content.length > 50) {
            chunks.push({ chunkIndex: idx++, content, sectionType: 'narrative' });
          }
          start = end - overlapChars;
          if (start >= section.length) break;
        }
      }
    }
  }
  return chunks;
}

async function extractTextFromPdf(s3Key) {
  const buffer = await getS3Buffer(s3Key);
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text || '';
}

async function processDocument(client, doc) {
  console.log(`\n=== ${doc.file_name} (${doc.document_id}) ===`);
  console.log(`  status=${doc.status}, mode=${doc.processing_mode}, chunks=${doc.chunk_count}`);
  console.log(`  Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);

  // Step 1: Get raw text
  let rawText = '';
  if (doc.raw_text_s3_key) {
    console.log(`  Reading raw text from S3...`);
    rawText = (await getS3Buffer(doc.raw_text_s3_key)).toString('utf-8');
  } else if (doc.s3_key) {
    console.log(`  Extracting text from PDF...`);
    rawText = await extractTextFromPdf(doc.s3_key);
    // Store raw text to S3
    const rawTextKey = `extracted/${doc.tenant_id}/${doc.deal_id}/${doc.document_id}/raw_text.txt`;
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET, Key: rawTextKey,
      Body: Buffer.from(rawText, 'utf-8'), ContentType: 'text/plain',
    }));
    await client.query(
      `UPDATE intel_documents SET raw_text_s3_key = $1, status = 'queryable',
       processing_mode = 'long-context-fallback', page_count = $2, updated_at = NOW()
       WHERE document_id = $3::uuid`,
      [rawTextKey, Math.max(1, Math.ceil(rawText.length / 3000)), doc.document_id]
    );
    console.log(`  Extracted and stored ${rawText.length} chars`);
  } else {
    console.log(`  ❌ No text source — skipping`);
    return false;
  }

  console.log(`  Raw text: ${rawText.length} chars`);

  // Step 2: Clean up existing chunks
  await client.query('DELETE FROM intel_document_chunks WHERE document_id = $1::uuid', [doc.document_id]);

  // Step 3: Chunk
  const chunks = chunkText(rawText);
  console.log(`  Created ${chunks.length} chunks`);
  if (chunks.length === 0) return false;

  // Step 4: Embed and index ONE AT A TIME
  let indexed = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const embedding = await generateEmbedding(chunk.content);
      const embeddingStr = `[${embedding.join(',')}]`;
      await client.query(
        `INSERT INTO intel_document_chunks (id, document_id, tenant_id, deal_id,
          chunk_index, content, section_type, token_estimate, embedding, created_at)
        VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid,
          $4, $5, $6, $7, $8::vector, NOW())`,
        [doc.document_id, doc.tenant_id, doc.deal_id,
         chunk.chunkIndex, chunk.content, chunk.sectionType,
         Math.ceil(chunk.content.length / 4), embeddingStr]
      );
      indexed++;
      if ((i + 1) % 5 === 0 || i === chunks.length - 1) {
        console.log(`  Indexed ${indexed}/${chunks.length} (mem: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB)`);
      }
    } catch (e) {
      console.log(`  ⚠️ Chunk ${i} failed: ${e.message}`);
    }
  }

  // Step 5: Update document
  await client.query(
    `UPDATE intel_documents SET processing_mode = 'fully-indexed', chunk_count = $1,
     status = 'queryable', error = NULL, updated_at = NOW() WHERE document_id = $2::uuid`,
    [indexed, doc.document_id]
  );
  console.log(`  ✅ DONE: ${indexed} chunks indexed`);
  return true;
}

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to DB');

  const { rows: docs } = await client.query(
    `SELECT document_id, file_name, status, processing_mode, chunk_count,
            tenant_id, deal_id, raw_text_s3_key, file_size, file_type, s3_key
     FROM intel_documents ORDER BY created_at`
  );

  console.log(`Found ${docs.length} documents\n`);

  for (const doc of docs) {
    try {
      await processDocument(client, doc);
    } catch (e) {
      console.log(`  ❌ Failed: ${e.message}`);
      // Update error in DB
      await client.query(
        `UPDATE intel_documents SET error = $1, updated_at = NOW() WHERE document_id = $2::uuid`,
        [e.message, doc.document_id]
      ).catch(() => {});
    }
  }

  // Final status
  console.log('\n========== FINAL STATUS ==========');
  const { rows: final } = await client.query(
    `SELECT file_name, status, processing_mode, chunk_count, metric_count
     FROM intel_documents ORDER BY created_at`
  );
  for (const d of final) {
    const icon = d.processing_mode === 'fully-indexed' && d.chunk_count > 0 ? '✅' : '⚠️';
    console.log(`${icon} ${d.file_name}: status=${d.status}, mode=${d.processing_mode}, chunks=${d.chunk_count}`);
  }

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
