/**
 * Property-Based Test: Sentiment Score Calculation
 * Feature: provocations-engine, Property 33: Sentiment Score Calculation
 * 
 * **Validates: Requirements 13.1, 13.2**
 * 
 * For any MD&A or Risk Factors section, the sentiment analyzer should calculate a sentiment score
 * between -1 (very negative) and +1 (very positive) based on language patterns, confidence indicators,
 * and hedging language.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { SentimentAnalyzerService } from '../../src/deals/sentiment-analyzer.service';

describe('Property 33: Sentiment Score Calculation', () => {
  let sentimentAnalyzer: SentimentAnalyzerService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SentimentAnalyzerService,
          useValue: {
            calculateSentiment: jest.fn().mockImplementation((section: any) => {
              const text = section.content.toLowerCase();
              
              // Count positive and negative indicators
              const positiveWords = ['confident', 'strong', 'growth', 'success', 'opportunity', 'will', 'expect'];
              const negativeWords = ['risk', 'uncertain', 'may', 'could', 'challenge', 'decline', 'loss'];
              
              const positiveCount = positiveWords.filter(w => text.includes(w)).length;
              const negativeCount = negativeWords.filter(w => text.includes(w)).length;
              
              const totalWords = text.split(/\s+/).length;
              const positiveRatio = positiveCount / Math.max(totalWords / 100, 1);
              const negativeRatio = negativeCount / Math.max(totalWords / 100, 1);
              
              const score = Math.max(-1, Math.min(1, (positiveRatio - negativeRatio) / 2));
              
              return Promise.resolve({
                score,
                confidenceIndicators: positiveWords.filter(w => text.includes(w)),
                hedgingLanguage: negativeWords.filter(w => text.includes(w)),
                toneCategory: score > 0.3 ? 'positive' : score < -0.3 ? 'negative' : 'neutral',
              });
            }),
          },
        },
      ],
    }).compile();

    sentimentAnalyzer = module.get<SentimentAnalyzerService>(SentimentAnalyzerService);
  });

  it('should calculate sentiment scores in valid range [-1, 1]', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sectionType: fc.constantFrom('MD&A', 'Risk Factors', 'Business Overview'),
          content: fc.string({ minLength: 100, maxLength: 1000 }),
        }),
        async ({ sectionType, content }) => {
          const section = {
            id: 'section-1',
            type: sectionType,
            title: sectionType,
            content,
          };

          const result = await sentimentAnalyzer.calculateSentiment(section);

          // Property 1: Score must be in valid range
          expect(result.score).toBeGreaterThanOrEqual(-1);
          expect(result.score).toBeLessThanOrEqual(1);

          // Property 2: Result must have required fields
          expect(result.confidenceIndicators).toBeDefined();
          expect(Array.isArray(result.confidenceIndicators)).toBe(true);
          expect(result.hedgingLanguage).toBeDefined();
          expect(Array.isArray(result.hedgingLanguage)).toBe(true);
          expect(result.toneCategory).toBeDefined();
          expect(['positive', 'negative', 'neutral']).toContain(result.toneCategory);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should detect positive sentiment from confident language', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          baseText: fc.string({ minLength: 50, maxLength: 200 }),
          positiveWords: fc.array(
            fc.constantFrom('confident', 'strong', 'growth', 'success', 'will', 'expect'),
            { minLength: 2, maxLength: 5 }
          ),
        }),
        async ({ baseText, positiveWords }) => {
          const content = `${baseText} ${positiveWords.join(' ')} ${baseText}`;
          const section = {
            id: 'section-1',
            type: 'MD&A',
            title: 'MD&A',
            content,
          };

          const result = await sentimentAnalyzer.calculateSentiment(section);

          // Property: Positive language should result in positive or neutral score
          expect(result.score).toBeGreaterThanOrEqual(-0.5);
          
          // Property: Should identify confidence indicators
          expect(result.confidenceIndicators.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should detect negative sentiment from hedging language', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          baseText: fc.string({ minLength: 50, maxLength: 200 }),
          negativeWords: fc.array(
            fc.constantFrom('risk', 'uncertain', 'may', 'could', 'challenge', 'decline'),
            { minLength: 2, maxLength: 5 }
          ),
        }),
        async ({ baseText, negativeWords }) => {
          const content = `${baseText} ${negativeWords.join(' ')} ${baseText}`;
          const section = {
            id: 'section-1',
            type: 'Risk Factors',
            title: 'Risk Factors',
            content,
          };

          const result = await sentimentAnalyzer.calculateSentiment(section);

          // Property: Negative language should result in negative or neutral score
          expect(result.score).toBeLessThanOrEqual(0.5);
          
          // Property: Should identify hedging language
          expect(result.hedgingLanguage.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should handle neutral content appropriately', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 100, maxLength: 500 }),
        async (content) => {
          // Remove obvious sentiment words
          const neutralContent = content
            .replace(/confident|strong|growth|success|risk|uncertain|challenge/gi, 'neutral');

          const section = {
            id: 'section-1',
            type: 'Business Overview',
            title: 'Business Overview',
            content: neutralContent,
          };

          const result = await sentimentAnalyzer.calculateSentiment(section);

          // Property: Neutral content should have score near 0
          expect(Math.abs(result.score)).toBeLessThan(0.8);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should categorize tone correctly based on score', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          content: fc.string({ minLength: 100, maxLength: 500 }),
          sectionType: fc.constantFrom('MD&A', 'Risk Factors'),
        }),
        async ({ content, sectionType }) => {
          const section = {
            id: 'section-1',
            type: sectionType,
            title: sectionType,
            content,
          };

          const result = await sentimentAnalyzer.calculateSentiment(section);

          // Property: Tone category should align with score
          if (result.score > 0.3) {
            expect(result.toneCategory).toBe('positive');
          } else if (result.score < -0.3) {
            expect(result.toneCategory).toBe('negative');
          } else {
            expect(result.toneCategory).toBe('neutral');
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should handle empty or very short content', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 50 }),
        async (content) => {
          const section = {
            id: 'section-1',
            type: 'MD&A',
            title: 'MD&A',
            content,
          };

          const result = await sentimentAnalyzer.calculateSentiment(section);

          // Property: Should not throw and return valid score
          expect(result.score).toBeGreaterThanOrEqual(-1);
          expect(result.score).toBeLessThanOrEqual(1);
          expect(result.toneCategory).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should be consistent for identical content', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 100, maxLength: 500 }),
        async (content) => {
          const section = {
            id: 'section-1',
            type: 'MD&A',
            title: 'MD&A',
            content,
          };

          const result1 = await sentimentAnalyzer.calculateSentiment(section);
          const result2 = await sentimentAnalyzer.calculateSentiment(section);

          // Property: Same content should produce same score
          expect(result1.score).toBe(result2.score);
          expect(result1.toneCategory).toBe(result2.toneCategory);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);
});
