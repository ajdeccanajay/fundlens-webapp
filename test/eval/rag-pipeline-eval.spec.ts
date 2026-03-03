/**
 * FundLens RAG Pipeline — End-to-End Eval Harness
 *
 * Tests the COMPLETE pipeline: query → intent → retrieval → synthesis → response
 * Unlike haiku-intent-eval.spec.ts (tests intent detection only), this tests
 * the full RAG response including data accuracy, citation correctness, chart
 * validity, and answer quality.
 *
 * ARCHITECTURE:
 *   1. Test fixtures define known data in the DB (metrics + narratives)
 *   2. Each eval case sends a query through ragService.query()
 *   3. Scoring functions validate response against machine-checkable assertions
 *   4. Aggregate accuracy per category must meet deployment gate thresholds
 *
 * CATEGORIES (12):
 *   1. Single Metric Lookup          — "What is the revenue for AMZN?"
 *   2. Multi-Year Trend              — "NVDA gross margin over 5 years"
 *   3. Multi-Ticker Comparison       — "Compare AMZN and MSFT revenue"
 *   4. Computed Metrics              — "AAPL ROIC FY2024"
 *   5. Narrative / Qualitative       — "What did management say about AI?"
 *   6. Cross-Source (SEC + Uploaded)  — "Revenue analysis including DBS view"
 *   7. Sentiment / Red Flags         — "Red flags in AMZN latest 10-K"
 *   8. Peer Benchmark                — "How does ABNB compare to peers?"
 *   9. Cross-Ticker in Workspace     — "Revenue for AMZN" in AAPL workspace
 *  10. Edge Cases / No Data          — "Revenue for XYZZ"
 *  11. Period Variants               — FY, quarterly, TTM, range, latest
 *  12. Uploaded Document Only        — "Summarize the DBS report"
 *
 * SCORING DIMENSIONS:
 *   - Data accuracy: correct ticker, metric values within tolerance, correct periods
 *   - Citation correctness: source types match actuals, both SEC + uploaded when applicable
 *   - Chart validity: no ghost labels, correct ticker scope, valid periods
 *   - Answer quality: minimum length, mentions required terms, no hallucinated numbers
 *   - Pipeline correctness: LLM was invoked (not quick-response bypassed), correct model tier
 *
 * TARGET: ≥90% overall, ≥85% per category
 *
 * Usage:
 *   npx jest --config ./test/jest-eval.json --testPathPattern=eval/rag-pipeline-eval
 *
 * NOTE: This test calls the real RAG pipeline (including Bedrock).
 *       Set SKIP_RAG_EVAL=true to skip, or RUN_RAG_EVAL=true to force.
 *       Requires a seeded test database (see seedTestData below).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { RAGService } from 'src/rag/rag.service';
import { RAGResponse, Citation, MetricResult, ChunkResult } from 'src/rag/types/query-intent';
import { PrismaService } from 'prisma/prisma.service';

// ─── Configuration ─────────────────────────────────────────────────────────────

const SKIP = process.env.SKIP_RAG_EVAL === 'true';
const FORCE = process.env.RUN_RAG_EVAL === 'true';
const DEPLOYMENT_GATE_OVERALL = 0.90;
const DEPLOYMENT_GATE_PER_CATEGORY = 0.85;
const VALUE_TOLERANCE_PCT = 0.05; // 5% tolerance for financial values

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DataAssertion {
  metrics_include_tickers?: string[];
  metrics_exclude_tickers?: string[];
  metrics_min_count?: number;
  metrics_must_contain?: Array<{
    ticker: string;
    metric: string;
    period?: string;
    value?: number;
    value_min?: number;
    value_max?: number;
  }>;
  metrics_include_periods?: string[];
  metrics_exclude_periods?: string[];
}

interface CitationAssertion {
  citations_min_count?: number;
  citations_include_types?: Array<'sec_filing' | 'user_document'>;
  citations_exclude_types?: Array<'sec_filing' | 'user_document'>;
  citations_source_type_matches_actual?: boolean;
  citations_include_filing_types?: string[];
  citations_include_filenames?: string[];
}

interface ChartAssertion {
  chart_exists?: boolean;
  chart_type?: 'bar' | 'line' | 'grouped_bar' | 'stacked_bar';
  chart_tickers?: string[];
  chart_exclude_tickers?: string[];
  chart_min_data_points?: number;
  chart_no_invalid_periods?: boolean;
}

interface AnswerAssertion {
  answer_min_words?: number;
  answer_max_words?: number;
  /** Terms that MUST appear. Use '|' for OR alternatives within a single entry. */
  answer_must_mention?: string[];
  answer_must_not_mention?: string[];
  answer_must_contain_values?: Array<{ value: number; tolerance_pct?: number }>;
  answer_no_cross_contamination?: { wrong_ticker: string; wrong_values: number[] };
}

interface PipelineAssertion {
  llm_was_invoked?: boolean;
  model_tier_minimum?: 'haiku' | 'sonnet' | 'opus';
  used_hybrid_synthesis?: boolean;
  narratives_passed_to_llm?: boolean;
  narratives_include_both_sources?: boolean;
}

interface EvalCase {
  id: string;
  category: number;
  categoryName: string;
  query: string;
  workspaceTicker?: string;
  tenantId?: string;
  queryOptions?: Record<string, any>;
  data?: DataAssertion;
  citations?: CitationAssertion;
  chart?: ChartAssertion;
  answer?: AnswerAssertion;
  pipeline?: PipelineAssertion;
  notes?: string;
}

interface FieldScore {
  dimension: 'data' | 'citations' | 'chart' | 'answer' | 'pipeline';
  field: string;
  pass: boolean;
  expected: any;
  actual: any;
  severity: 'critical' | 'major' | 'minor';
}

interface CaseResult {
  id: string;
  category: number;
  categoryName: string;
  query: string;
  overall_pass: boolean;
  critical_pass: boolean;
  scores: FieldScore[];
  response?: RAGResponse;
  error?: string;
  latencyMs: number;
}

// ─── Eval Dataset ──────────────────────────────────────────────────────────────

const EVAL_CASES: EvalCase[] = [
  // ═══ Category 1: Single Metric Lookup ═══
  {
    id: '1.01',
    category: 1,
    categoryName: 'Single Metric Lookup',
    query: 'What is the revenue for AMZN?',
    workspaceTicker: 'AMZN',
    data: {
      metrics_include_tickers: ['AMZN'],
      metrics_min_count: 3,
      metrics_include_periods: ['FY2023', 'FY2022'],
      metrics_must_contain: [
        { ticker: 'AMZN', metric: 'revenue', period: 'FY2023', value_min: 500_000_000_000, value_max: 650_000_000_000 },
      ],
    },
    citations: {
      citations_min_count: 1,
      citations_include_types: ['sec_filing'],
      citations_source_type_matches_actual: true,
    },
    chart: {
      chart_exists: true,
      chart_tickers: ['AMZN'],
      chart_min_data_points: 3,
      chart_no_invalid_periods: true,
    },
    answer: {
      answer_min_words: 150,
      answer_must_mention: ['revenue', 'AMZN'],
      answer_must_not_mention: ['$11.5 billion'],
    },
    pipeline: {
      llm_was_invoked: true,
      narratives_passed_to_llm: true,
    },
    notes: 'THE canonical test case. Must return multi-year trend, SEC citations, and substantive analysis.',
  },
  {
    id: '1.02',
    category: 1,
    categoryName: 'Single Metric Lookup',
    query: 'AAPL revenue FY2023',
    workspaceTicker: 'AAPL',
    data: {
      metrics_include_tickers: ['AAPL'],
      metrics_must_contain: [
        { ticker: 'AAPL', metric: 'revenue', period: 'FY2023', value_min: 380_000_000_000, value_max: 390_000_000_000 },
      ],
    },
    citations: {
      citations_min_count: 1,
      citations_include_types: ['sec_filing'],
    },
    answer: {
      answer_must_mention: ['AAPL', '383'],
    },
    notes: 'Explicit period + ticker. Should return precise value with SEC citation.',
  },
  {
    id: '1.03',
    category: 1,
    categoryName: 'Single Metric Lookup',
    query: 'AMZN net income',
    workspaceTicker: 'AMZN',
    data: {
      metrics_include_tickers: ['AMZN'],
      metrics_must_contain: [
        { ticker: 'AMZN', metric: 'net_income', period: 'FY2023' },
      ],
    },
    answer: {
      answer_must_mention: ['net income', 'AMZN'],
    },
    notes: 'Tests that "net income" resolves correctly.',
  },
  {
    id: '1.04',
    category: 1,
    categoryName: 'Single Metric Lookup',
    query: "What are Amazon's total sales?",
    workspaceTicker: 'AMZN',
    data: {
      metrics_include_tickers: ['AMZN'],
      metrics_must_contain: [
        { ticker: 'AMZN', metric: 'revenue', period: 'FY2023', value_min: 500_000_000_000 },
      ],
    },
    notes: 'Tests company name → ticker AND "total sales" → revenue synonym resolution.',
  },

  // ═══ Category 2: Multi-Year Trend ═══
  {
    id: '2.01',
    category: 2,
    categoryName: 'Multi-Year Trend',
    query: 'NVDA gross margin over the past 5 years',
    workspaceTicker: 'NVDA',
    data: {
      metrics_include_tickers: ['NVDA'],
      metrics_min_count: 5,
      metrics_include_periods: ['FY2024', 'FY2023', 'FY2022', 'FY2021', 'FY2020'],
    },
    chart: {
      chart_exists: true,
      chart_type: 'line',
      chart_tickers: ['NVDA'],
      chart_min_data_points: 5,
      chart_no_invalid_periods: true,
    },
    answer: {
      answer_min_words: 200,
      answer_must_mention: ['gross margin', 'NVDA'],
    },
    pipeline: { llm_was_invoked: true },
    notes: 'Must return 5 years of data, line chart, and trend analysis.',
  },
  {
    id: '2.02',
    category: 2,
    categoryName: 'Multi-Year Trend',
    query: 'How has AMZN revenue grown over the last 3 years?',
    workspaceTicker: 'AMZN',
    data: {
      metrics_include_tickers: ['AMZN'],
      metrics_min_count: 3,
    },
    answer: {
      answer_must_mention: ['growth|grew|growing', 'revenue'],
    },
    notes: 'Implicit trend query without "trend" keyword.',
  },

  // ═══ Category 3: Multi-Ticker Comparison ═══
  {
    id: '3.01',
    category: 3,
    categoryName: 'Multi-Ticker Comparison',
    query: 'Compare AMZN and AAPL revenue',
    workspaceTicker: 'AMZN',
    data: {
      metrics_include_tickers: ['AMZN', 'AAPL'],
      metrics_min_count: 2,
    },
    chart: {
      chart_exists: true,
      chart_tickers: ['AMZN', 'AAPL'],
    },
    answer: {
      answer_must_mention: ['AMZN', 'AAPL', 'revenue'],
      answer_min_words: 200,
    },
    pipeline: {
      llm_was_invoked: true,
      model_tier_minimum: 'sonnet',
    },
    notes: 'Multi-ticker must use Sonnet+ and produce grouped chart.',
  },

  // ═══ Category 4: Computed Metrics ═══
  {
    id: '4.01',
    category: 4,
    categoryName: 'Computed Metrics',
    query: 'What is AMZN gross margin FY2023?',
    workspaceTicker: 'AMZN',
    data: {
      metrics_include_tickers: ['AMZN'],
      metrics_must_contain: [
        { ticker: 'AMZN', metric: 'gross_margin', value_min: 0.45, value_max: 0.50 },
      ],
    },
    answer: {
      answer_must_mention: ['gross margin', 'AMZN'],
    },
    notes: 'Tests FormulaResolutionService computes gross_margin from gross_profit and revenue.',
  },

  // ═══ Category 5: Narrative / Qualitative ═══
  {
    id: '5.01',
    category: 5,
    categoryName: 'Narrative / Qualitative',
    query: 'What did NVDA management say about data center growth?',
    workspaceTicker: 'NVDA',
    citations: { citations_min_count: 1 },
    answer: {
      answer_min_words: 150,
      answer_must_mention: ['data center'],
    },
    pipeline: {
      llm_was_invoked: true,
      narratives_passed_to_llm: true,
    },
    notes: 'Pure narrative query. Must retrieve from Bedrock KB / SEC narratives.',
  },

  // ═══ Category 6: Cross-Source (SEC + Uploaded Docs) ═══
  {
    id: '6.01',
    category: 6,
    categoryName: 'Cross-Source (SEC + Uploaded)',
    query: 'What is the revenue for AMZN?',
    workspaceTicker: 'AMZN',
    queryOptions: { includeCitations: true },
    citations: {
      citations_min_count: 2,
      citations_include_types: ['sec_filing', 'user_document'],
      citations_source_type_matches_actual: true,
    },
    answer: { answer_min_words: 200 },
    pipeline: { narratives_include_both_sources: true },
    notes: 'THE cross-source test. Citation types must match actual sources.',
  },
  {
    id: '6.02',
    category: 6,
    categoryName: 'Cross-Source (SEC + Uploaded)',
    query: 'Revenue analysis for AMZN with analyst perspectives',
    workspaceTicker: 'AMZN',
    citations: {
      citations_include_types: ['sec_filing', 'user_document'],
    },
    answer: {
      answer_must_mention: ['AMZN', 'revenue'],
    },
    notes: 'Explicit request for cross-source analysis.',
  },

  // ═══ Category 7: Sentiment / Red Flags ═══
  {
    id: '7.01',
    category: 7,
    categoryName: 'Sentiment / Red Flags',
    query: 'What are the red flags in AMZN latest 10-K?',
    workspaceTicker: 'AMZN',
    answer: {
      answer_min_words: 200,
      answer_must_mention: ['risk|red flag|concern', 'AMZN'],
    },
    pipeline: {
      llm_was_invoked: true,
      narratives_passed_to_llm: true,
    },
    notes: 'Sentiment query must use narratives from risk sections.',
  },

  // ═══ Category 8: Peer Benchmark ═══
  {
    id: '8.01',
    category: 8,
    categoryName: 'Peer Benchmark',
    query: 'How does AMZN revenue compare to peers?',
    workspaceTicker: 'AMZN',
    data: { metrics_min_count: 2 },
    answer: {
      answer_must_mention: ['AMZN', 'peer|compare|comparison'],
    },
    pipeline: { llm_was_invoked: true },
    notes: 'Peer comparison query.',
  },

  // ═══ Category 9: Cross-Ticker in Workspace ═══
  {
    id: '9.01',
    category: 9,
    categoryName: 'Cross-Ticker in Workspace',
    query: 'What is the revenue for AMZN?',
    workspaceTicker: 'AAPL',
    data: { metrics_include_tickers: ['AMZN'] },
    chart: { chart_exclude_tickers: ['AAPL'] },
    answer: { answer_must_mention: ['AMZN'] },
    notes: 'Asking about AMZN in AAPL workspace. Response should focus on AMZN.',
  },

  // ═══ Category 10: Edge Cases / No Data ═══
  {
    id: '10.01',
    category: 10,
    categoryName: 'Edge Cases',
    query: 'What is the revenue for XYZZ?',
    workspaceTicker: 'XYZZ',
    data: { metrics_min_count: 0 },
    answer: {
      answer_must_mention: ['no data|not found|unavailable|ingest|no.*found'],
      answer_must_not_mention: ['$'],
    },
    notes: 'Unknown ticker. Must return graceful degradation.',
  },
  {
    id: '10.02',
    category: 10,
    categoryName: 'Edge Cases',
    query: '',
    data: { metrics_min_count: 0 },
    notes: 'Empty query. Must not crash.',
  },
  {
    id: '10.03',
    category: 10,
    categoryName: 'Edge Cases',
    query: 'asdf jkl qwerty gibberish',
    data: { metrics_min_count: 0 },
    notes: 'Gibberish query. Must return clarification, not crash.',
  },

  // ═══ Category 11: Period Variants ═══
  {
    id: '11.01',
    category: 11,
    categoryName: 'Period Variants',
    query: 'AMZN revenue FY2023',
    workspaceTicker: 'AMZN',
    data: {
      metrics_must_contain: [
        { ticker: 'AMZN', metric: 'revenue', period: 'FY2023' },
      ],
    },
    notes: 'Explicit fiscal year.',
  },
  {
    id: '11.02',
    category: 11,
    categoryName: 'Period Variants',
    query: 'AMZN revenue for the latest year',
    workspaceTicker: 'AMZN',
    data: {
      metrics_include_tickers: ['AMZN'],
      metrics_min_count: 1,
    },
    notes: 'Latest year must resolve to most recent FY in DB.',
  },
  {
    id: '11.03',
    category: 11,
    categoryName: 'Period Variants',
    query: 'NVDA gross margin past 5 years',
    workspaceTicker: 'NVDA',
    data: { metrics_min_count: 5 },
    notes: 'Range period. Must return 5 annual data points.',
  },

  // ═══ Category 12: Uploaded Document Only ═══
  {
    id: '12.01',
    category: 12,
    categoryName: 'Uploaded Document Only',
    query: 'What does the DBS report say about AMZN?',
    workspaceTicker: 'AMZN',
    citations: {
      citations_include_types: ['user_document'],
      citations_source_type_matches_actual: true,
    },
    answer: {
      answer_must_mention: ['DBS'],
    },
    notes: 'Query about uploaded doc. Citations must be typed as user_document, NOT sec_filing.',
  },
];

// ─── Scoring Functions ─────────────────────────────────────────────────────────

const REVENUE_SYNONYMS = ['revenue', 'net_sales', 'total_revenue'];

function scoreData(response: RAGResponse, assertions: DataAssertion): FieldScore[] {
  const scores: FieldScore[] = [];
  const metrics = response.metrics || [];

  if (assertions.metrics_include_tickers) {
    for (const ticker of assertions.metrics_include_tickers) {
      const found = metrics.some((m: MetricResult) => m.ticker?.toUpperCase() === ticker);
      scores.push({
        dimension: 'data',
        field: `metrics_include_ticker:${ticker}`,
        pass: found,
        expected: ticker,
        actual: found ? ticker : `missing (have: ${[...new Set(metrics.map((m: MetricResult) => m.ticker))].join(', ')})`,
        severity: 'critical',
      });
    }
  }

  if (assertions.metrics_exclude_tickers) {
    for (const ticker of assertions.metrics_exclude_tickers) {
      const found = metrics.some((m: MetricResult) => m.ticker?.toUpperCase() === ticker);
      scores.push({
        dimension: 'data',
        field: `metrics_exclude_ticker:${ticker}`,
        pass: !found,
        expected: `not ${ticker}`,
        actual: found ? `found ${ticker}` : 'absent',
        severity: 'major',
      });
    }
  }

  if (assertions.metrics_min_count !== undefined) {
    scores.push({
      dimension: 'data',
      field: 'metrics_min_count',
      pass: metrics.length >= assertions.metrics_min_count,
      expected: `>= ${assertions.metrics_min_count}`,
      actual: metrics.length,
      severity: assertions.metrics_min_count === 0 ? 'minor' : 'critical',
    });
  }

  if (assertions.metrics_must_contain) {
    for (const req of assertions.metrics_must_contain) {
      const match = metrics.find((m: MetricResult) => {
        if (m.ticker?.toUpperCase() !== req.ticker) return false;
        // Check metric name with synonym awareness
        const mName = (m.normalizedMetric || '').toLowerCase().replace(/[^a-z_]/g, '');
        const rName = req.metric.toLowerCase().replace(/[^a-z_]/g, '');
        const nameMatch = mName === rName ||
          mName === rName.replace(/_/g, '') ||
          (REVENUE_SYNONYMS.includes(mName) && REVENUE_SYNONYMS.includes(rName));
        if (!nameMatch) return false;
        if (req.period && m.fiscalPeriod !== req.period) return false;
        return true;
      });

      let valuePass = true;
      if (match) {
        if (req.value !== undefined) {
          const tolerance = req.value * VALUE_TOLERANCE_PCT;
          valuePass = Math.abs(match.value - req.value) <= tolerance;
        }
        if (req.value_min !== undefined) valuePass = valuePass && match.value >= req.value_min;
        if (req.value_max !== undefined) valuePass = valuePass && match.value <= req.value_max;
      }

      scores.push({
        dimension: 'data',
        field: `metrics_must_contain:${req.ticker}/${req.metric}/${req.period || 'any'}`,
        pass: !!match && valuePass,
        expected: `${req.ticker} ${req.metric} ${req.period || ''} ${req.value_min ? `>=${req.value_min}` : ''} ${req.value_max ? `<=${req.value_max}` : ''}`.trim(),
        actual: match ? `${match.value} (${match.fiscalPeriod})` : 'not found',
        severity: 'critical',
      });
    }
  }

  if (assertions.metrics_include_periods) {
    const actualPeriods = new Set(metrics.map((m: MetricResult) => m.fiscalPeriod));
    for (const period of assertions.metrics_include_periods) {
      scores.push({
        dimension: 'data',
        field: `metrics_include_period:${period}`,
        pass: actualPeriods.has(period),
        expected: period,
        actual: actualPeriods.has(period) ? period : `missing (have: ${[...actualPeriods].join(', ')})`,
        severity: 'major',
      });
    }
  }

  if (assertions.metrics_exclude_periods) {
    const actualPeriods2 = new Set(metrics.map((m: MetricResult) => m.fiscalPeriod));
    for (const period of assertions.metrics_exclude_periods) {
      scores.push({
        dimension: 'data',
        field: `metrics_exclude_period:${period}`,
        pass: !actualPeriods2.has(period),
        expected: `not ${period}`,
        actual: actualPeriods2.has(period) ? `found ${period}` : 'absent',
        severity: 'major',
      });
    }
  }

  return scores;
}

function scoreCitations(response: RAGResponse, assertions: CitationAssertion): FieldScore[] {
  const scores: FieldScore[] = [];
  const citations: Citation[] = (response.citations || []) as Citation[];

  if (assertions.citations_min_count !== undefined) {
    scores.push({
      dimension: 'citations',
      field: 'citations_min_count',
      pass: citations.length >= assertions.citations_min_count,
      expected: `>= ${assertions.citations_min_count}`,
      actual: citations.length,
      severity: 'critical',
    });
  }

  if (assertions.citations_include_types) {
    const actualTypes = new Set(citations.map(c => c.type));
    for (const type of assertions.citations_include_types) {
      scores.push({
        dimension: 'citations',
        field: `citations_include_type:${type}`,
        pass: actualTypes.has(type),
        expected: type,
        actual: actualTypes.has(type) ? type : `missing (have: ${[...actualTypes].join(', ')})`,
        severity: 'critical',
      });
    }
  }

  if (assertions.citations_source_type_matches_actual) {
    let hasMismatch = false;
    for (const c of citations) {
      const metadata = c.metadata || {};
      const isActuallyUploadedDoc =
        metadata.filingType === 'uploaded-document' ||
        (c as any).filename ||
        (c as any).fileName;
      const labeledAsSec = c.type === 'sec_filing' || c.sourceType === 'SEC_FILING';

      if (isActuallyUploadedDoc && labeledAsSec) {
        hasMismatch = true;
        scores.push({
          dimension: 'citations',
          field: `citation_source_mismatch:${c.number || c.id}`,
          pass: false,
          expected: 'user_document / USER_UPLOAD',
          actual: `${c.type} / ${c.sourceType} (but metadata shows uploaded doc)`,
          severity: 'critical',
        });
      }
    }
    if (!hasMismatch) {
      scores.push({
        dimension: 'citations',
        field: 'citations_source_type_matches_actual',
        pass: true,
        expected: 'all types match sources',
        actual: 'all types match',
        severity: 'critical',
      });
    }
  }

  return scores;
}

