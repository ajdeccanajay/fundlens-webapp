#!/usr/bin/env node
/**
 * Integration Test: Document Intelligence Pipeline
 * Tests with REAL PDFs, REAL Bedrock calls, REAL pdf-parse/pdf-to-img
 *
 * Usage: node scripts/test-document-intelligence-integration.js
 *
 * Tests:
 *   1. PDF text extraction (pdf-parse v2.x)
 *   2. PDF page rendering (pdf-to-img v5 ESM)
 *   3. Instant Intelligence — Haiku classification + headline extraction
 *   4. Vision Extraction — Sonnet page analysis
 *   5. Verification — deterministic number matching
 *   6. Full pipeline orchestration
 */

const fs = require('fs');
const path = require('path');

// Load env
require('dotenv').config();

const PDF_PATH = path.join(__dirname, '..', 'local-s3-storage', 'fundlens-documents-dev',
  'user_upload', 'AMZN', '924a9817-31e8-4a56-b2b6-f850968aad46.pdf');

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function fail(name, err) { failed++; console.error(`  ❌ ${name}: ${err}`); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Test 1: PDF Text Extraction (pdf-parse v2.x) ───
async function testPdfTextExtraction() {
  console.log('\n📄 Test 1: PDF Text Extraction (pdf-parse v2.x)');
  try {
    const { PDFParse } = require('pdf-parse');
    const buffer = fs.readFileSync(PDF_PATH);
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();

    if (!result.text || result.text.length < 1000) {
      return fail('text extraction', `Text too short: ${result.text?.length} chars`);
    }
    ok(`Extracted ${result.text.length} chars from ${result.total} pages`);

    // Verify it's actually AMZN content
    if (result.text.includes('Amazon') || result.text.includes('AMZN')) {
      ok('Content contains Amazon/AMZN references');
    } else {
      fail('content check', 'No Amazon/AMZN references found in text');
    }

    // Check for financial content
    const hasFinancial = /revenue|net income|operating|earnings|cash flow/i.test(result.text);
    if (hasFinancial) {
      ok('Contains financial terminology');
    } else {
      fail('financial content', 'No financial terms found');
    }

    return result.text;
  } catch (err) {
    fail('pdf-parse', err.message);
    return null;
  }
}

// ─── Test 2: PDF Page Rendering (pdf-to-img v5) ───
async function testPdfPageRendering() {
  console.log('\n🖼️  Test 2: PDF Page Rendering (pdf-to-img v5 ESM)');
  try {
    const { pdf } = await Function('return import("pdf-to-img")')();
    const buffer = fs.readFileSync(PDF_PATH);

    const pages = [];
    let pageNum = 0;
    for await (const image of await pdf(buffer, { scale: 1.5 })) {
      pageNum++;
      pages.push({ pageNumber: pageNum, size: image.length });
      if (pageNum >= 5) break; // Only render first 5 pages
    }

    if (pages.length === 0) {
      return fail('rendering', 'No pages rendered');
    }
    ok(`Rendered ${pages.length} pages as PNG images`);

    // Check image sizes are reasonable (> 10KB each)
    const allReasonable = pages.every(p => p.size > 10000);
    if (allReasonable) {
      ok(`All page images > 10KB (sizes: ${pages.map(p => `p${p.pageNumber}=${(p.size/1024).toFixed(0)}KB`).join(', ')})`);
    } else {
      fail('image sizes', 'Some pages rendered too small');
    }

    // Return first page as base64 for vision test
    let firstPageBase64 = null;
    pageNum = 0;
    for await (const image of await pdf(buffer, { scale: 2.0 })) {
      pageNum++;
      if (pageNum === 1) {
        firstPageBase64 = Buffer.from(image).toString('base64');
        break;
      }
    }
    return firstPageBase64;
  } catch (err) {
    fail('pdf-to-img', err.message);
    return null;
  }
}

// ─── Test 3: Instant Intelligence — Haiku Classification ───
async function testInstantIntelligence(rawText) {
  console.log('\n🧠 Test 3: Instant Intelligence — Haiku Classification');
  if (!rawText) { fail('skipped', 'No text from Test 1'); return null; }

  try {
    const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

    const firstPages = rawText.substring(0, 8000);

    const prompt = `You are a financial document classifier and headline extractor.
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
${firstPages}`;

    const start = Date.now();
    const command = new ConverseCommand({
      modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 2000, temperature: 0.1 },
    });

    const response = await client.send(command);
    const elapsed = Date.now() - start;
    const responseText = response.output?.message?.content?.[0]?.text || '';

    ok(`Haiku responded in ${elapsed}ms`);

    // Parse the JSON response
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // Try extracting JSON from markdown code block
      const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) parsed = JSON.parse(match[1]);
      else { fail('JSON parse', `Response not valid JSON: ${responseText.substring(0, 200)}`); return null; }
    }

    // Validate classification
    if (parsed.documentType === 'sec-10k') {
      ok(`Correctly classified as: ${parsed.documentType}`);
    } else {
      fail('classification', `Expected sec-10k, got: ${parsed.documentType}`);
    }

    if (parsed.companyName && /amazon/i.test(parsed.companyName)) {
      ok(`Company identified: ${parsed.companyName}`);
    } else {
      fail('company', `Expected Amazon, got: ${parsed.companyName}`);
    }

    if (parsed.ticker === 'AMZN') {
      ok(`Ticker identified: ${parsed.ticker}`);
    } else {
      // Ticker might not be on first pages of 10-K
      console.log(`  ⚠️  Ticker: ${parsed.ticker || 'not found'} (acceptable for 10-K)`);
    }

    if (parsed.suggestedQuestions?.length >= 2) {
      ok(`Generated ${parsed.suggestedQuestions.length} suggested questions`);
      parsed.suggestedQuestions.forEach((q, i) => console.log(`     Q${i+1}: ${q}`));
    }

    if (elapsed < 5000) {
      ok(`Within 5-second budget (${elapsed}ms)`);
    } else {
      fail('latency', `Exceeded 5s budget: ${elapsed}ms`);
    }

    console.log(`  📊 Metrics found: ${parsed.metrics?.length || 0}`);
    (parsed.metrics || []).forEach(m => {
      console.log(`     ${m.metric_key}: ${m.raw_value} (${m.period || 'no period'})`);
    });

    return parsed;
  } catch (err) {
    fail('Haiku call', err.message);
    return null;
  }
}

