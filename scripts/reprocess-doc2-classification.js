#!/usr/bin/env node
/**
 * Reprocess document 2 through Haiku classification to get document_type + metrics.
 * Doc 2 was uploaded before the processInstantIntelligence fix (commit 07e743c).
 */
const { Client } = require('pg');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const DB_URL = 'postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db?sslmode=no-verify';
const BUCKET = 'fundlens-documents-dev';
const REGION = 'us-east-1';
const DOC_ID = '34d93bde-045a-4017-888c-23af2e657f95';

const INSTANT_INTELLIGENCE_PROMPT = `You are a financial document classifier and headline extractor.
Given the first 2-3 pages of a document, return a JSON response with:

1. documentType: one of [sell-side-report, ic-memo, pe-cim, earnings-transcript,
   sec-10k, sec-10q, sec-8k, sec-proxy, fund-mandate, spreadsheet, presentation, generic]
2. companyName: the primary company this document is about
3. ticker: the stock ticker if identifiable
4. summary: a 1-sentence description
5. metrics: array of headline metrics visible on the first pages. For each:
   - metric_key: canonical name (price_target, rating, revenue, ebitda, etc.)
   - raw_value: as displayed
   - numeric_value: parsed number or null
   - period: if identifiable
   - is_estimate: true if analyst estimate, false if reported actual
6. suggestedQuestions: 3 questions an analyst would likely ask about this document

Respond with ONLY valid JSON. No markdown, no explanation.

Document text:
`;

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const s3 = new S3Client({ region: REGION });
  const bedrock = new BedrockRuntimeClient({ region: REGION });

  // Get doc record
  const doc = (await db.query('SELECT * FROM intel_documents WHERE document_id = $1', [DOC_ID])).rows[0];
  console.log(`Document: ${doc.file_name}`);
  console.log(`Current: type=${doc.document_type}, ticker=${doc.company_ticker}, metrics=${doc.metric_count}`);

  // Get raw text from S3
  const rawTextKey = doc.raw_text_s3_key;
  if (!rawTextKey) {
    console.error('No raw_text_s3_key — need to extract text first');
    process.exit(1);
  }

  console.log(`Reading raw text from: ${rawTextKey}`);
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: rawTextKey }));
  const rawText = await obj.Body.transformToString();
  console.log(`Raw text: ${rawText.length} chars`);

  // Call Haiku for classification
  const firstPages = rawText.substring(0, 8000);
  const prompt = INSTANT_INTELLIGENCE_PROMPT + firstPages;

  console.log('\nCalling Haiku for classification...');
  const response = await bedrock.send(new InvokeModelCommand({
    modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  }));

  const result = JSON.parse(new TextDecoder().decode(response.body));
  const text = result.content[0].text;
  console.log('\nRaw response:', text.substring(0, 500));

  // Parse
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);
  console.log('\nParsed:');
  console.log(`  documentType: ${parsed.documentType}`);
  console.log(`  companyName: ${parsed.companyName}`);
  console.log(`  ticker: ${parsed.ticker}`);
  console.log(`  summary: ${parsed.summary}`);
  console.log(`  metrics: ${parsed.metrics?.length || 0}`);
  if (parsed.metrics) {
    for (const m of parsed.metrics) {
      console.log(`    ${m.metric_key}: ${m.raw_value} (${m.period || 'no period'})`);
    }
  }

  // Update document record
  await db.query(`
    UPDATE intel_documents SET
      document_type = $1,
      company_ticker = $2,
      company_name = $3,
      updated_at = NOW()
    WHERE document_id = $4
  `, [parsed.documentType, parsed.ticker, parsed.companyName, DOC_ID]);
  console.log('\n✅ Document record updated');

  // Persist headline metrics
  if (parsed.metrics && parsed.metrics.length > 0) {
    for (const m of parsed.metrics) {
      await db.query(`
        INSERT INTO intel_document_extractions (
          document_id, tenant_id, deal_id,
          extraction_type, data, confidence, verified, source_layer, created_at
        ) VALUES ($1::uuid, $2::uuid, $3::uuid,
          'headline', $4::jsonb, 0.90, false, 'headline', NOW())
      `, [DOC_ID, doc.tenant_id, doc.deal_id, JSON.stringify({
        metric_key: m.metric_key,
        raw_value: m.raw_value,
        numeric_value: m.numeric_value ?? null,
        period: m.period || null,
        is_estimate: m.is_estimate ?? false,
      })]);
    }
    await db.query('UPDATE intel_documents SET metric_count = $1 WHERE document_id = $2', [parsed.metrics.length, DOC_ID]);
    console.log(`✅ Persisted ${parsed.metrics.length} headline metrics`);
  }

  // Also update KB chunks metadata with the new document_type and ticker
  // Re-sync to S3 with updated metadata
  const chunks = await db.query(`
    SELECT chunk_index, content, section_type, page_number
    FROM intel_document_chunks WHERE document_id = $1 ORDER BY chunk_index
  `, [DOC_ID]);

  const safeName = doc.file_name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const { PutObjectCommand } = require('@aws-sdk/client-s3');

  for (const chunk of chunks.rows) {
    const key = `kb-ready/${doc.tenant_id}/${doc.deal_id}/uploads/${safeName}_chunk_${String(chunk.chunk_index + 1).padStart(3, '0')}.json`;
    const payload = {
      content: chunk.content,
      metadata: {
        tenant_id: doc.tenant_id,
        deal_id: doc.deal_id,
        document_id: DOC_ID,
        document_type: parsed.documentType || 'generic',
        source: 'upload',
        company_ticker: parsed.ticker || '',
        file_name: doc.file_name,
        section_type: chunk.section_type || 'general',
        chunk_index: chunk.chunk_index,
        total_chunks: chunks.rows.length,
      },
    };
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(payload),
      ContentType: 'application/json',
    }));
  }
  console.log(`✅ Re-synced ${chunks.rows.length} KB chunks with updated metadata`);

  await db.end();
  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });
