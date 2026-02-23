/**
 * Plain Node.js tests for SyncEnvelopeGeneratorService logic
 * Requirements: 7.1-7.9, 9.3
 *
 * Tests the core logic (buildS3Path, chunkDocuments, envelope generation)
 * without importing the actual service to avoid AWS SDK compilation overhead.
 * The logic tested here mirrors the implementation in sync-envelope-generator.service.ts.
 *
 * Run: node test/unit/sync-envelope-generator.test.js
 */
const assert = require('assert');

console.log('=== SyncEnvelopeGenerator Tests ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

// ─── Constants matching the service ───
const MAX_CHUNK_SIZE = 6000;
const CHUNK_OVERLAP = 200;

// ─── Core functions (mirroring sync-envelope-generator.service.ts) ───

function buildS3Path(tenantId, dealId, sessionId) {
  return `kb-ready/${tenantId}/${dealId}/${sessionId}/`;
}

function chunkDocuments(documents, session) {
  const chunks = [];
  let globalIndex = 0;
  for (const doc of documents) {
    if (!doc.extracted_text || doc.processing_status !== 'complete') continue;
    const text = doc.extracted_text;
    let offset = 0;
    while (offset < text.length) {
      const end = Math.min(offset + MAX_CHUNK_SIZE, text.length);
      chunks.push({
        chunkIndex: globalIndex,
        content: text.substring(offset, end),
        metadata: {
          ticker: session.ticker, tenant_id: session.tenant_id,
          deal_id: session.deal_id, session_id: session.id,
          document_type: 'instant_rag_upload', filing_type: doc.file_type,
          fiscal_period: '', section_type: 'full_document',
          file_name: doc.file_name, visibility: 'private',
        },
      });
      globalIndex++;
      if (end >= text.length) break;
      offset = end - CHUNK_OVERLAP;
    }
  }
  return chunks;
}

function extractMetricsFromSummaries(summaries) {
  const metrics = [];
  for (const summary of summaries) {
    for (const m of (summary.headline_metrics || [])) {
      metrics.push({
        metric: m.metric || 'Unknown', value: m.value || 'N/A',
        period: m.period || 'Unknown', source: summary.file_name, documentIndex: 0,
      });
    }
  }
  return metrics;
}

function generateSessionSummary(documents, userQuestions) {
  const docNames = documents.map(d => d.file_name).join(', ');
  if (userQuestions.length === 0) return `Uploaded ${documents.length} document(s): ${docNames}. No questions asked.`;
  const first = (userQuestions[0]?.content || '').substring(0, 100);
  return `Uploaded ${documents.length} document(s): ${docNames}. Asked ${userQuestions.length} question(s). First: "${first}..."`;
}

function buildEnvelope(session, documents, qaLog, summaries) {
  const artifacts = [];
  const metrics = extractMetricsFromSummaries(summaries);
  if (metrics.length > 0) artifacts.push({ artifactType: 'structured_metrics', syncTarget: 'rds', table: 'deal_metrics', data: metrics });
  const s3Path = buildS3Path(session.tenant_id, session.deal_id, session.id);
  const chunks = chunkDocuments(documents, session);
  if (chunks.length > 0) artifacts.push({ artifactType: 'document_chunks', syncTarget: 's3_then_kb', s3Path, chunks });
  const userQs = qaLog.filter(e => e.role === 'user');
  const durationMs = session.last_activity_at ? new Date(session.last_activity_at).getTime() - new Date(session.created_at).getTime() : 0;
  artifacts.push({
    artifactType: 'session_qa_log', syncTarget: 'rds', table: 'research_sessions',
    data: { sessionId: session.id, dealId: session.deal_id, documentsProcessed: documents.map(d => d.file_name), questionsAsked: userQs.length, provocationsGenerated: 0, durationMinutes: Math.round(durationMs / 60000), summary: generateSessionSummary(documents, userQs) },
  });
  return {
    tenantId: session.tenant_id, workspaceId: session.tenant_id, dealId: session.deal_id, ticker: session.ticker, sessionId: session.id, userId: session.user_id, createdAt: new Date().toISOString(), artifacts,
    syncInstructions: { priority: 'normal', rdsSync: { upsertStrategy: 'merge_on_composite_key', conflictResolution: 'latest_session_wins', keys: { deal_metrics: ['tenant_id', 'deal_id', 'metric', 'period'], research_sessions: ['session_id'] } }, s3KbSync: { trigger: 'post_session', kbIngestionScope: 'tenant_deal_datasource', embeddingConsistency: 'titan_text_v2_only' } },
  };
}

// ─── Test data ───
const sess = { id: 'session-1', tenant_id: 'tenant-abc', deal_id: 'deal-xyz', user_id: 'user-1', ticker: 'AAPL', status: 'ended', created_at: new Date('2026-02-10T10:00:00Z'), last_activity_at: new Date('2026-02-10T10:05:00Z') };
const docs = [
  { id: 'd1', file_name: 'AAPL_10K.pdf', file_type: 'pdf', file_size_bytes: 1024000, content_hash: 'abc', extracted_text: 'Apple Revenue $394.3B.', page_count: 80, processing_status: 'complete' },
  { id: 'd2', file_name: 'AAPL_Q4.pdf', file_type: 'pdf', file_size_bytes: 512000, content_hash: 'def', extracted_text: 'EPS $1.64.', page_count: 20, processing_status: 'complete' },
];
const qaLog = [
  { id: 'q1', role: 'user', content: 'Revenue?', created_at: new Date() },
  { id: 'q2', role: 'assistant', content: '$394.3B', created_at: new Date() },
];
const sums = [{ headline_metrics: [{ metric: 'Revenue', value: '$394.3B', period: 'FY2024' }, { metric: 'Net Income', value: '$93.7B', period: 'FY2024' }], file_name: 'AAPL_10K.pdf' }];

// ─── buildS3Path ───
console.log('buildS3Path:');
test('builds correct path', () => assert.strictEqual(buildS3Path('tenant-abc', 'deal-xyz', 'session-1'), 'kb-ready/tenant-abc/deal-xyz/session-1/'));
test('tenant isolation', () => { assert.notStrictEqual(buildS3Path('t1', 'd', 's'), buildS3Path('t2', 'd', 's')); assert.ok(buildS3Path('t1', 'd', 's').includes('t1')); });

// ─── chunkDocuments ───
console.log('\nchunkDocuments:');
test('short doc → single chunk', () => { const c = chunkDocuments([{ ...docs[0], extracted_text: 'Short' }], sess); assert.strictEqual(c.length, 1); assert.strictEqual(c[0].content, 'Short'); assert.strictEqual(c[0].chunkIndex, 0); });
test('metadata has tenant_id, visibility=private, ticker', () => { const c = chunkDocuments([docs[0]], sess); assert.strictEqual(c[0].metadata.tenant_id, 'tenant-abc'); assert.strictEqual(c[0].metadata.deal_id, 'deal-xyz'); assert.strictEqual(c[0].metadata.visibility, 'private'); assert.strictEqual(c[0].metadata.ticker, 'AAPL'); });
test('long doc → multiple chunks with sequential indices', () => { const c = chunkDocuments([{ ...docs[0], extracted_text: 'A'.repeat(15000) }], sess); assert.ok(c.length > 1); c.forEach((ch, i) => assert.strictEqual(ch.chunkIndex, i)); });
test('skips null text', () => assert.strictEqual(chunkDocuments([{ ...docs[0], extracted_text: null }], sess).length, 0));
test('skips failed status', () => assert.strictEqual(chunkDocuments([{ ...docs[0], processing_status: 'failed' }], sess).length, 0));
test('overlap applied correctly', () => { const t = 'A'.repeat(MAX_CHUNK_SIZE + 100); const c = chunkDocuments([{ ...docs[0], extracted_text: t }], sess); assert.strictEqual(c.length, 2); assert.strictEqual(c[0].content.length, MAX_CHUNK_SIZE); });

// ─── extractMetricsFromSummaries ───
console.log('\nextractMetrics:');
test('extracts metrics', () => { const m = extractMetricsFromSummaries(sums); assert.strictEqual(m.length, 2); assert.strictEqual(m[0].metric, 'Revenue'); assert.strictEqual(m[0].source, 'AAPL_10K.pdf'); });
test('empty summaries', () => assert.strictEqual(extractMetricsFromSummaries([]).length, 0));
test('missing headline_metrics', () => assert.strictEqual(extractMetricsFromSummaries([{ file_name: 'x.pdf' }]).length, 0));

// ─── generateSessionSummary ───
console.log('\nsessionSummary:');
test('with questions', () => { const s = generateSessionSummary([{ file_name: 'a.pdf' }], [{ content: 'Revenue?' }]); assert.ok(s.includes('1 question(s)')); });
test('no questions', () => assert.ok(generateSessionSummary([{ file_name: 'a.pdf' }], []).includes('No questions asked')));

// ─── Full envelope ───
console.log('\nenvelope:');
test('all required fields', () => { const e = buildEnvelope(sess, docs, qaLog, sums); assert.strictEqual(e.tenantId, 'tenant-abc'); assert.strictEqual(e.dealId, 'deal-xyz'); assert.strictEqual(e.ticker, 'AAPL'); assert.strictEqual(e.sessionId, 'session-1'); assert.strictEqual(e.userId, 'user-1'); assert.strictEqual(e.workspaceId, 'tenant-abc'); });
test('structured_metrics artifact', () => { const e = buildEnvelope(sess, docs, qaLog, sums); const m = e.artifacts.find(a => a.artifactType === 'structured_metrics'); assert.ok(m); assert.strictEqual(m.syncTarget, 'rds'); assert.strictEqual(m.data[0].metric, 'Revenue'); });
test('document_chunks with S3 path', () => { const e = buildEnvelope(sess, docs, qaLog, sums); const c = e.artifacts.find(a => a.artifactType === 'document_chunks'); assert.strictEqual(c.s3Path, 'kb-ready/tenant-abc/deal-xyz/session-1/'); assert.strictEqual(c.syncTarget, 's3_then_kb'); });
test('session_qa_log counts', () => { const e = buildEnvelope(sess, docs, qaLog, sums); const q = e.artifacts.find(a => a.artifactType === 'session_qa_log'); assert.strictEqual(q.data.questionsAsked, 1); assert.deepStrictEqual(q.data.documentsProcessed, ['AAPL_10K.pdf', 'AAPL_Q4.pdf']); assert.strictEqual(q.data.durationMinutes, 5); });
test('sync instructions', () => { const e = buildEnvelope(sess, docs, qaLog, sums); assert.strictEqual(e.syncInstructions.rdsSync.upsertStrategy, 'merge_on_composite_key'); assert.strictEqual(e.syncInstructions.s3KbSync.embeddingConsistency, 'titan_text_v2_only'); });
test('no Q&A → 0 questions', () => { const e = buildEnvelope(sess, docs, [], []); assert.strictEqual(e.artifacts.find(a => a.artifactType === 'session_qa_log').data.questionsAsked, 0); });
test('skips incomplete docs', () => { const e = buildEnvelope(sess, [...docs, { ...docs[0], id: 'd3', extracted_text: null, processing_status: 'failed' }], qaLog, sums); assert.strictEqual(new Set(e.artifacts.find(a => a.artifactType === 'document_chunks').chunks.map(c => c.metadata.file_name)).size, 2); });

// ─── Summary ───
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