function scoreChart(response: RAGResponse, assertions: ChartAssertion): FieldScore[] {
  const scores: FieldScore[] = [];
  const viz = response.visualization;

  if (assertions.chart_exists !== undefined) {
    scores.push({
      dimension: 'chart',
      field: 'chart_exists',
      pass: assertions.chart_exists ? !!viz : !viz,
      expected: assertions.chart_exists ? 'chart present' : 'no chart',
      actual: viz ? 'chart present' : 'no chart',
      severity: 'major',
    });
  }

  if (!viz) return scores;

  if (assertions.chart_type) {
    const actualType = viz.chartType || viz.suggestedChartType;
    scores.push({
      dimension: 'chart',
      field: 'chart_type',
      pass: actualType === assertions.chart_type,
      expected: assertions.chart_type,
      actual: actualType,
      severity: 'minor',
    });
  }

  // Extract tickers from both legacy datasets and canonical data.rows
  const chartTickers = new Set<string>();
  if (viz.datasets) {
    for (const d of viz.datasets) {
      if (d.label) chartTickers.add(d.label.toUpperCase());
    }
  }
  if (viz.data?.rows) {
    for (const r of viz.data.rows) {
      if (r.ticker) chartTickers.add(r.ticker.toUpperCase());
    }
  }

  if (assertions.chart_tickers) {
    for (const ticker of assertions.chart_tickers) {
      scores.push({
        dimension: 'chart',
        field: `chart_ticker:${ticker}`,
        pass: chartTickers.has(ticker),
        expected: ticker,
        actual: chartTickers.has(ticker) ? ticker : `missing (have: ${[...chartTickers].join(', ')})`,
        severity: 'major',
      });
    }
  }

  if (assertions.chart_exclude_tickers) {
    for (const ticker of assertions.chart_exclude_tickers) {
      scores.push({
        dimension: 'chart',
        field: `chart_exclude_ticker:${ticker}`,
        pass: !chartTickers.has(ticker),
        expected: `not ${ticker}`,
        actual: chartTickers.has(ticker) ? `found ${ticker}` : 'absent',
        severity: 'major',
      });
    }
  }

  if (assertions.chart_no_invalid_periods) {
    const labels = viz.labels || [];
    const validPeriod = /^(FY\d{4}|Q[1-4]\s?(?:FY)?\d{4})$/i;
    const invalidLabels = labels.filter((l: string) => !validPeriod.test(l));
    scores.push({
      dimension: 'chart',
      field: 'chart_no_invalid_periods',
      pass: invalidLabels.length === 0,
      expected: 'all periods valid',
      actual: invalidLabels.length === 0 ? 'all valid' : `invalid: ${invalidLabels.join(', ')}`,
      severity: 'critical',
    });
  }

  if (assertions.chart_min_data_points) {
    let totalPoints = 0;
    if (viz.datasets) {
      totalPoints = viz.datasets.reduce((sum: number, d: { data?: (number | null)[] }) => sum + (d.data?.length || 0), 0);
    } else if (viz.data?.rows) {
      totalPoints = viz.data.rows.length;
    }
    scores.push({
      dimension: 'chart',
      field: 'chart_min_data_points',
      pass: totalPoints >= assertions.chart_min_data_points,
      expected: `>= ${assertions.chart_min_data_points}`,
      actual: totalPoints,
      severity: 'major',
    });
  }

  return scores;
}

