#!/usr/bin/env node
/**
 * Session 3 service tests — runs against compiled JS to avoid ts-jest OOM
 */
const { DocumentChunkingService } = require('../dist/src/documents/document-chunking.service');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (!condition) { console.error('  FAIL:', msg); failed++; }
  else { passed++; }
}

// ── DocumentChunkingService Tests ──

const svc = new DocumentChunkingService();

// Test 1: Basic chunking
const text = 'Revenue grew significantly in the fiscal year. '.repeat(60);
const chunks = svc.chunk(text);
assert(chunks.length > 0, 'Should produce chunks');
assert(chunks.every(c => c.content.length > 50), 'All chunks > 50 chars');
assert(chunks.every(c => c.tokenEstimate > 0), 'All chunks have token estimate');
assert(chunks.every((c, i) => c.chunkIndex === i), 'Sequential indices');
console.log('✅ Test 1: Basic chunking (' + chunks.length + ' chunks)');

// Test 2: Table preservation from vision results
const visionResults = [{
  pageNumber: 3,
  tables: [{
    title: 'Comparable Companies', tableType: 'comp-table', units: 'millions',
    headers: [{ cells: ['Company', 'EV/EBITDA', 'P/E'] }],
    rows: [
      { label: 'AAPL', cells: ['22.3x', '31.2x'] },
      { label: 'MSFT', cells: ['19.8x', '27.5x'] },
    ],
  }],
  narratives: [], footnotes: [], entities: {},
}];
const chunks2 = svc.chunk('Some text content here. '.repeat(100), visionResults);
const tableChunks = chunks2.filter(c => c.sectionType === 'comp-table');
assert(tableChunks.length === 1, 'Should have 1 table chunk');
assert(tableChunks[0].content.includes('Comparable Companies'), 'Table has title');
assert(tableChunks[0].content.includes('AAPL'), 'Table has AAPL');
assert(tableChunks[0].pageNumber === 3, 'Table has page number 3');
console.log('✅ Test 2: Table preservation');

// Test 3: Section classification
const text3 = [
  'Consolidated Statements of Operations\n\nRevenue was 100M. ' + 'x'.repeat(200),
  '\n\n\n',
  'Risk Factors\n\nThe company faces competition. ' + 'y'.repeat(200),
  '\n\n\n',
  'Management Discussion and Analysis\n\nRevenue grew 15%. ' + 'z'.repeat(200),
].join('');
const chunks3 = svc.chunk(text3);
const types = chunks3.map(c => c.sectionType);
assert(types.includes('income-statement'), 'Has income-statement section');
assert(types.includes('risk-factors'), 'Has risk-factors section');
assert(types.includes('mda'), 'Has mda section');
console.log('✅ Test 3: Section classification');

// Test 4: Empty text
assert(svc.chunk('').length === 0, 'Empty text = no chunks');
console.log('✅ Test 4: Empty text');

// Test 5: Overlap splitting
const chunks5 = svc.chunk(
  'This is a sentence about revenue growth. '.repeat(100),
  [], { maxTokens: 600, overlap: 100 },
);
assert(chunks5.length > 1, 'Should split into multiple chunks');
console.log('✅ Test 5: Overlap splitting (' + chunks5.length + ' chunks)');

// Test 6: Form-feed page breaks
const text6 = 'Page 1 content. '.repeat(20) + '\f' + 'Page 2 content. '.repeat(20);
const chunks6 = svc.chunk(text6);
assert(chunks6.length >= 2, 'Should split on form-feed');
console.log('✅ Test 6: Form-feed page breaks');

// Test 7: Tiny chunks filtered out
const text7 = 'Short.\n\n\nAnother short.\n\n\n' + 'Long enough content for a real chunk. '.repeat(50);
const chunks7 = svc.chunk(text7);
assert(chunks7.every(c => c.content.length > 50), 'No tiny chunks');
console.log('✅ Test 7: Tiny chunk filtering');

// Test 8: maxTokens option
const text8 = 'Revenue grew significantly in the fiscal year. '.repeat(200);
const chunks8 = svc.chunk(text8, [], { maxTokens: 300 });
assert(chunks8.every(c => c.tokenEstimate < 600), 'Respects maxTokens');
console.log('✅ Test 8: maxTokens option');

console.log('\n' + passed + ' assertions passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
console.log('\n✅ All DocumentChunkingService tests passed');
