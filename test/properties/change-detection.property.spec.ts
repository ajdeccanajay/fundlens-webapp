/**
 * Property-Based Test: Change Detection Completeness
 * Feature: provocations-engine, Property 4: Change Detection Completeness
 * 
 * **Validates: Requirements 3.2, 3.4, 3.5, 11.3, 11.4**
 * 
 * For any aligned section pair, the engine should detect and classify all changes 
 * (added, removed, modified, unchanged) at the paragraph level.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { TemporalDiffEngineService } from '../../src/deals/temporal-diff-engine.service';
import { SemanticSimilarityEngineService } from '../../src/deals/semantic-similarity-engine.service';

describe('Property 4: Change Detection Completeness', () => {
  let temporalDiffEngine: TemporalDiffEngineService;
  let semanticSimilarityEngine: SemanticSimilarityEngineService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemporalDiffEngineService,
        {
          provide: SemanticSimilarityEngineService,
          useValue: {
            calculateSimilarity: jest.fn().mockImplementation((text1: string, text2: string) => {
              // Simple similarity based on text equality
              if (text1 === text2) return Promise.resolve(1.0);
              if (text1.substring(0, 50) === text2.substring(0, 50)) return Promise.resolve(0.85);
              return Promise.resolve(0.3);
            }),
            detectConceptualChanges: jest.fn().mockResolvedValue({
              isConceptuallyDifferent: true,
              similarityScore: 0.75,
              keyConceptsAdded: ['new concept'],
              keyConceptsRemoved: ['old concept'],
            }),
          },
        },
      ],
    }).compile();

    temporalDiffEngine = module.get<TemporalDiffEngineService>(TemporalDiffEngineService);
    semanticSimilarityEngine = module.get<SemanticSimilarityEngineService>(SemanticSimilarityEngineService);
  });

  it('should detect all paragraph-level changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sourceContent: fc.array(
            fc.string({ minLength: 50, maxLength: 200 }),
            { minLength: 1, maxLength: 10 }
          ),
          targetContent: fc.array(
            fc.string({ minLength: 50, maxLength: 200 }),
            { minLength: 1, maxLength: 10 }
          ),
        }),
        async ({ sourceContent, targetContent }) => {
          // Join paragraphs into section content
          const sourceSection = {
            id: 'source-1',
            type: 'Risk Factors',
            title: 'Risk Factors',
            content: sourceContent.join('\n\n'),
          };

          const targetSection = {
            id: 'target-1',
            type: 'Risk Factors',
            title: 'Risk Factors',
            content: targetContent.join('\n\n'),
          };

          // Detect changes
          const changes = await temporalDiffEngine.detectChanges(sourceSection, targetSection);

          // Property 1: All changes must have valid types
          const validTypes = ['paragraph_added', 'paragraph_removed', 'paragraph_modified', 'language_shift'];
          for (const change of changes) {
            expect(validTypes).toContain(change.type);
          }

          // Property 2: All changes must have location information
          for (const change of changes) {
            expect(change.location).toBeDefined();
            expect(typeof change.location).toBe('string');
          }

          // Property 3: Modified changes must have both source and target text
          const modifiedChanges = changes.filter(c => c.type === 'paragraph_modified' || c.type === 'language_shift');
          for (const change of modifiedChanges) {
            expect(change.sourceText).toBeDefined();
            expect(change.targetText).toBeDefined();
            expect(change.sourceText).not.toBe(change.targetText);
          }

          // Property 4: Added changes must have target text only
          const addedChanges = changes.filter(c => c.type === 'paragraph_added');
          for (const change of addedChanges) {
            expect(change.targetText).toBeDefined();
            expect(change.sourceText).toBeUndefined();
          }

          // Property 5: Removed changes must have source text only
          const removedChanges = changes.filter(c => c.type === 'paragraph_removed');
          for (const change of removedChanges) {
            expect(change.sourceText).toBeDefined();
            expect(change.targetText).toBeUndefined();
          }

          // Property 6: Changes with semantic similarity must have score
          const semanticChanges = changes.filter(c => c.semanticSimilarity !== undefined);
          for (const change of semanticChanges) {
            expect(change.semanticSimilarity).toBeGreaterThanOrEqual(0);
            expect(change.semanticSimilarity).toBeLessThanOrEqual(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should detect risk factor additions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          existingRisks: fc.array(
            fc.string({ minLength: 50, maxLength: 150 }),
            { minLength: 2, maxLength: 5 }
          ),
          newRisk: fc.string({ minLength: 50, maxLength: 150 }),
        }),
        async ({ existingRisks, newRisk }) => {
          const sourceSection = {
            id: 'source-1',
            type: 'Risk Factors',
            title: 'Risk Factors',
            content: existingRisks.join('\n\n'),
          };

          const targetSection = {
            id: 'target-1',
            type: 'Risk Factors',
            title: 'Risk Factors',
            content: [...existingRisks, newRisk].join('\n\n'),
          };

          const changes = await temporalDiffEngine.detectChanges(sourceSection, targetSection);

          // Should detect at least one addition
          const additions = changes.filter(c => c.type === 'paragraph_added');
          expect(additions.length).toBeGreaterThan(0);

          // The added paragraph should contain the new risk
          const addedTexts = additions.map(a => a.targetText).join(' ');
          expect(addedTexts).toContain(newRisk.substring(0, 30));
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should detect accounting policy changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          originalPolicy: fc.string({ minLength: 100, maxLength: 200 }),
          modifiedPolicy: fc.string({ minLength: 100, maxLength: 200 }),
        }),
        async ({ originalPolicy, modifiedPolicy }) => {
          // Ensure they're different
          if (originalPolicy === modifiedPolicy) {
            modifiedPolicy = modifiedPolicy + ' (amended)';
          }

          const sourceSection = {
            id: 'source-1',
            type: 'Accounting Policies',
            title: 'Accounting Policies',
            content: originalPolicy,
          };

          const targetSection = {
            id: 'target-1',
            type: 'Accounting Policies',
            title: 'Accounting Policies',
            content: modifiedPolicy,
          };

          const changes = await temporalDiffEngine.detectChanges(sourceSection, targetSection);

          // Should detect at least one change
          expect(changes.length).toBeGreaterThan(0);

          // Should have either modified or language shift
          const materialChanges = changes.filter(c => 
            c.type === 'paragraph_modified' || c.type === 'language_shift'
          );
          expect(materialChanges.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should handle identical content with no changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 50, maxLength: 150 }),
          { minLength: 1, maxLength: 5 }
        ),
        async (paragraphs) => {
          const content = paragraphs.join('\n\n');
          const section = {
            id: 'section-1',
            type: 'MD&A',
            title: 'MD&A',
            content,
          };

          const changes = await temporalDiffEngine.detectChanges(section, section);

          // Should detect no changes or all unchanged
          if (changes.length > 0) {
            // If changes are reported, they should indicate no material differences
            const materialChanges = changes.filter(c => 
              c.type !== 'unchanged' && c.semanticSimilarity !== 1.0
            );
            expect(materialChanges.length).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should provide exact filing references for all changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sourceContent: fc.string({ minLength: 100, maxLength: 300 }),
          targetContent: fc.string({ minLength: 100, maxLength: 300 }),
        }),
        async ({ sourceContent, targetContent }) => {
          const sourceSection = {
            id: 'source-1',
            type: 'Risk Factors',
            title: 'Risk Factors',
            content: sourceContent,
          };

          const targetSection = {
            id: 'target-1',
            type: 'Risk Factors',
            title: 'Risk Factors',
            content: targetContent,
          };

          const changes = await temporalDiffEngine.detectChanges(sourceSection, targetSection);

          // Every change must have location information
          for (const change of changes) {
            expect(change.location).toBeDefined();
            expect(change.location.length).toBeGreaterThan(0);
          }

          // Changes with text must have excerpts
          for (const change of changes) {
            if (change.sourceText) {
              expect(change.sourceText.length).toBeGreaterThan(0);
            }
            if (change.targetText) {
              expect(change.targetText.length).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);
});