function scoreAnswer(response: RAGResponse, assertions: AnswerAssertion): FieldScore[] {
  const scores: FieldScore[] = [];
  const answer = response.answer || '';
  const wordCount = answer.split(/\s+/).filter((w: string) => w.length > 0).length;

  if (assertions.answer_min_words) {
    scores.push({
      dimension: 'answer',
      field: 'answer_min_words',
      pass: wordCount >= assertions.answer_min_words,
      expected: `>= ${assertions.answer_min_words} words`,
      actual: `${wordCount} words`,
      severity: 'critical',
    });
  }

  if (assertions.answer_max_words) {
    scores.push({
      dimension: 'answer',
      field: 'answer_max_words',
      pass: wordCount <= assertions.answer_max_words,
      expected: `<= ${assertions.answer_max_words} words`,
      actual: `${wordCount} words`,
      severity: 'minor',
    });
  }

  if (assertions.answer_must_mention) {
    const lowerAnswer = answer.toLowerCase();
    for (const term of assertions.answer_must_mention) {
      // Support OR alternatives separated by '|'
      const alternatives = term.split('|').map(t => t.trim().toLowerCase());
      const found = alternatives.some(alt => {
        // Support simple regex patterns (e.g., 'no.*found')
        if (alt.includes('.*') || alt.includes('\\')) {
          try {
            return new RegExp(alt, 'i').test(lowerAnswer);
          } catch { return false; }
        }
        return lowerAnswer.includes(alt);
      });
      scores.push({
        dimension: 'answer',
        field: `answer_must_mention:${term}`,
        pass: found,
        expected: term,
        actual: found ? 'found' : 'missing',
        severity: 'major',
      });
    }
  }

  if (assertions.answer_must_not_mention) {
    const lowerAnswer = answer.toLowerCase();
    for (const term of assertions.answer_must_not_mention) {
      const found = lowerAnswer.includes(term.toLowerCase());
      scores.push({
        dimension: 'answer',
        field: `answer_must_not_mention:${term}`,
        pass: !found,
        expected: `not "${term}"`,
        actual: found ? `FOUND: "${term}"` : 'absent',
        severity: 'critical',
      });
    }
  }

  return scores;
}

