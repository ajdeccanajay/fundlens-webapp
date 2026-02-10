import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../rag/bedrock.service';
import * as crypto from 'crypto';

export interface SectionDiffResult {
  sectionType: string;
  changeType: 'added' | 'removed' | 'modified' | 'unchanged';
  sourceContent?: string;
  targetContent?: string;
  similarityScore?: number;
  specificChanges: ParagraphChange[];
}

export interface ParagraphChange {
  type: 'paragraph_added' | 'paragraph_removed' | 'paragraph_modified' | 'language_shift';
  sourceText?: string;
  targetText?: string;
  similarity?: number;
}

export interface DocumentDiff {
  sourceTicker: string;
  sourceFilingDate: Date;
  targetFilingDate: Date;
  filingType: string;
  sectionDiffs: SectionDiffResult[];
  summary: { totalChanges: number; materialChanges: number };
}

@Injectable()
export class TemporalDiffEngineService {
  private readonly logger = new Logger(TemporalDiffEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
  ) {}

  /**
   * Compare two filings for the same ticker across different dates.
   * Uses existing narrative_chunks data.
   */
  async compareDocuments(
    ticker: string,
    filingType: string,
    sourceDate: Date,
    targetDate: Date,
  ): Promise<DocumentDiff> {
    this.logger.log(`Comparing ${ticker} ${filingType}: ${sourceDate.toISOString()} vs ${targetDate.toISOString()}`);

    // Get sections from both filings using existing narrative_chunks
    const [sourceSections, targetSections] = await Promise.all([
      this.getSectionsForFiling(ticker, filingType, sourceDate),
      this.getSectionsForFiling(ticker, filingType, targetDate),
    ]);

    // Align and diff sections
    const sectionDiffs = await this.alignSections(sourceSections, targetSections);

    const materialChanges = sectionDiffs.filter(
      d => d.changeType !== 'unchanged',
    ).length;

    return {
      sourceTicker: ticker,
      sourceFilingDate: sourceDate,
      targetFilingDate: targetDate,
      filingType,
      sectionDiffs,
      summary: {
        totalChanges: sectionDiffs.length,
        materialChanges,
      },
    };
  }

  /**
   * Align sections between two filing versions by section_type.
   */
  async alignSections(
    sourceSections: Map<string, string>,
    targetSections: Map<string, string>,
  ): Promise<SectionDiffResult[]> {
    const allSectionTypes = new Set([
      ...sourceSections.keys(),
      ...targetSections.keys(),
    ]);

    const results: SectionDiffResult[] = [];

    for (const sectionType of allSectionTypes) {
      const sourceContent = sourceSections.get(sectionType);
      const targetContent = targetSections.get(sectionType);

      if (!sourceContent && targetContent) {
        results.push({
          sectionType,
          changeType: 'added',
          targetContent,
          specificChanges: [{ type: 'paragraph_added', targetText: targetContent }],
        });
      } else if (sourceContent && !targetContent) {
        results.push({
          sectionType,
          changeType: 'removed',
          sourceContent,
          specificChanges: [{ type: 'paragraph_removed', sourceText: sourceContent }],
        });
      } else if (sourceContent && targetContent) {
        const diff = await this.classifyChanges(sectionType, sourceContent, targetContent);
        results.push(diff);
      }
    }

    return results;
  }

  /**
   * Classify changes between two section contents at paragraph level.
   */
  async classifyChanges(
    sectionType: string,
    sourceContent: string,
    targetContent: string,
  ): Promise<SectionDiffResult> {
    // Quick hash check - if identical, skip expensive comparison
    const sourceHash = this.computeHash(sourceContent);
    const targetHash = this.computeHash(targetContent);

    if (sourceHash === targetHash) {
      return {
        sectionType,
        changeType: 'unchanged',
        sourceContent,
        targetContent,
        similarityScore: 1.0,
        specificChanges: [],
      };
    }

    // Split into paragraphs and compare
    const sourceParagraphs = this.splitIntoParagraphs(sourceContent);
    const targetParagraphs = this.splitIntoParagraphs(targetContent);
    const changes = this.detectParagraphChanges(sourceParagraphs, targetParagraphs);

    // Calculate overall similarity using simple text overlap
    const similarity = this.calculateTextSimilarity(sourceContent, targetContent);

    return {
      sectionType,
      changeType: 'modified',
      sourceContent,
      targetContent,
      similarityScore: similarity,
      specificChanges: changes,
    };
  }

  /**
   * Get consolidated section content from narrative_chunks for a filing.
   */
  private async getSectionsForFiling(
    ticker: string,
    filingType: string,
    filingDate: Date,
  ): Promise<Map<string, string>> {
    const chunks = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker,
        filingType,
        filingDate,
      },
      orderBy: [{ sectionType: 'asc' }, { chunkIndex: 'asc' }],
    });

    // Consolidate chunks by section type
    const sections = new Map<string, string>();
    for (const chunk of chunks) {
      const existing = sections.get(chunk.sectionType) || '';
      sections.set(chunk.sectionType, existing + (existing ? '\n' : '') + chunk.content);
    }

    return sections;
  }

  /**
   * Detect paragraph-level changes between two sets of paragraphs.
   */
  private detectParagraphChanges(
    source: string[],
    target: string[],
  ): ParagraphChange[] {
    const changes: ParagraphChange[] = [];
    const targetMatched = new Set<number>();

    for (const sourcePara of source) {
      let bestMatch = -1;
      let bestSimilarity = 0;

      for (let j = 0; j < target.length; j++) {
        if (targetMatched.has(j)) continue;
        const sim = this.calculateTextSimilarity(sourcePara, target[j]);
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          bestMatch = j;
        }
      }

      if (bestMatch >= 0 && bestSimilarity > 0.7) {
        targetMatched.add(bestMatch);
        if (bestSimilarity < 0.95) {
          changes.push({
            type: 'paragraph_modified',
            sourceText: sourcePara,
            targetText: target[bestMatch],
            similarity: bestSimilarity,
          });
        }
        // else unchanged, skip
      } else {
        changes.push({
          type: 'paragraph_removed',
          sourceText: sourcePara,
        });
      }
    }

    // Any unmatched target paragraphs are additions
    for (let j = 0; j < target.length; j++) {
      if (!targetMatched.has(j)) {
        changes.push({
          type: 'paragraph_added',
          targetText: target[j],
        });
      }
    }

    return changes;
  }

  private splitIntoParagraphs(text: string): string[] {
    return text
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 20); // Skip very short fragments
  }

  /**
   * Simple word-overlap similarity (Jaccard-like). Fast, no LLM needed.
   */
  calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (words1.size === 0 && words2.size === 0) return 1.0;
    if (words1.size === 0 || words2.size === 0) return 0.0;

    let intersection = 0;
    for (const w of words1) {
      if (words2.has(w)) intersection++;
    }
    const union = words1.size + words2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Store pre-computed diff in database for fast retrieval.
   */
  async storeDiff(
    sourceChunkId: string,
    targetChunkId: string,
    diffData: any,
    similarityScore: number,
  ): Promise<void> {
    await this.prisma.sectionDiff.upsert({
      where: {
        sourceChunkId_targetChunkId: {
          sourceChunkId,
          targetChunkId,
        },
      },
      update: { diffData, similarityScore, computedAt: new Date() },
      create: { sourceChunkId, targetChunkId, diffData, similarityScore },
    });
  }
}
