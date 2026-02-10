import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../rag/bedrock.service';

export interface ForwardLookingStatement {
  text: string;
  filingDate: string;
  filingType: string;
  section: string;
  commitmentLevel: 'strong' | 'moderate' | 'weak';
}

export interface CredibilityAssessment {
  ticker: string;
  statements: ForwardLookingStatement[];
  walkBacks: { original: string; revised: string; filingDates: string[] }[];
  accuracyScore: number; // 0-100
}

@Injectable()
export class ManagementCredibilityService {
  private readonly logger = new Logger(ManagementCredibilityService.name);

  private readonly COMMITMENT_PATTERNS = {
    strong: ['will', 'expect to', 'committed to', 'plan to', 'intend to', 'confident that'],
    moderate: ['anticipate', 'believe', 'target', 'aim to', 'project'],
    weak: ['may', 'could', 'might', 'possible', 'potential', 'exploring'],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
  ) {}

  /**
   * Extract forward-looking statements from MD&A sections.
   */
  async extractForwardLookingStatements(ticker: string): Promise<ForwardLookingStatement[]> {
    const mdaSections = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker,
        sectionType: { in: ['mda', 'MD&A'] },
      },
      orderBy: { filingDate: 'desc' },
      take: 10,
    });

    const statements: ForwardLookingStatement[] = [];

    for (const section of mdaSections) {
      const sentences = section.content.split(/[.!?]+/).filter(s => s.trim().length > 20);

      for (const sentence of sentences) {
        const level = this.classifyCommitmentLevel(sentence);
        if (level) {
          statements.push({
            text: sentence.trim(),
            filingDate: section.filingDate.toISOString().split('T')[0],
            filingType: section.filingType,
            section: section.sectionType,
            commitmentLevel: level,
          });
        }
      }
    }

    return statements;
  }

  /**
   * Compare forward-looking statements to subsequent results.
   */
  async compareToResults(ticker: string): Promise<CredibilityAssessment> {
    const statements = await this.extractForwardLookingStatements(ticker);
    const walkBacks = await this.detectWalkBacks(ticker);

    // Simple accuracy: ratio of strong statements that weren't walked back
    const strongStatements = statements.filter(s => s.commitmentLevel === 'strong');
    const walkedBackCount = walkBacks.length;
    const accuracyScore = strongStatements.length > 0
      ? Math.round(((strongStatements.length - walkedBackCount) / strongStatements.length) * 100)
      : 50;

    return {
      ticker,
      statements: statements.slice(0, 20),
      walkBacks,
      accuracyScore: Math.max(0, Math.min(100, accuracyScore)),
    };
  }

  /**
   * Detect guidance walk-backs across filings.
   */
  async detectWalkBacks(ticker: string): Promise<{ original: string; revised: string; filingDates: string[] }[]> {
    const filings = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker,
        sectionType: { in: ['mda', 'MD&A'] },
      },
      distinct: ['filingDate'],
      orderBy: { filingDate: 'desc' },
      take: 4,
      select: { filingDate: true, filingType: true, content: true },
    });

    if (filings.length < 2) return [];

    // Use LLM to detect walk-backs between consecutive filings
    const newer = filings[0];
    const older = filings[1];

    const prompt = `Compare these two MD&A sections from ${ticker} and identify any guidance walk-backs where management softened, removed, or contradicted prior commitments.

OLDER FILING (${older.filingDate.toISOString().split('T')[0]}):
${older.content.substring(0, 2500)}

NEWER FILING (${newer.filingDate.toISOString().split('T')[0]}):
${newer.content.substring(0, 2500)}

Return a JSON array of objects with: original (the original statement), revised (the revised/softened version), reason. Return ONLY the JSON array. If no walk-backs found, return [].`;

    try {
      const response = await this.bedrock.invokeClaude({ prompt, max_tokens: 2000 });
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.map((wb: any) => ({
        original: wb.original || '',
        revised: wb.revised || '',
        filingDates: [
          older.filingDate.toISOString().split('T')[0],
          newer.filingDate.toISOString().split('T')[0],
        ],
      }));
    } catch {
      return [];
    }
  }

  /**
   * Calculate historical accuracy metrics.
   */
  async calculateAccuracyMetrics(ticker: string): Promise<{
    overallScore: number;
    strongCommitmentCount: number;
    walkBackCount: number;
    hedgingTrend: 'increasing' | 'decreasing' | 'stable';
  }> {
    const assessment = await this.compareToResults(ticker);
    const statements = assessment.statements;

    // Analyze hedging trend over time
    const byDate = new Map<string, number>();
    for (const s of statements) {
      const count = byDate.get(s.filingDate) || 0;
      byDate.set(s.filingDate, count + (s.commitmentLevel === 'weak' ? 1 : 0));
    }

    const dates = [...byDate.keys()].sort();
    let hedgingTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (dates.length >= 2) {
      const first = byDate.get(dates[0]) || 0;
      const last = byDate.get(dates[dates.length - 1]) || 0;
      if (last > first + 2) hedgingTrend = 'increasing';
      else if (last < first - 2) hedgingTrend = 'decreasing';
    }

    return {
      overallScore: assessment.accuracyScore,
      strongCommitmentCount: statements.filter(s => s.commitmentLevel === 'strong').length,
      walkBackCount: assessment.walkBacks.length,
      hedgingTrend,
    };
  }

  private classifyCommitmentLevel(sentence: string): 'strong' | 'moderate' | 'weak' | null {
    const lower = sentence.toLowerCase();

    for (const pattern of this.COMMITMENT_PATTERNS.strong) {
      if (lower.includes(pattern)) return 'strong';
    }
    for (const pattern of this.COMMITMENT_PATTERNS.moderate) {
      if (lower.includes(pattern)) return 'moderate';
    }
    for (const pattern of this.COMMITMENT_PATTERNS.weak) {
      if (lower.includes(pattern)) return 'weak';
    }

    return null;
  }
}