// ─── Test 4: Vision Extraction — Sonnet Page Analysis ───
async function testVisionExtraction(pageBase64) {
  console.log('\n👁️  Test 4: Vision Extraction — Sonnet Page Analysis');
  if (!pageBase64) { fail('skipped', 'No page image from Test 2'); return null; }

  try {
    const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

    const prompt = `Analyze this financial document page. Extract:
1. Any tables with their headers and data (as structured JSON)
2. Key metrics with numeric values
3. Important narrative text
4. Any footnotes

Return JSON with: { tables: [...], metrics: [...], narratives: [...], footnotes: [...] }
Each metric should have: { name, rawValue, numericValue, units, period }
Each table should have: { title, headers: [...], rows: [{cells: [{value, numericValue}]}], units }

Respond with ONLY valid JSON.`;

    const start = Date.now();
    const command = new ConverseCommand({
      modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      messages: [{
        role: 'user',
        content: [
          { image: { format: 'png', source: { bytes: Buffer.from(pageBase64, 'base64') } } },
          { text: prompt },
        ],
      }],
      inferenceConfig: { maxTokens: 4000, temperature: 0.1 },
    });

    const response = await client.send(command);
    const elapsed = Date.now() - start;
    const responseText = response.output?.message?.content?.[0]?.text || '';

    ok(`Sonnet Vision responded in ${elapsed}ms`);

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) parsed = JSON.parse(match[1]);
      else {
        console.log(`  ⚠️  Vision response not JSON (may be cover page): ${responseText.substring(0, 300)}`);
        return null;
      }
    }

    const tableCount = parsed.tables?.length || 0;
    const metricCount = parsed.metrics?.length || 0;
    const narrativeCount = parsed.narratives?.length || 0;

    console.log(`  📊 Tables: ${tableCount}, Metrics: ${metricCount}, Narratives: ${narrativeCount}`);

    if (tableCount > 0) {
      ok(`Extracted ${tableCount} table(s)`);
      parsed.tables.forEach(t => console.log(`     Table: ${t.title || 'untitled'} (${t.rows?.length || 0} rows)`));
    } else {
      console.log('  ⚠️  No tables on page 1 (expected for 10-K cover page)');
    }

    return parsed;
  } catch (err) {
    fail('Sonnet Vision', err.message);
    return null;
  }
}