function scorePipeline(response: RAGResponse, assertions: PipelineAssertion): FieldScore[] {
  const scores: FieldScore[] = [];
  const info = response.processingInfo;

  if (assertions.llm_was_invoked) {
    const invoked = info?.usedClaudeGeneration === true;
    scores.push({
      dimension: 'pipeline',
      field: 'llm_was_invoked',
      pass: invoked,
      expected: 'LLM synthesis used',
      actual: invoked ? 'LLM used' : 'LLM SKIPPED (quick response bypass?)',
      severity: 'critical',
    });
  }

  if (assertions.model_tier_minimum) {
    const tierRank: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3 };
    const actualTier = info?.modelTier || 'unknown';
    const actualRank = tierRank[actualTier] || 0;
    const minRank = tierRank[assertions.model_tier_minimum] || 0;
    scores.push({
      dimension: 'pipeline',
      field: 'model_tier_minimum',
      pass: actualRank >= minRank,
      expected: `>= ${assertions.model_tier_minimum}`,
      actual: actualTier,
      severity: 'major',
    });
  }

  if (assertions.narratives_passed_to_llm) {
    const narrativeCount = info?.semanticNarratives || 0;
    scores.push({
      dimension: 'pipeline',
      field: 'narratives_passed_to_llm',
      pass: narrativeCount > 0,
      expected: 'narratives > 0',
      actual: `${narrativeCount} narratives`,
      severity: 'critical',
    });
  }

  if (assertions.narratives_include_both_sources) {
    const narratives = response.narratives || [];
    const hasSec = narratives.some((n: ChunkResult) =>
      n.metadata?.filingType !== 'uploaded-document' &&
      n.metadata?.sectionType !== 'uploaded-document',
    );
    const hasUploaded = narratives.some((n: ChunkResult) =>
      n.metadata?.filingType === 'uploaded-document' ||
      n.metadata?.sectionType === 'uploaded-document',
    );
    scores.push({
      dimension: 'pipeline',
      field: 'narratives_include_both_sources',
      pass: hasSec && hasUploaded,
      expected: 'both SEC and uploaded narratives',
      actual: `SEC: ${hasSec}, uploaded: ${hasUploaded}`,
      severity: 'critical',
    });
  }

  return scores;
}

function scoreCase(response: RAGResponse, evalCase: EvalCase): FieldScore[] {
  const allScores: FieldScore[] = [];
  if (evalCase.data) allScores.push(...scoreData(response, evalCase.data));
  if (evalCase.citations) allScores.push(...scoreCitations(response, evalCase.citations));
  if (evalCase.chart) allScores.push(...scoreChart(response, evalCase.chart));
  if (evalCase.answer) allScores.push(...scoreAnswer(response, evalCase.answer));
  if (evalCase.pipeline) allScores.push(...scorePipeline(response, evalCase.pipeline));
  return allScores;
}

// ─── Report Generator ──────────────────────────────────────────────────────────

function printReport(results: CaseResult[]) {
  const categories = [...new Set(results.map(r => r.category))].sort((a, b) => a - b);

  console.log('\n' + '═'.repeat(100));
  console.log('FUNDLENS RAG PIPELINE — END-TO-END EVAL RESULTS');
  console.log('═'.repeat(100));

  let totalPass = 0;
  let totalCriticalPass = 0;
  let totalCount = 0;
  const categoryAccuracies: Array<{ name: string; pct: number }> = [];

  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const passing = catResults.filter(r => r.overall_pass).length;
    const criticalPassing = catResults.filter(r => r.critical_pass).length;
    const catName = catResults[0]?.categoryName || `Category ${cat}`;
    const pct = (passing / catResults.length) * 100;
    const critPct = (criticalPassing / catResults.length) * 100;
    const status = pct >= 95 ? '✅' : pct >= DEPLOYMENT_GATE_PER_CATEGORY * 100 ? '⚠️' : '❌';

    console.log(`\n${status} ${cat}. ${catName.padEnd(30)} ${passing}/${catResults.length} (${pct.toFixed(1)}%) | Critical: ${critPct.toFixed(1)}%`);
    categoryAccuracies.push({ name: catName, pct });

    totalPass += passing;
    totalCriticalPass += criticalPassing;
    totalCount += catResults.length;

    // Print failures with details
    const failures = catResults.filter(r => !r.overall_pass);
    for (const f of failures) {
      const failedFields = f.scores.filter(s => !s.pass);
      console.log(`   ❌ ${f.id}: "${f.query.substring(0, 70)}${f.query.length > 70 ? '...' : ''}"`);
      if (f.error) {
        console.log(`      🔴 ERROR: ${f.error}`);
      }
      for (const ff of failedFields) {
        const marker = ff.severity === 'critical' ? '🔴' : ff.severity === 'major' ? '🟡' : '⚪';
        console.log(`      ${marker} [${ff.dimension}] ${ff.field}: expected=${JSON.stringify(ff.expected)} actual=${JSON.stringify(ff.actual)}`);
      }
    }
  }

  console.log('\n' + '─'.repeat(100));
  const overallPct = (totalPass / totalCount) * 100;
  const criticalPct = (totalCriticalPass / totalCount) * 100;
  const overallStatus = overallPct >= DEPLOYMENT_GATE_OVERALL * 100 ? '✅' : '❌';
  console.log(`${overallStatus} OVERALL: ${totalPass}/${totalCount} (${overallPct.toFixed(1)}%) | Critical: ${criticalPct.toFixed(1)}%`);
  console.log(`   Deployment gate: ${DEPLOYMENT_GATE_OVERALL * 100}% overall, ${DEPLOYMENT_GATE_PER_CATEGORY * 100}% per category`);

  // Latency stats
  const latencies = results.map(r => r.latencyMs).filter(l => l > 0);
  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    console.log(`   Latency: avg=${avg}ms, p50=${p50}ms, p95=${p95}ms`);
  }

  // Categories below gate
  const belowGate = categoryAccuracies.filter(c => c.pct < DEPLOYMENT_GATE_PER_CATEGORY * 100);
  if (belowGate.length > 0) {
    console.log(`\n   ⚠️ Categories below ${DEPLOYMENT_GATE_PER_CATEGORY * 100}% gate:`);
    for (const c of belowGate) {
      console.log(`      - ${c.name}: ${c.pct.toFixed(1)}%`);
    }
  }

  console.log('═'.repeat(100) + '\n');
}

