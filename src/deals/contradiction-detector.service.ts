import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../rag/bedrock.service';
import { SeverityLevel, FilingReference } from './provocation-generator.service';

export interface Contradiction {
  type: 'statement_vs_results' | 'segment_vs_consolidated' | 'capex_vs_strategy' | 'cross_filing';
  severity: SeverityLevel;
  description: string;
  evidence: { source: FilingReference; text: string }[];
}

@Injectable()
export class ContradictionDetectorService {
  private readonly logger = new Logger(ContradictionDetectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
  ) {}

  /**
   * Detect contradictions across filings for a ticker.
   */
  async detectContradictions(ticker: string): Promise<Contradiction[]> {
    this.logger.log(`Detecting contradictions for ${ticker}`);

    // Get recent MD&A and Risk Factors sections
    const sections = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker,
        sectionType: { in: ['mda', 'risk_factors', 'MD&A', 'Risk Factors'] },
      },
      orderBy: { filingDate: 'desc' },
      take: 20,
    });

    if (sections.length < 2) return [];

    // Group by filing date
    const byDate = new Map<string, typeof sections>();
    for (const s of sections) {
      const key = s.filingDate.toISOString();
      const group = byDate.get(key) || [];
      group.push(s);
      byDate.set(key, group);
    }

    const dates = [...byDate.keys()].sort().reverse();
    if (dates.length < 2) return [];

    // Compare most recent two filings
    const newerSections = byDate.get(dates[0]) || [];
    const olderSections = byDate.get(dates[1]) || [];

    const newerText = newerSections.map(s => s.content).join('\n');
    const olderText = olderSections.map(s => s.content).join('\n');

    return this.analyzeContradictions(ticker, olderText, newerText, dates[1], dates[0]);
  }

  /**
   * Compare forward-looking statements against subsequent results.
   */
  async compareStatementsToResults(
    ticker: string,
    priorFilingDate: Date,
    subsequentFilingDate: Date,
  ): Promise<Contradiction[]> {
    const [priorMda, subsequentMda] = await Promise.all([
      this.getMdaContent(ticker, priorFilingDate),
      this.getMdaContent(ticker, subsequentFilingDate),
    ]);

    if (!priorMda || !subsequentMda) return [];

    const prompt = `Analyze these two MD&A sections from ${ticker} SEC filings.

PRIOR FILING (${priorFilingDate.toISOString().split('T')[0]}):
${priorMda.substring(0, 3000)}

SUBSEQUENT FILING (${subsequentFilingDate.toISOString().split('T')[0]}):
${subsequentMda.substring(0, 3000)}

Identify contradictions where management's forward-looking statements in the prior filing were contradicted by results in the subsequent filing. Return a JSON array of objects with: type, description, priorStatement, subsequentResult. Return ONLY the JSON array.`;

    try {
      const response = await this.bedrock.invokeClaude({ prompt, max_tokens: 2000 });
      return this.parseContradictions(response, ticker, priorFilingDate, subsequentFilingDate);
    } catch (error) {
      this.logger.error(`Contradiction analysis failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Detect narrative misalignment between segment and consolidated data.
   */
  async detectNarrativeMisalignment(ticker: string): Promise<Contradiction[]> {
    // Get sections that might contain segment data
    const sections = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker,
        sectionType: { in: ['mda', 'MD&A', 'segment_information', 'financial_statements'] },
      },
      orderBy: { filingDate: 'desc' },
      take: 10,
    });

    if (sections.length < 2) return [];

    const content = sections.map(s => s.content).join('\n').substring(0, 6000);

    const prompt = `Analyze this SEC filing content for ${ticker} and identify any misalignments between segment-level performance descriptions and consolidated narrative. Look for cases where segment data tells a different story than the overall narrative. Return a JSON array of objects with: type ("segment_vs_consolidated"), description, segmentEvidence, consolidatedEvidence. Return ONLY the JSON array.

Content:
${content}`;

    try {
      const response = await this.bedrock.invokeClaude({ prompt, max_tokens: 2000 });
      return this.parseMisalignments(response, ticker, sections[0]?.filingDate);
    } catch (error) {
      this.logger.error(`Misalignment detection failed: ${error.message}`);
      return [];
    }
  }

  private async analyzeContradictions(
    ticker: string,
    olderText: string,
    newerText: string,
    olderDate: string,
    newerDate: string,
  ): Promise<Contradiction[]> {
    const prompt = `Compare these two SEC filing excerpts for ${ticker} and identify contradictions.

OLDER FILING (${olderDate.split('T')[0]}):
${olderText.substring(0, 3000)}

NEWER FILING (${newerDate.split('T')[0]}):
${newerText.substring(0, 3000)}

Find contradictions: statements vs results, guidance changes, tone reversals. Return a JSON array of objects with: type (statement_vs_results|cross_filing), severity (RED_FLAG|AMBER|GREEN_CHALLENGE), description. Return ONLY the JSON array.`;

    try {
      const response = await this.bedrock.invokeClaude({ prompt, max_tokens: 2000 });
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.map((c: any) => ({
        type: c.type || 'cross_filing',
        severity: (['RED_FLAG', 'AMBER', 'GREEN_CHALLENGE'].includes(c.severity) ? c.severity : 'AMBER') as SeverityLevel,
        description: c.description,
        evidence: [
          { source: { filingType: '10-K', filingDate: olderDate.split('T')[0], section: 'MD&A', excerpt: '' }, text: c.description },
          { source: { filingType: '10-K', filingDate: newerDate.split('T')[0], section: 'MD&A', excerpt: '' }, text: c.description },
        ],
      }));
    } catch {
      return [];
    }
  }

  private async getMdaContent(ticker: string, filingDate: Date): Promise<string | null> {
    const chunks = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker,
        filingDate,
        sectionType: { in: ['mda', 'MD&A'] },
      },
      orderBy: { chunkIndex: 'asc' },
    });
    return chunks.length > 0 ? chunks.map(c => c.content).join('\n') : null;
  }

  private parseContradictions(
    response: string, ticker: string, priorDate: Date, subDate: Date,
  ): Contradiction[] {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.map((c: any) => ({
        type: 'statement_vs_results' as const,
        severity: 'AMBER' as SeverityLevel,
        description: c.description || '',
        evidence: [
          { source: { filingType: '10-K', filingDate: priorDate.toISOString().split('T')[0], section: 'MD&A', excerpt: c.priorStatement || '' }, text: c.priorStatement || '' },
          { source: { filingType: '10-K', filingDate: subDate.toISOString().split('T')[0], section: 'MD&A', excerpt: c.subsequentResult || '' }, text: c.subsequentResult || '' },
        ],
      }));
    } catch { return []; }
  }

  private parseMisalignments(response: string, ticker: string, filingDate?: Date): Contradiction[] {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.map((c: any) => ({
        type: 'segment_vs_consolidated' as const,
        severity: 'AMBER' as SeverityLevel,
        description: c.description || '',
        evidence: [
          { source: { filingType: '10-K', filingDate: filingDate?.toISOString().split('T')[0] || '', section: 'Segments', excerpt: c.segmentEvidence || '' }, text: c.segmentEvidence || '' },
          { source: { filingType: '10-K', filingDate: filingDate?.toISOString().split('T')[0] || '', section: 'MD&A', excerpt: c.consolidatedEvidence || '' }, text: c.consolidatedEvidence || '' },
        ],
      }));
    } catch { return []; }
  }
}
