import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../rag/bedrock.service';
import { DocumentDiff, SectionDiffResult } from './temporal-diff-engine.service';

export type SeverityLevel = 'RED_FLAG' | 'AMBER' | 'GREEN_CHALLENGE';
export type ProvocationCategory =
  | 'management_credibility'
  | 'risk_escalation'
  | 'accounting_red_flags'
  | 'competitive_moat'
  | 'capital_allocation'
  | 'guidance_reliability'
  | 'related_party'
  | 'earnings_quality'
  | 'sentiment_shift';

export interface FilingReference {
  filingType: string;
  filingDate: string;
  section: string;
  excerpt: string;
}

export interface ProvocationResult {
  title: string;
  severity: SeverityLevel;
  category: ProvocationCategory;
  observation: string;
  filingReferences: FilingReference[];
  crossFilingDelta?: string;
  implication: string;
  challengeQuestion: string;
}

@Injectable()
export class ProvocationGeneratorService {
  private readonly logger = new Logger(ProvocationGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
  ) {}

  /**
   * Generate provocations from document diffs using LLM interpretation.
   */
  async generateProvocations(
    diff: DocumentDiff,
    analysisMode: string = 'provocations',
  ): Promise<ProvocationResult[]> {
    const materialChanges = diff.sectionDiffs.filter(
      d => d.changeType !== 'unchanged',
    );

    if (materialChanges.length === 0) {
      this.logger.log('No material changes found, skipping provocation generation');
      return [];
    }

    // Build prompt with actual diff data
    const prompt = this.buildProvocationPrompt(diff, materialChanges);

    try {
      const response = await this.bedrock.invokeClaude({
        prompt,
        max_tokens: 4000,
      });

      const provocations = this.parseProvocations(response, diff);
      return this.prioritizeProvocations(provocations);
    } catch (error) {
      this.logger.error(`Provocation generation failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Classify severity based on finding characteristics.
   */
  classifySeverity(observation: string, category: ProvocationCategory): SeverityLevel {
    const lower = observation.toLowerCase();

    // RED FLAG: material risks, accounting issues, contradictions
    const redFlagPatterns = [
      'material weakness', 'restatement', 'going concern',
      'sec investigation', 'fraud', 'material misstatement',
      'significant deficiency', 'removed risk factor',
      'contradicts', 'materially different',
    ];
    if (redFlagPatterns.some(p => lower.includes(p))) return 'RED_FLAG';
    if (category === 'accounting_red_flags') return 'RED_FLAG';

    // AMBER: noteworthy patterns
    const amberPatterns = [
      'increased risk', 'new risk', 'guidance lowered',
      'tone shift', 'hedging language', 'walked back',
      'softened language', 'reduced confidence',
    ];
    if (amberPatterns.some(p => lower.includes(p))) return 'AMBER';
    if (['risk_escalation', 'management_credibility'].includes(category)) return 'AMBER';

    // GREEN CHALLENGE: intellectual questions
    return 'GREEN_CHALLENGE';
  }

  /**
   * Prioritize provocations: RED_FLAG first, then AMBER, then GREEN_CHALLENGE.
   */
  prioritizeProvocations(provocations: ProvocationResult[]): ProvocationResult[] {
    const order: Record<SeverityLevel, number> = {
      RED_FLAG: 0,
      AMBER: 1,
      GREEN_CHALLENGE: 2,
    };
    return [...provocations].sort((a, b) => order[a.severity] - order[b.severity]);
  }

  /**
   * Save provocations to database.
   */
  async saveProvocations(
    ticker: string,
    analysisMode: string,
    provocations: ProvocationResult[],
  ): Promise<void> {
    for (const p of provocations) {
      await this.prisma.provocation.create({
        data: {
          ticker,
          analysisMode,
          title: p.title,
          severity: p.severity,
          category: p.category,
          observation: p.observation,
          filingReferences: p.filingReferences as any,
          crossFilingDelta: p.crossFilingDelta,
          implication: p.implication,
          challengeQuestion: p.challengeQuestion,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });
    }
  }

  private buildProvocationPrompt(
    diff: DocumentDiff,
    materialChanges: SectionDiffResult[],
  ): string {
    const changesText = materialChanges
      .map(c => {
        const changes = c.specificChanges
          .slice(0, 5)
          .map(ch => {
            if (ch.type === 'paragraph_added') return `  ADDED: "${(ch.targetText || '').substring(0, 200)}..."`;
            if (ch.type === 'paragraph_removed') return `  REMOVED: "${(ch.sourceText || '').substring(0, 200)}..."`;
            return `  MODIFIED (sim=${ch.similarity?.toFixed(2)}): "${(ch.sourceText || '').substring(0, 100)}..." → "${(ch.targetText || '').substring(0, 100)}..."`;
          })
          .join('\n');
        return `Section: ${c.sectionType} (${c.changeType})\n${changes}`;
      })
      .join('\n\n');

    return `You are a senior adversarial research analyst. Analyze these changes between two SEC filings for ${diff.sourceTicker}.

Filing comparison: ${diff.filingType} from ${diff.sourceFilingDate.toISOString().split('T')[0]} vs ${diff.targetFilingDate.toISOString().split('T')[0]}

Material changes detected:
${changesText}

Generate 3-5 provocations. For each, provide a JSON object with:
- title: concise finding title
- severity: RED_FLAG, AMBER, or GREEN_CHALLENGE
- category: one of management_credibility, risk_escalation, accounting_red_flags, competitive_moat, capital_allocation, guidance_reliability, related_party
- observation: what changed and why it matters
- crossFilingDelta: specific language that changed between filings
- implication: what this means for the investment thesis
- challengeQuestion: adversarial question an analyst should ask

Return ONLY a JSON array of provocation objects. No other text.`;
  }

  private parseProvocations(
    response: string,
    diff: DocumentDiff,
  ): ProvocationResult[] {
    try {
      // Extract JSON array from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((p: any) => p.title && p.observation)
        .map((p: any) => ({
          title: p.title,
          severity: this.validateSeverity(p.severity),
          category: this.validateCategory(p.category),
          observation: p.observation,
          filingReferences: [
            {
              filingType: diff.filingType,
              filingDate: diff.sourceFilingDate.toISOString().split('T')[0],
              section: 'Multiple',
              excerpt: (p.crossFilingDelta || p.observation).substring(0, 200),
            },
            {
              filingType: diff.filingType,
              filingDate: diff.targetFilingDate.toISOString().split('T')[0],
              section: 'Multiple',
              excerpt: (p.crossFilingDelta || p.observation).substring(0, 200),
            },
          ],
          crossFilingDelta: p.crossFilingDelta || undefined,
          implication: p.implication || 'Requires further analysis',
          challengeQuestion: p.challengeQuestion || 'What is the impact on the investment thesis?',
        }));
    } catch (error) {
      this.logger.warn(`Failed to parse provocations response: ${error.message}`);
      return [];
    }
  }

  private validateSeverity(s: string): SeverityLevel {
    const valid: SeverityLevel[] = ['RED_FLAG', 'AMBER', 'GREEN_CHALLENGE'];
    return valid.includes(s as SeverityLevel) ? (s as SeverityLevel) : 'GREEN_CHALLENGE';
  }

  private validateCategory(c: string): ProvocationCategory {
    const valid: ProvocationCategory[] = [
      'management_credibility', 'risk_escalation', 'accounting_red_flags',
      'competitive_moat', 'capital_allocation', 'guidance_reliability', 'related_party',
      'earnings_quality', 'sentiment_shift',
    ];
    return valid.includes(c as ProvocationCategory) ? (c as ProvocationCategory) : 'risk_escalation';
  }

  /**
   * Generate the 5 pre-computed value investing provocations.
   * These are designed for senior equity analysts at value investing funds.
   */
  async generateValueInvestingProvocations(ticker: string): Promise<ProvocationResult[]> {
    this.logger.log(`Generating 5 value investing provocations for ${ticker}`);

    // Get the most recent filings for analysis
    const filings = await this.prisma.narrativeChunk.findMany({
      where: { ticker: ticker.toUpperCase() },
      orderBy: { filingDate: 'desc' },
      take: 100,
    });

    if (filings.length === 0) {
      this.logger.warn(`No filings found for ${ticker}`);
      return [];
    }

    // Group filings by type and date
    const filingsByType = new Map<string, typeof filings>();
    for (const f of filings) {
      const key = f.filingType;
      if (!filingsByType.has(key)) filingsByType.set(key, []);
      filingsByType.get(key)!.push(f);
    }

    // Get financial metrics for earnings quality analysis
    const metrics = await this.prisma.financialMetric.findMany({
      where: { ticker: ticker.toUpperCase() },
      orderBy: { filingDate: 'desc' },
      take: 20,
    });

    // Build comprehensive context for LLM
    const mdaSections = filings.filter(f => 
      f.sectionType?.toLowerCase().includes('mda') || 
      f.sectionType?.toLowerCase().includes('md&a')
    ).slice(0, 4);

    const riskSections = filings.filter(f => 
      f.sectionType?.toLowerCase().includes('risk') ||
      f.sectionType?.toLowerCase().includes('1a')
    ).slice(0, 4);

    const prompt = this.buildValueInvestingPrompt(ticker, mdaSections, riskSections, metrics);

    try {
      const response = await this.bedrock.invokeClaude({
        prompt,
        max_tokens: 6000,
      });

      const provocations = this.parseValueInvestingProvocations(response, ticker);
      return this.prioritizeProvocations(provocations);
    } catch (error) {
      this.logger.error(`Value investing provocation generation failed: ${error.message}`);
      // Return fallback provocations based on available data
      return this.generateFallbackProvocations(ticker, metrics, mdaSections, riskSections);
    }
  }

  private buildValueInvestingPrompt(
    ticker: string,
    mdaSections: any[],
    riskSections: any[],
    metrics: any[],
  ): string {
    // Extract key financial data
    const revenueMetrics = metrics.filter(m => 
      m.metricName?.toLowerCase().includes('revenue') ||
      m.metricName?.toLowerCase().includes('net sales')
    );
    const netIncomeMetrics = metrics.filter(m => 
      m.metricName?.toLowerCase().includes('net income') ||
      m.metricName?.toLowerCase().includes('net earnings')
    );
    const cashFlowMetrics = metrics.filter(m => 
      m.metricName?.toLowerCase().includes('operating cash') ||
      m.metricName?.toLowerCase().includes('cash from operations')
    );
    const capexMetrics = metrics.filter(m => 
      m.metricName?.toLowerCase().includes('capital expenditure') ||
      m.metricName?.toLowerCase().includes('capex') ||
      m.metricName?.toLowerCase().includes('property, plant')
    );

    // Build MD&A excerpts
    const mdaExcerpts = mdaSections.map(s => ({
      date: s.filingDate?.toISOString?.()?.split('T')[0] || 'Unknown',
      type: s.filingType,
      excerpt: (s.content || '').substring(0, 2000),
    }));

    // Build risk factor excerpts
    const riskExcerpts = riskSections.map(s => ({
      date: s.filingDate?.toISOString?.()?.split('T')[0] || 'Unknown',
      type: s.filingType,
      excerpt: (s.content || '').substring(0, 1500),
    }));

    return `You are a senior adversarial research analyst at a value investing fund. Your job is to generate exactly 5 pre-computed provocations for ${ticker} that will help portfolio managers stress-test their investment thesis.

AVAILABLE DATA:

## Financial Metrics (Recent)
Revenue: ${JSON.stringify(revenueMetrics.slice(0, 4).map(m => ({ period: m.period, value: m.value })))}
Net Income: ${JSON.stringify(netIncomeMetrics.slice(0, 4).map(m => ({ period: m.period, value: m.value })))}
Operating Cash Flow: ${JSON.stringify(cashFlowMetrics.slice(0, 4).map(m => ({ period: m.period, value: m.value })))}
CapEx: ${JSON.stringify(capexMetrics.slice(0, 4).map(m => ({ period: m.period, value: m.value })))}

## MD&A Excerpts (Most Recent Filings)
${mdaExcerpts.map(e => `[${e.type} - ${e.date}]\n${e.excerpt}`).join('\n\n')}

## Risk Factor Excerpts
${riskExcerpts.map(e => `[${e.type} - ${e.date}]\n${e.excerpt}`).join('\n\n')}

GENERATE EXACTLY 5 PROVOCATIONS covering these specific areas:

1. 🔴 EARNINGS QUALITY & CASH CONVERSION (RED_FLAG severity)
   - Compare Net Income growth vs Operating Cash Flow growth
   - Flag if accruals are building up (Net Income >> OCF)
   - Look for revenue recognition timing issues
   - Category: earnings_quality

2. 🔴 MANAGEMENT CREDIBILITY TRACKER (RED_FLAG severity)
   - Extract forward-looking statements from prior filings
   - Compare management's past predictions to actual results
   - Flag broken promises or walked-back guidance
   - Category: management_credibility

3. 🟠 RISK FACTOR ESCALATION (AMBER severity)
   - Diff Item 1A between filings
   - Detect NEW risks that weren't mentioned before
   - Flag language intensity changes (e.g., "may" → "will likely")
   - Category: risk_escalation

4. 🟠 CAPITAL ALLOCATION DISCIPLINE (AMBER severity)
   - Track CapEx vs Depreciation trends
   - Analyze ROIC vs WACC (if inferable)
   - Flag aggressive acquisition spending or empire building
   - Category: capital_allocation

5. 📊 SENTIMENT & TONE SHIFT (GREEN_CHALLENGE severity)
   - MD&A sentiment score across filings
   - Detect hedging language increases ("may", "could", "uncertain")
   - Flag defensive language or blame-shifting
   - Category: sentiment_shift

For each provocation, return a JSON object with:
- title: Concise finding title (max 60 chars)
- severity: RED_FLAG, AMBER, or GREEN_CHALLENGE
- category: One of the categories above
- observation: What you found and why it matters (2-3 sentences)
- crossFilingDelta: Specific language or numbers that changed between filings
- implication: What this means for the investment thesis (1-2 sentences)
- challengeQuestion: The adversarial question an analyst should ask management

Return ONLY a JSON array of exactly 5 provocation objects. No other text.`;
  }

  private parseValueInvestingProvocations(response: string, ticker: string): ProvocationResult[] {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        this.logger.warn('No JSON array found in response');
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((p: any) => p.title && p.observation)
        .map((p: any) => ({
          title: p.title,
          severity: this.validateSeverity(p.severity),
          category: this.validateCategory(p.category),
          observation: p.observation,
          filingReferences: [{
            filingType: '10-K/10-Q',
            filingDate: new Date().toISOString().split('T')[0],
            section: p.category === 'risk_escalation' ? 'Item 1A' : 'MD&A',
            excerpt: (p.crossFilingDelta || p.observation).substring(0, 200),
          }],
          crossFilingDelta: p.crossFilingDelta || undefined,
          implication: p.implication || 'Requires further analysis',
          challengeQuestion: p.challengeQuestion || 'What is the impact on the investment thesis?',
        }));
    } catch (error) {
      this.logger.warn(`Failed to parse value investing provocations: ${error.message}`);
      return [];
    }
  }

  private generateFallbackProvocations(
    ticker: string,
    metrics: any[],
    mdaSections: any[],
    riskSections: any[],
  ): ProvocationResult[] {
    const provocations: ProvocationResult[] = [];

    // 1. Earnings Quality - always generate
    provocations.push({
      title: `${ticker}: Earnings Quality Deep Dive Required`,
      severity: 'RED_FLAG',
      category: 'earnings_quality',
      observation: `Review the relationship between reported Net Income and Operating Cash Flow for ${ticker}. Persistent gaps may indicate aggressive revenue recognition or accrual build-up.`,
      filingReferences: [{
        filingType: '10-K',
        filingDate: new Date().toISOString().split('T')[0],
        section: 'Cash Flow Statement',
        excerpt: 'Compare Net Income to Cash from Operations',
      }],
      implication: 'Earnings quality issues can signal future restatements or margin compression.',
      challengeQuestion: `Why has ${ticker}'s cash conversion ratio changed over the past 3 years?`,
    });

    // 2. Management Credibility
    provocations.push({
      title: `${ticker}: Management Guidance Track Record`,
      severity: 'RED_FLAG',
      category: 'management_credibility',
      observation: `Analyze management's forward-looking statements from prior filings against actual results. Look for patterns of over-promising or guidance revisions.`,
      filingReferences: [{
        filingType: '10-K',
        filingDate: new Date().toISOString().split('T')[0],
        section: 'MD&A',
        excerpt: 'Forward-looking statements and guidance',
      }],
      implication: 'Management credibility directly impacts the reliability of future projections.',
      challengeQuestion: `What percentage of management's guidance from 2 years ago was actually achieved?`,
    });

    // 3. Risk Factor Escalation
    const hasRiskData = riskSections.length > 0;
    provocations.push({
      title: `${ticker}: New Risk Factors Identified`,
      severity: 'AMBER',
      category: 'risk_escalation',
      observation: hasRiskData 
        ? `Compare Item 1A risk factors between the most recent filing and prior year. Identify newly added risks and language intensity changes.`
        : `Risk factor analysis pending - compare Item 1A across multiple filings to identify escalating concerns.`,
      filingReferences: [{
        filingType: '10-K',
        filingDate: new Date().toISOString().split('T')[0],
        section: 'Item 1A - Risk Factors',
        excerpt: 'Risk factor comparison',
      }],
      implication: 'New or escalated risks may not be fully priced into the stock.',
      challengeQuestion: `What new risks appeared in the most recent 10-K that weren't in the prior year?`,
    });

    // 4. Capital Allocation
    provocations.push({
      title: `${ticker}: Capital Allocation Efficiency`,
      severity: 'AMBER',
      category: 'capital_allocation',
      observation: `Evaluate CapEx trends relative to depreciation and revenue growth. Assess whether capital is being deployed at returns above cost of capital.`,
      filingReferences: [{
        filingType: '10-K',
        filingDate: new Date().toISOString().split('T')[0],
        section: 'Cash Flow Statement',
        excerpt: 'Capital expenditures and depreciation',
      }],
      implication: 'Poor capital allocation destroys shareholder value over time.',
      challengeQuestion: `Is ${ticker}'s incremental ROIC above or below its WACC on recent investments?`,
    });

    // 5. Sentiment Shift
    provocations.push({
      title: `${ticker}: Management Tone Analysis`,
      severity: 'GREEN_CHALLENGE',
      category: 'sentiment_shift',
      observation: `Track sentiment and confidence indicators in MD&A across filings. Look for increases in hedging language ("may", "could", "uncertain") or defensive tone.`,
      filingReferences: [{
        filingType: '10-K',
        filingDate: new Date().toISOString().split('T')[0],
        section: 'MD&A',
        excerpt: 'Management discussion tone',
      }],
      implication: 'Tone shifts often precede fundamental deterioration.',
      challengeQuestion: `Has management's confidence level in MD&A increased or decreased over the past 3 filings?`,
    });

    return provocations;
  }
}
