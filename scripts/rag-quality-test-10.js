#!/usr/bin/env node
/**
 * RAG Quality Test — 10 Complex Queries Against Live Production
 * 
 * Tests: executive compensation, peer comparison, financial metrics,
 * sentiment analysis, provocations, earnings call evolution,
 * insider trading, governance, R&D comparison, Canadian filer (40-F).
 *
 * Run: node scripts/rag-quality-test-10.js
 */

const https = require('https');

const ALB = 'https://fundlens-production-alb-931926615.us-east-1.elb.amazonaws.com';
const PLATFORM_KEY = 'c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06';

// ─── HTTPS request helper (self-signed ALB cert) ─────────────────────────────
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(path, ALB);
    const opts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-platform-admin-key': PLATFORM_KEY,
      },
      rejectUnauthorized: false,
      timeout: 120000,
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: { raw: data.substring(0, 500) } });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout (120s)')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── 10 Complex Queries ──────────────────────────────────────────────────────
const QUERIES = [
  {
    id: 'Q1',
    name: 'Executive Compensation — AAPL vs MSFT CEO Pay (DEF 14A)',
    body: { query: 'Compare Apple and Microsoft CEO compensation packages including base salary, stock awards, and total compensation from their latest proxy statements' },
    evaluate: (b) => {
      if (b.error) return { grade: 'FAIL', reason: `Error: ${b.error}` };
      const a = (b.answer || '').toLowerCase();
      const hasCEO = /ceo|chief executive|tim cook|satya nadella/i.test(b.answer || '');
      const hasComp = /compensation|salary|stock|award|total/i.test(b.answer || '');
      const hasNumbers = /\$[\d,.]+|million|billion|\d{1,3}(,\d{3})+/i.test(b.answer || '');
      const len = (b.answer || '').length;
      if (hasCEO && hasComp && hasNumbers && len > 300) return { grade: 'A', reason: `Rich answer (${len} chars), mentions CEO names + comp details` };
      if (hasComp && len > 200) return { grade: 'B', reason: `Decent answer (${len} chars), has comp info` };
      if (len > 100) return { grade: 'C', reason: `Thin answer (${len} chars)` };
      return { grade: 'FAIL', reason: `Weak/empty (${len} chars): "${(b.answer || '').substring(0, 120)}"` };
    },
  },
  {
    id: 'Q2',
    name: 'Peer Comparison — NVDA vs AMZN Revenue Growth',
    body: { query: 'Compare NVDA and AMZN revenue growth over the last 3 years. Which company grew faster and by how much?' },
    evaluate: (b) => {
      if (b.error) return { grade: 'FAIL', reason: `Error: ${b.error}` };
      const a = b.answer || '';
      const hasNVDA = /nvda|nvidia/i.test(a);
      const hasAMZN = /amzn|amazon/i.test(a);
      const hasGrowth = /growth|grew|increase|yoy|year.over.year|%/i.test(a);
      const hasNumbers = /\d+\.?\d*%|\$[\d,.]+|billion|million/i.test(a);
      const hasMetrics = (b.metrics || []).length > 0;
      if (hasNVDA && hasAMZN && hasGrowth && hasNumbers && a.length > 400) return { grade: 'A', reason: `Both tickers + growth data + numbers (${a.length} chars, ${(b.metrics||[]).length} metrics)` };
      if ((hasNVDA || hasAMZN) && hasGrowth && a.length > 200) return { grade: 'B', reason: `Partial comparison (${a.length} chars)` };
      if (a.length > 100) return { grade: 'C', reason: `Thin (${a.length} chars)` };
      return { grade: 'FAIL', reason: `Weak: "${a.substring(0, 120)}"` };
    },
  },
  {
    id: 'Q3',
    name: 'Multi-Ticker Operating Margins — GOOGL vs MSFT vs AMZN',
    body: { query: 'Compare operating margins for Google, Microsoft, and Amazon over the last 2 years. Who has the highest profitability?', options: { tickers: ['GOOGL', 'MSFT', 'AMZN'] } },
    evaluate: (b) => {
      if (b.error) return { grade: 'FAIL', reason: `Error: ${b.error}` };
      const a = b.answer || '';
      const tickers = ['googl', 'google', 'msft', 'microsoft', 'amzn', 'amazon'];
      const found = tickers.filter(t => a.toLowerCase().includes(t));
      const hasMargin = /margin|profitab|operating income/i.test(a);
      const hasPercent = /\d+\.?\d*%/i.test(a);
      if (found.length >= 4 && hasMargin && hasPercent && a.length > 400) return { grade: 'A', reason: `All 3 companies + margins + % (${a.length} chars)` };
      if (found.length >= 2 && hasMargin && a.length > 200) return { grade: 'B', reason: `Partial (${found.length} tickers, ${a.length} chars)` };
      if (a.length > 100) return { grade: 'C', reason: `Thin (${a.length} chars)` };
      return { grade: 'FAIL', reason: `Weak: "${a.substring(0, 120)}"` };
    },
  },
  {
    id: 'Q4',
    name: 'Deep Sentiment — TSLA Risk Factor Tone Shift 2022→2024',
    body: { query: 'Analyze how Tesla risk factor disclosures have changed in tone and substance from 2022 to 2024. What new risks appeared? What language shifted?' },
    evaluate: (b) => {
      if (b.error) return { grade: 'FAIL', reason: `Error: ${b.error}` };
      const a = b.answer || '';
      const hasTSLA = /tsla|tesla/i.test(a);
      const hasRisk = /risk|regulatory|competition|litigation|supply chain|cybersecurity/i.test(a);
      const hasTemporal = /2022|2023|2024|shift|change|evolv|new|added|removed/i.test(a);
      const hasSentiment = /tone|sentiment|language|cautious|optimistic|aggressive|defensive/i.test(a);
      if (hasTSLA && hasRisk && hasTemporal && a.length > 400) return { grade: 'A', reason: `Rich temporal risk analysis (${a.length} chars)` };
      if (hasTSLA && hasRisk && a.length > 200) return { grade: 'B', reason: `Has risk info (${a.length} chars)` };
      if (a.length > 100) return { grade: 'C', reason: `Thin (${a.length} chars)` };
      return { grade: 'FAIL', reason: `Weak: "${a.substring(0, 120)}"` };
    },
  },
  {
    id: 'Q5',
    name: 'Deep Provocation — What is ABNB Hiding in Risk Disclosures?',
    body: { query: 'What is Airbnb potentially hiding or downplaying in their risk factor disclosures? Identify any red flags, vague language, or conspicuous omissions compared to peers.' },
    evaluate: (b) => {
      if (b.error) return { grade: 'FAIL', reason: `Error: ${b.error}` };
      const a = b.answer || '';
      const hasABNB = /abnb|airbnb/i.test(a);
      const hasAnalysis = /risk|disclosure|vague|omission|downplay|red flag|concern|regulatory|hidden/i.test(a);
      const isSubstantive = a.length > 300;
      if (hasABNB && hasAnalysis && isSubstantive) return { grade: 'A', reason: `Provocative analysis (${a.length} chars)` };
      if (hasAnalysis && a.length > 150) return { grade: 'B', reason: `Some analysis (${a.length} chars)` };
      if (a.length > 80) return { grade: 'C', reason: `Thin (${a.length} chars)` };
      return { grade: 'FAIL', reason: `Weak: "${a.substring(0, 120)}"` };
    },
  },
  {
    id: 'Q6',
    name: 'Earnings Call Evolution — NVDA AI Narrative 2022→2024',
    body: { query: 'How has NVIDIA management messaging about AI evolved across their earnings calls from 2022 to 2024? Track changes in confidence, specificity, and strategic emphasis.' },
    evaluate: (b) => {
      if (b.error) return { grade: 'FAIL', reason: `Error: ${b.error}` };
      const a = b.answer || '';
      const hasNVDA = /nvda|nvidia/i.test(a);
      const hasAI = /\bai\b|artificial intelligence|machine learning|deep learning|gpu|data center|generative/i.test(a);
      const hasTemporal = /2022|2023|2024|evolv|shift|change|quarter|year/i.test(a);
      const hasEarnings = /earnings|call|management|ceo|cfo|guidance|outlook|jensen/i.test(a);
      if (hasNVDA && hasAI && hasTemporal && a.length > 400) return { grade: 'A', reason: `Rich AI narrative evolution (${a.length} chars)` };
      if (hasNVDA && hasAI && a.length > 200) return { grade: 'B', reason: `Has AI content (${a.length} chars)` };
      if (a.length > 100) return { grade: 'C', reason: `Thin (${a.length} chars)` };
      return { grade: 'FAIL', reason: `Weak: "${a.substring(0, 120)}"` };
    },
  },
  {
    id: 'Q7',
    name: 'Insider Trading Activity — TSLA Form 4 Transactions',
    body: { query: 'What insider trading activity has occurred at Tesla recently? Show me the largest insider sales and purchases from Form 4 filings.' },
    evaluate: (b) => {
      if (b.error) return { grade: 'FAIL', reason: `Error: ${b.error}` };
      const a = b.answer || '';
      const hasTSLA = /tsla|tesla/i.test(a);
      const hasInsider = /insider|officer|director|form 4|transaction|sold|bought|purchase|sale|shares/i.test(a);
      const hasNames = /musk|kirkhorn|taneja|vaibhav|denholm|baglino/i.test(a);
      // Insider data may not be fully available — grade accordingly
      if (hasTSLA && hasInsider && hasNames && a.length > 300) return { grade: 'A', reason: `Named insiders + transactions (${a.length} chars)` };
      if (hasTSLA && hasInsider && a.length > 200) return { grade: 'B', reason: `Has insider info (${a.length} chars)` };
      if (a.length > 100 && !/no data|no insider|not available/i.test(a)) return { grade: 'C', reason: `Some content (${a.length} chars)` };
      if (/being acquired|will be available/i.test(a)) return { grade: 'C', reason: `Data acquisition triggered (expected for Form 4)` };
      return { grade: 'FAIL', reason: `Weak: "${a.substring(0, 120)}"` };
    },
  },
  {
    id: 'Q8',
    name: 'Governance & Board — AMGN Board Independence + Shareholder Proposals',
    body: { query: 'Describe Amgen board of directors composition, independence, and any shareholder proposals from their latest proxy statement. How does their governance compare to best practices?' },
    evaluate: (b) => {
      if (b.error) return { grade: 'FAIL', reason: `Error: ${b.error}` };
      const a = b.answer || '';
      const hasAMGN = /amgn|amgen/i.test(a);
      const hasBoard = /board|director|independent|governance|committee|chairman|nominee/i.test(a);
      const hasProxy = /proxy|def 14a|shareholder|stockholder|proposal|vote/i.test(a);
      if (hasAMGN && hasBoard && a.length > 300) return { grade: 'A', reason: `Board + governance detail (${a.length} chars)` };
      if (hasBoard && a.length > 150) return { grade: 'B', reason: `Some governance info (${a.length} chars)` };
      if (a.length > 80) return { grade: 'C', reason: `Thin (${a.length} chars)` };
      return { grade: 'FAIL', reason: `Weak: "${a.substring(0, 120)}"` };
    },
  },
  {
    id: 'Q9',
    name: 'Cross-Company R&D — MSFT vs GOOGL vs AMZN R&D as % of Revenue',
    body: { query: 'Compare research and development spending as a percentage of revenue for Microsoft, Google, and Amazon over the last 3 years. Who invests the most in R&D relative to their size?', options: { tickers: ['MSFT', 'GOOGL', 'AMZN'] } },
    evaluate: (b) => {
      if (b.error) return { grade: 'FAIL', reason: `Error: ${b.error}` };
      const a = b.answer || '';
      const companies = ['msft', 'microsoft', 'googl', 'google', 'alphabet', 'amzn', 'amazon'];
      const found = companies.filter(c => a.toLowerCase().includes(c));
      const hasRD = /r&d|research|development|r\s*&\s*d/i.test(a);
      const hasPercent = /\d+\.?\d*%/i.test(a);
      const hasRevenue = /revenue|sales|% of revenue|percentage/i.test(a);
      if (found.length >= 4 && hasRD && hasPercent && a.length > 400) return { grade: 'A', reason: `All 3 companies + R&D % (${a.length} chars)` };
      if (found.length >= 2 && hasRD && a.length > 200) return { grade: 'B', reason: `Partial R&D comparison (${a.length} chars)` };
      if (a.length > 100) return { grade: 'C', reason: `Thin (${a.length} chars)` };
      return { grade: 'FAIL', reason: `Weak: "${a.substring(0, 120)}"` };
    },
  },
  {
    id: 'Q10',
    name: 'Canadian Filer — SHOP 40-F vs 10-K, 6-K Filings',
    body: { query: 'Shopify files as a Canadian company using 40-F instead of 10-K. Summarize their latest annual report key financials, risk factors, and how their disclosure format differs from US filers.' },
    evaluate: (b) => {
      if (b.error) return { grade: 'FAIL', reason: `Error: ${b.error}` };
      const a = b.answer || '';
      const hasSHOP = /shop|shopify/i.test(a);
      const hasCanadian = /canad|40-f|foreign|cross-listed|tsx|6-k/i.test(a);
      const hasFinancials = /revenue|income|growth|margin|gmv|merchant/i.test(a);
      if (hasSHOP && hasFinancials && a.length > 300) return { grade: 'A', reason: `SHOP financials + context (${a.length} chars)` };
      if (hasSHOP && a.length > 150) return { grade: 'B', reason: `Some SHOP info (${a.length} chars)` };
      if (a.length > 80) return { grade: 'C', reason: `Thin (${a.length} chars)` };
      return { grade: 'FAIL', reason: `Weak: "${a.substring(0, 120)}"` };
    },
  },
];

