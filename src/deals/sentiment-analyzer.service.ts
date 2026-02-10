import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../rag/bedrock.service';
import { SemanticSimilarityEngineService } from './semantic-similarity-engine.service';

export interface SentimentResult {
  score: number; // -1 to +1
  label: 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive';
  confidenceLevel: number; // 0-10
  hedgingLevel: number; // 0-10
  defensiveScore: number; // 0-10
  keyIndicators: string[];
}

export interface SentimentDelta {
  sourceScore: number;
  targetScore: number;
  delta: number;
  isMaterial: boolean; // delta > 0.3
  direction: 'improving' | 'declining' | 'stable';
  confidenceShift: string;
}

@Injectable()
export class SentimentAnalyzerService {
  private readonly logger = new Logger(SentimentAnalyzerService.name);

  // Positive sentiment indicators
  private readonly POSITIVE = [
    'strong', 'growth', 'exceeded', 'record', 'confident', 'momentum',
    'accelerating', 'outperformed', 'robust', 'favorable', 'optimistic',
  ];

  // Negative sentiment indicators
  private readonly NEGATIVE = [
    'decline', 'weakness', 'challenging', 'headwind', 'uncertain',
    'deteriorating', 'adverse', 'impairment', 'restructuring', 'loss',
  ];

  constructor(
    private readonly bedrock: BedrockService,
    private readonly semanticEngine: SemanticSimilarityEngineService,
  ) {}

  /**
   * Calculate sentiment score for a text section (-1 to +1).
   */
  calculateSentiment(text: string): SentimentResult {
    const lower = text.toLowerCase();
    const words = lower.split(/\s+/);
    const totalWords = words.length || 1;

    // Count positive and negative indicators
    let posCount = 0;
    let negCount = 0;
    const indicators: string[] = [];

    for (const term of this.POSITIVE) {
      const count = (lower.match(new RegExp(`\\b${term}\\b`, 'g')) || []).length;
      if (count > 0) {
        posCount += count;
        indicators.push(`+${term}`);
      }
    }
    for (const term of this.NEGATIVE) {
      const count = (lower.match(new RegExp(`\\b${term}\\b`, 'g')) || []).length;
      if (count > 0) {
        negCount += count;
        indicators.push(`-${term}`);
      }
    }

    // Normalize to -1 to +1
    const rawScore = (posCount - negCount) / Math.max(posCount + negCount, 1);
    const score = Math.max(-1, Math.min(1, rawScore));

    // Get qualifier analysis
    const qualifiers = this.semanticEngine.measureQualifierIntensity(text);
    const defensive = this.semanticEngine.detectDefensiveLanguage(text);

    return {
      score,
      label: this.scoreToLabel(score),
      confidenceLevel: qualifiers.intensityLevel,
      hedgingLevel: Math.min(10, qualifiers.qualifiers.length * 2),
      defensiveScore: defensive.score,
      keyIndicators: indicators.slice(0, 10),
    };
  }

  /**
   * Detect sentiment delta between two filings.
   */
  detectSentimentDelta(
    sourceText: string,
    targetText: string,
  ): SentimentDelta {
    const sourceSentiment = this.calculateSentiment(sourceText);
    const targetSentiment = this.calculateSentiment(targetText);
    const delta = targetSentiment.score - sourceSentiment.score;

    let direction: 'improving' | 'declining' | 'stable' = 'stable';
    if (delta > 0.1) direction = 'improving';
    else if (delta < -0.1) direction = 'declining';

    let confidenceShift = 'stable';
    const confDelta = targetSentiment.confidenceLevel - sourceSentiment.confidenceLevel;
    if (confDelta > 2) confidenceShift = 'confidence increasing';
    else if (confDelta < -2) confidenceShift = 'confidence decreasing';

    return {
      sourceScore: sourceSentiment.score,
      targetScore: targetSentiment.score,
      delta,
      isMaterial: Math.abs(delta) > 0.3,
      direction,
      confidenceShift,
    };
  }

  /**
   * Track confidence language patterns across text.
   */
  trackConfidenceLanguage(text: string): {
    strongCommitments: string[];
    hedgedStatements: string[];
    confidenceRatio: number;
  } {
    const qualifiers = this.semanticEngine.measureQualifierIntensity(text);
    const total = qualifiers.confidenceIndicators.length + qualifiers.qualifiers.length;
    const ratio = total > 0
      ? qualifiers.confidenceIndicators.length / total
      : 0.5;

    return {
      strongCommitments: qualifiers.confidenceIndicators,
      hedgedStatements: qualifiers.qualifiers,
      confidenceRatio: ratio,
    };
  }

  private scoreToLabel(score: number): SentimentResult['label'] {
    if (score <= -0.5) return 'very_negative';
    if (score <= -0.1) return 'negative';
    if (score <= 0.1) return 'neutral';
    if (score <= 0.5) return 'positive';
    return 'very_positive';
  }
}