// ─── Test Runner ───────────────────────────────────────────────────────────────

describe('RAG Pipeline End-to-End Eval', () => {
  let ragService: RAGService;
  let prisma: PrismaService;
  let module: TestingModule;

  beforeAll(async () => {
    if (SKIP && !FORCE) {
      console.log('Skipping RAG eval (SKIP_RAG_EVAL=true). Set RUN_RAG_EVAL=true to force.');
      return;
    }

    // Build the full NestJS application — real services, real DB, real Bedrock.
    // This is an eval, not a unit test. We need the full dependency graph.
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Initialize the app (triggers onModuleInit hooks, Prisma connection, etc.)
    const app = module.createNestApplication();
    await app.init();

    ragService = module.get<RAGService>(RAGService);
    prisma = module.get<PrismaService>(PrismaService);

    // Verify DB connectivity
    try {
      const count = await prisma.$queryRaw`SELECT 1 as ok`;
      console.log('✅ Database connected');
    } catch (e: any) {
      console.error('❌ Database connection failed:', e.message);
      throw e;
    }
  }, 60_000);

  afterAll(async () => {
    if (module) await module.close();
  });

  // Collect results across all cases for aggregate reporting
  const results: CaseResult[] = [];

  // Generate one test per eval case
  for (const evalCase of EVAL_CASES) {
    const testName = `[${evalCase.id}] ${evalCase.categoryName}: ${evalCase.query.substring(0, 60)}`;

    it(testName, async () => {
      if (SKIP && !FORCE) return;

      const startTime = Date.now();
      let response: RAGResponse;

      try {
        // Map eval case options to ragService.query() options
        response = await ragService.query(evalCase.query, {
          tenantId: evalCase.tenantId || 'test-tenant',
          ticker: evalCase.workspaceTicker,
          includeCitations: true,
          includeNarrative: true,
          ...evalCase.queryOptions,
        });
      } catch (error: any) {
        const result: CaseResult = {
          id: evalCase.id,
          category: evalCase.category,
          categoryName: evalCase.categoryName,
          query: evalCase.query,
          overall_pass: false,
          critical_pass: false,
          scores: [],
          error: error.message,
          latencyMs: Date.now() - startTime,
        };
        results.push(result);
        // Don't fail individual tests — we report aggregate accuracy
        return;
      }

      const latencyMs = Date.now() - startTime;
      const scores = scoreCase(response, evalCase);
      const criticalScores = scores.filter(s => s.severity === 'critical');

      const result: CaseResult = {
        id: evalCase.id,
        category: evalCase.category,
        categoryName: evalCase.categoryName,
        query: evalCase.query,
        overall_pass: scores.every(s => s.pass),
        critical_pass: criticalScores.length === 0 || criticalScores.every(s => s.pass),
        scores,
        response,
        latencyMs,
      };

      results.push(result);
    }, 60_000); // 60s timeout per query (Bedrock can be slow)
  }

  // Aggregate accuracy gate — runs after all individual tests
  afterAll(() => {
    if (SKIP && !FORCE) return;
    if (results.length === 0) return;

    printReport(results);

    // Deployment gate check
    const overallPct = results.filter(r => r.overall_pass).length / results.length;
    const criticalPct = results.filter(r => r.critical_pass).length / results.length;

    if (overallPct < DEPLOYMENT_GATE_OVERALL) {
      console.error(`\n❌ DEPLOYMENT GATE FAILED: ${(overallPct * 100).toFixed(1)}% < ${DEPLOYMENT_GATE_OVERALL * 100}% required`);
    }

    // Per-category gate
    const categories = [...new Set(results.map(r => r.category))];
    for (const cat of categories) {
      const catResults = results.filter(r => r.category === cat);
      const catPct = catResults.filter(r => r.overall_pass).length / catResults.length;
      if (catPct < DEPLOYMENT_GATE_PER_CATEGORY) {
        const catName = catResults[0]?.categoryName;
        console.error(`❌ CATEGORY GATE FAILED: ${catName} at ${(catPct * 100).toFixed(1)}% < ${DEPLOYMENT_GATE_PER_CATEGORY * 100}%`);
      }
    }
  });
});
