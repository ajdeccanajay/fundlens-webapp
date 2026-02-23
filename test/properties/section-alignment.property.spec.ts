/**
 * Property-Based Test: Section Alignment Consistency
 * Feature: provocations-engine, Property 3: Section Alignment Consistency
 * 
 * **Validates: Requirements 3.1, 11.1, 11.2**
 * 
 * For any pair of documents from the same company, the engine should align 
 * corresponding sections and classify each alignment as matched, added, or removed.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { TemporalDiffEngineService } from '../../src/deals/temporal-diff-engine.service';
import { SemanticSimilarityEngineService } from '../../src/deals/semantic-similarity-engine.service';

describe('Property 3: Section Alignment Consistency', () => {
  let temporalDiffEngine: TemporalDiffEngineService;
  let semanticSimilarityEngine: SemanticSimilarityEngineService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemporalDiffEngineService,
        {
          provide: SemanticSimilarityEngineService,
          useValue: {
            calculateSimilarity: jest.fn().mockResolvedValue(0.85),
            detectConceptualChanges: jest.fn().mockResolvedValue({
              isConceptuallyDifferent: false,
              similarityScore: 0.85,
              keyConceptsAdded: [],
              keyConceptsRemoved: [],
            }),
          },
        },
      ],
    }).compile();

    temporalDiffEngine = module.get<TemporalDiffEngineService>(TemporalDiffEngineService);
    semanticSimilarityEngine = module.get<SemanticSimilarityEngineService>(SemanticSimilarityEngineService);
  });

  it('should align sections and classify each as matched, added, or removed', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary document pairs with sections
        fc.record({
          sourceSections: fc.array(
            fc.record({
              id: fc.uuid(),
              type: fc.constantFrom('Risk Factors', 'MD&A', 'Accounting Policies', 'Financial Statements', 'Footnotes'),
              title: fc.string({ minLength: 5, maxLength: 50 }),
              content: fc.string({ minLength: 100, maxLength: 1000 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          targetSections: fc.array(
            fc.record({
              id: fc.uuid(),
              type: fc.constantFrom('Risk Factors', 'MD&A', 'Accounting Policies', 'Financial Statements', 'Footnotes'),
              title: fc.string({ minLength: 5, maxLength: 50 }),
              content: fc.string({ minLength: 100, maxLength: 1000 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
        }),
        async ({ sourceSections, targetSections }) => {
          // Execute alignment
          const alignments = await temporalDiffEngine.alignSections(sourceSections, targetSections);

          // Property 1: Every alignment must have a valid type
          for (const alignment of alignments) {
            expect(['matched', 'added', 'removed']).toContain(alignment.alignmentType);
          }

          // Property 2: All source sections must be accounted for
          const sourceSectionTypes = new Set(sourceSections.map(s => s.type));
          const alignedSourceTypes = new Set(
            alignments
              .filter(a => a.sourceSection !== null)
              .map(a => a.sourceSection!.type)
          );
          
          for (const sourceType of sourceSectionTypes) {
            expect(alignedSourceTypes.has(sourceType) || 
                   alignments.some(a => a.alignmentType === 'removed' && a.sectionType === sourceType))
              .toBe(true);
          }

          // Property 3: All target sections must be accounted for
          const targetSectionTypes = new Set(targetSections.map(s => s.type));
          const alignedTargetTypes = new Set(
            alignments
              .filter(a => a.targetSection !== null)
              .map(a => a.targetSection!.type)
          );
          
          for (const targetType of targetSectionTypes) {
            expect(alignedTargetTypes.has(targetType) || 
                   alignments.some(a => a.alignmentType === 'added' && a.sectionType === targetType))
              .toBe(true);
          }

          // Property 4: Matched alignments must have both source and target
          const matchedAlignments = alignments.filter(a => a.alignmentType === 'matched');
          for (const alignment of matchedAlignments) {
            expect(alignment.sourceSection).not.toBeNull();
            expect(alignment.targetSection).not.toBeNull();
            expect(alignment.sourceSection!.type).toBe(alignment.targetSection!.type);
          }

          // Property 5: Added alignments must have only target
          const addedAlignments = alignments.filter(a => a.alignmentType === 'added');
          for (const alignment of addedAlignments) {
            expect(alignment.sourceSection).toBeNull();
            expect(alignment.targetSection).not.toBeNull();
          }

          // Property 6: Removed alignments must have only source
          const removedAlignments = alignments.filter(a => a.alignmentType === 'removed');
          for (const alignment of removedAlignments) {
            expect(alignment.sourceSection).not.toBeNull();
            expect(alignment.targetSection).toBeNull();
          }
        }
      ),
      { numRuns: 10 }
    );
  }, 60000); // 60 second timeout for property test

  it('should handle empty document sections', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sourceSections: fc.constant([]),
          targetSections: fc.array(
            fc.record({
              id: fc.uuid(),
              type: fc.constantFrom('Risk Factors', 'MD&A'),
              title: fc.string({ minLength: 5, maxLength: 50 }),
              content: fc.string({ minLength: 100, maxLength: 500 }),
            }),
            { minLength: 1, maxLength: 5 }
          ),
        }),
        async ({ sourceSections, targetSections }) => {
          const alignments = await temporalDiffEngine.alignSections(sourceSections, targetSections);

          // All alignments should be 'added' when source is empty
          expect(alignments.length).toBe(targetSections.length);
          for (const alignment of alignments) {
            expect(alignment.alignmentType).toBe('added');
            expect(alignment.sourceSection).toBeNull();
            expect(alignment.targetSection).not.toBeNull();
          }
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);

  it('should handle identical section structures', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('Risk Factors', 'MD&A', 'Accounting Policies'),
            title: fc.string({ minLength: 5, maxLength: 50 }),
            content: fc.string({ minLength: 100, maxLength: 500 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (sections) => {
          // Use same sections for both source and target
          const alignments = await temporalDiffEngine.alignSections(sections, sections);

          // All alignments should be 'matched'
          expect(alignments.length).toBe(sections.length);
          for (const alignment of alignments) {
            expect(alignment.alignmentType).toBe('matched');
            expect(alignment.sourceSection).not.toBeNull();
            expect(alignment.targetSection).not.toBeNull();
          }
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);
});
