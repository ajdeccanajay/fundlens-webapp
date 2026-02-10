import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../rag/bedrock.service';

export interface ConceptualChange {
  isConceptuallyDifferent: boolean;
  similarityScore: number;
  keyConceptsAdded: string[];
  keyConceptsRemoved: string[];
  toneShift?: 'more_confident' | 'less_confident' | 'neutral';
}

export interface QualifierScore {
  intensityLevel: number; // 0-10
  qualifiers: string[];
  confidenceIndicators: string[];
}

@Injectable()
export class SemanticSimilarityEngineService {
  private readonly logger = new Logger(SemanticSimilarityEngineService.name);

  // Confidence language patterns
  private readonly STRONG_CONFIDENCE = ['will', 'expect', 'confident', 'committed', 'plan to', 'intend to'];
  private readonly WEAK_CONFIDENCE = ['may', 'could', 'might', 'uncertain', 'possible', 'potential'];
  private readonly HEDGING = ['subject to', 'no assurance', 'cannot guarantee', 'there can be no', 'risk that'];

  constructor(private readonly bedrock: BedrockService) {}

  /**
   * Calculate semantic similarity using Bedrock embeddings.
   */
  async calculateSimilarity(text1: string, text2: string): Promise<number> {
    try {
      const [emb1, emb2] = await Promise.all([
        this.bedrock.generateEmbedding(text1.substring(0, 4000)),
        this.bedrock.generateEmbedding(text2.substring(0, 4000)),
      ]);
      return this.cosineSimilarity(emb1, emb2);
    } catch (error) {
      this.logger.warn(`Embedding similarity failed, falling back to lexical: ${error.message}`);
      return this.lexicalSimilarity(text1, text2);
    }
  }

  /**
   * Detect conceptual changes beyond exact text matching.
   */
  async detectConceptualChanges(
    sourceText: string,
    targetText: string,
  ): Promise<ConceptualChange> {
    const similarity = await this.calculateSimilarity(sourceText, targetText);
    const sourceQualifiers = this.measureQualifierIntensity(sourceText);
    const targetQualifiers = this.measureQualifierIntensity(targetText);

    let toneShift: 'more_confident' | 'less_confident' | 'neutral' = 'neutral';
    if (targetQualifiers.intensityLevel - sourceQualifiers.intensityLevel > 2) {
      toneShift = 'more_confident';
    } else if (sourceQualifiers.intensityLevel - targetQualifiers.intensityLevel > 2) {
      toneShift = 'less_confident';
    }

    // Find concepts added/removed by comparing key terms
    const sourceTerms = this.extractKeyTerms(sourceText);
    const targetTerms = this.extractKeyTerms(targetText);
    const added = targetTerms.filter(t => !sourceTerms.includes(t));
    const removed = sourceTerms.filter(t => !targetTerms.includes(t));

    return {
      isConceptuallyDifferent: similarity < 0.85 || toneShift !== 'neutral',
      similarityScore: similarity,
      keyConceptsAdded: added.slice(0, 10),
      keyConceptsRemoved: removed.slice(0, 10),
      toneShift,
    };
  }

  /**
   * Measure qualifier language intensity (confidence vs hedging).
   */
  measureQualifierIntensity(text: string): QualifierScore {
    const lower = text.toLowerCase();
    const foundStrong: string[] = [];
    const foundWeak: string[] = [];
    const foundHedging: string[] = [];

    for (const term of this.STRONG_CONFIDENCE) {
      if (lower.includes(term)) foundStrong.push(term);
    }
    for (const term of this.WEAK_CONFIDENCE) {
      if (lower.includes(term)) foundWeak.push(term);
    }
    for (const term of this.HEDGING) {
      if (lower.includes(term)) foundHedging.push(term);
    }

    // Score: 0 = very hedged, 10 = very confident
    const strongScore = foundStrong.length * 2;
    const weakPenalty = foundWeak.length * 1.5;
    const hedgePenalty = foundHedging.length * 2;
    const raw = 5 + strongScore - weakPenalty - hedgePenalty;
    const intensityLevel = Math.max(0, Math.min(10, Math.round(raw)));

    return {
      intensityLevel,
      qualifiers: [...foundWeak, ...foundHedging],
      confidenceIndicators: foundStrong,
    };
  }

  /**
   * Detect defensive language patterns.
   */
  detectDefensiveLanguage(text: string): {
    isDefensive: boolean;
    patterns: string[];
    score: number;
  } {
    const lower = text.toLowerCase();
    const defensivePatterns = [
      'no assurance', 'cannot guarantee', 'subject to risks',
      'forward-looking statements', 'actual results may differ',
      'there can be no', 'we disclaim', 'risk factors',
      'material adverse', 'beyond our control',
    ];

    const found = defensivePatterns.filter(p => lower.includes(p));
    const score = Math.min(10, found.length * 2);

    return {
      isDefensive: found.length >= 3,
      patterns: found,
      score,
    };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  private lexicalSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (words1.size === 0 && words2.size === 0) return 1.0;
    let intersection = 0;
    for (const w of words1) if (words2.has(w)) intersection++;
    const union = words1.size + words2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private extractKeyTerms(text: string): string[] {
    // Extract meaningful multi-word terms and significant single words
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const stopWords = new Set(['which', 'their', 'about', 'would', 'could', 'should', 'these', 'those', 'other', 'being', 'after', 'before', 'under', 'above', 'between']);
    return [...new Set(words.filter(w => !stopWords.has(w)))].slice(0, 50);
  }
}