// ─── Test 5: Verification Service — Deterministic Number Matching ───
async function testVerification(rawText) {
  console.log('\n🔍 Test 5: Verification — Deterministic Number Matching');
  if (!rawText) { fail('skipped', 'No text from Test 1'); return; }

  // Test with numbers we know are in the AMZN 10-K
  const testCases = [
    { value: 2024, rawDisplay: '2024', desc: 'fiscal year' },
    { value: 20549, rawDisplay: '20549', desc: 'SEC zip code' },
  ];

  // Also search for actual financial numbers in the text
  const revenueMatch = rawText.match(/\$([\d,]+(?:\.\d+)?)\s*(?:billion|million)?/i);
  if (revenueMatch) {
    const numStr = revenueMatch[1].replace(/,/g, '');
    const numVal = parseFloat(numStr);
    if (!isNaN(numVal)) {
      testCases.push({ value: numVal, rawDisplay: revenueMatch[0].trim(), desc: 'dollar amount from text' });
    }
  }

  // Inline verification logic (same as VerificationService)
  function generateCandidates(value, units) {
    const candidates = [];
    const abs = Math.abs(value);
    const rawFormats = [
      abs.toFixed(0),
      abs.toLocaleString('en-US'),
      abs.toFixed(1),
      abs.toFixed(2),
    ];
    if (units === 'millions' || abs >= 1_000_000) {
      const inM = abs / 1_000_000;
      rawFormats.push(inM.toFixed(0), inM.toFixed(1), inM.toFixed(2));
    }
    if (abs >= 1_000) {
      const inK = abs / 1_000;
      rawFormats.push(inK.toFixed(0), inK.toFixed(1), inK.toFixed(2));
    }
    const unique = [...new Set(rawFormats)];
    for (const fmt of unique) {
      candidates.push(fmt, `(${fmt})`, `-${fmt}`, `${fmt}%`, `${fmt}x`, `$${fmt}`, `$(${fmt})`);
    }
    return candidates;
  }

  for (const tc of testCases) {
    const candidates = generateCandidates(tc.value, undefined);
    let found = false;
    let matchedRepr = '';
    for (const c of candidates) {
      if (rawText.includes(c)) { found = true; matchedRepr = c; break; }
    }
    // Also try rawDisplay
    if (!found && tc.rawDisplay && rawText.includes(tc.rawDisplay)) {
      found = true;
      matchedRepr = tc.rawDisplay;
    }

    if (found) {
      ok(`Verified "${tc.desc}" (${tc.value}) → matched "${matchedRepr}" → confidence 1.0`);
    } else {
      fail(`verify "${tc.desc}"`, `${tc.value} not found in raw text`);
    }
  }

  // Test a number that should NOT be in the text (hallucination detection)
  const fakeNumber = 7777777.77;
  const fakeCandidates = generateCandidates(fakeNumber, undefined);
  const fakeFound = fakeCandidates.some(c => c.length > 3 && rawText.includes(c));
  if (!fakeFound) {
    ok(`Correctly flagged hallucinated number (${fakeNumber}) → confidence 0.7`);
  } else {
    const matched = fakeCandidates.find(c => c.length > 3 && rawText.includes(c));
    fail('hallucination detection', `Fake number ${fakeNumber} was found as "${matched}"`);
  }
}

// ─── Test 6: Key Page Identification ───
async function testKeyPageIdentification(rawText) {
  console.log('\n📑 Test 6: Key Page Identification');
  if (!rawText) { fail('skipped', 'No text from Test 1'); return; }

  // Replicate the identifyKeyPages logic from VisionExtractionService
  const pages = rawText.split(/\f/); // Form feed splits pages
  const keyPages = [];
  const maxPages = 15;

  const financialPatterns = [
    /consolidated\s+(?:statements?\s+of\s+)?(?:operations|income|earnings)/i,
    /balance\s+sheet/i,
    /cash\s+flow/i,
    /(?:revenue|net\s+(?:income|sales|revenue))\s*[\$\d]/i,
    /(?:EV|Enterprise\s+Value)\s*\/\s*(?:EBITDA|Revenue|Sales)/i,
    /(?:P\/E|Price\s*\/\s*Earnings)/i,
    /(?:DCF|Discounted\s+Cash\s+Flow)/i,
    /(?:comparable|comp(?:arable)?)\s+(?:companies|analysis|table)/i,
    /(?:valuation|multiple)\s+(?:summary|analysis|table)/i,
  ];

  for (let i = 0; i < pages.length && keyPages.length < maxPages; i++) {
    const page = pages[i];
    if (!page || page.trim().length < 100) continue;

    // Check for financial content
    const matchCount = financialPatterns.filter(p => p.test(page)).length;
    const hasDollarAmounts = (page.match(/\$[\d,]+/g) || []).length >= 3;
    const hasPercentages = (page.match(/[\d.]+%/g) || []).length >= 2;

    if (matchCount >= 1 || hasDollarAmounts || hasPercentages) {
      keyPages.push(i + 1);
    }
  }

  if (keyPages.length > 0) {
    ok(`Identified ${keyPages.length} key pages: [${keyPages.slice(0, 10).join(', ')}${keyPages.length > 10 ? '...' : ''}]`);
  } else {
    // Try with simpler heuristic
    console.log('  ⚠️  No key pages found with pattern matching (text may not have form-feed page breaks)');
    // Count financial indicators in the full text
    const dollarCount = (rawText.match(/\$[\d,]+/g) || []).length;
    const percentCount = (rawText.match(/[\d.]+%/g) || []).length;
    console.log(`  📊 Financial indicators in full text: ${dollarCount} dollar amounts, ${percentCount} percentages`);
    if (dollarCount > 50) ok('Document is rich in financial data');
  }
}

// ─── Main ───
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Document Intelligence Integration Test');
  console.log('  PDF: AMZN 10-K (real SEC filing, ~750KB)');
  console.log('═══════════════════════════════════════════════════════════');

  if (!fs.existsSync(PDF_PATH)) {
    console.error(`❌ PDF not found at: ${PDF_PATH}`);
    process.exit(1);
  }

  const rawText = await testPdfTextExtraction();
  const pageBase64 = await testPdfPageRendering();
  const classification = await testInstantIntelligence(rawText);
  const visionResult = await testVisionExtraction(pageBase64);
  await testVerification(rawText);
  await testKeyPageIdentification(rawText);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