// ─── Runner ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║     RAG QUALITY TEST — 10 COMPLEX QUERIES vs LIVE PRODUCTION         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log(`  Target: ${ALB}`);
  console.log(`  Time:   ${new Date().toISOString()}`);
  console.log('');

  const results = [];
  let gradeCount = { A: 0, B: 0, C: 0, FAIL: 0 };

  for (const q of QUERIES) {
    process.stdout.write(`  ${q.id}: ${q.name} ... `);
    const start = Date.now();
    try {
      const res = await request('POST', '/api/rag/query', q.body);
      const elapsed = Date.now() - start;
      const eval_ = q.evaluate(res.body);
      
      const icon = eval_.grade === 'A' ? '🟢' : eval_.grade === 'B' ? '🟡' : eval_.grade === 'C' ? '🟠' : '🔴';
      console.log(`${icon} ${eval_.grade} (${(elapsed/1000).toFixed(1)}s) — ${eval_.reason}`);
      
      gradeCount[eval_.grade]++;
      results.push({
        id: q.id,
        name: q.name,
        grade: eval_.grade,
        reason: eval_.reason,
        latency: elapsed,
        status: res.status,
        answerLength: (res.body.answer || '').length,
        metricsCount: (res.body.metrics || []).length,
        narrativesCount: (res.body.narratives || []).length,
        citationsCount: (res.body.citations || []).length,
        answerPreview: (res.body.answer || '').substring(0, 300),
        processingInfo: res.body.processingInfo,
      });
    } catch (err) {
      console.log(`🔴 FAIL — ${err.message}`);
      gradeCount.FAIL++;
      results.push({ id: q.id, name: q.name, grade: 'FAIL', reason: err.message, latency: Date.now() - start });
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  🟢 A: ${gradeCount.A}   🟡 B: ${gradeCount.B}   🟠 C: ${gradeCount.C}   🔴 FAIL: ${gradeCount.FAIL}`);
  console.log(`  Total: ${QUERIES.length} queries`);
  
  const avgLatency = results.reduce((s, r) => s + (r.latency || 0), 0) / results.length;
  console.log(`  Avg latency: ${(avgLatency/1000).toFixed(1)}s`);
  console.log('');

  // ─── Detailed Results ────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  DETAILED RESULTS');
  console.log('═══════════════════════════════════════════════════════════════════════');
  for (const r of results) {
    console.log('');
    console.log(`  ── ${r.id}: ${r.name} ──`);
    console.log(`     Grade: ${r.grade} | Latency: ${(r.latency/1000).toFixed(1)}s | Status: ${r.status}`);
    console.log(`     Metrics: ${r.metricsCount || 0} | Narratives: ${r.narrativesCount || 0} | Citations: ${r.citationsCount || 0} | Answer: ${r.answerLength || 0} chars`);
    if (r.processingInfo) {
      const pi = r.processingInfo;
      console.log(`     Model: ${pi.modelTier || 'unknown'} | Cache: ${pi.fromCache ? 'HIT' : 'MISS'} | Bedrock KB: ${pi.usedBedrockKB ? 'YES' : 'NO'} | Claude: ${pi.usedClaudeGeneration ? 'YES' : 'NO'}`);
    }
    console.log(`     Reason: ${r.reason}`);
    if (r.answerPreview) {
      console.log(`     Preview: "${r.answerPreview.replace(/\n/g, ' ').substring(0, 200)}..."`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════');
  
  // Exit with non-zero if any FAIL
  if (gradeCount.FAIL > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
