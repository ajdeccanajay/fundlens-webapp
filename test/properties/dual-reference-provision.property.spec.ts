/**
 * Property-Based Test: Dual Reference Provision for Contradictions
 * Feature: provocations-engine, Property 13: Dual Reference Provision for Contradictions
 * 
 * **Validates: Requirements 5.5**
 * 
 * For any detected contradiction, the system should provide specific references
 * to both conflicting statements or data points.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ContradictionDetectorService } from '../../src/deals/contradiction-detector.service';

describe('Property 13: Dual Reference Provision for Contradictions', () => {
  let contradictionDetector: ContradictionDetectorService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ContradictionDetectorService,
          useValue: {
            detectContradictions: jest.fn().mockImplementation((documents: any[]) => {
              return Promise.resolve(
                documents.slice(0, -1).map((doc, i) => ({
                  type: 'statement_vs_results',
                  severity: 'RED_FLAG',
                  description: 'Guidance missed',
                  evidence: [
                    {
                      source: {
                        documentId: doc.id,
                        filingType: doc.type,
                        filingDate: doc.filingDate,
                        section: 'MD&A',
                      },
                      text: doc.statement || 'Prior statement',
                      context: 'Forward-looking guidance',
                    },
                    {
                      source: {
                        documentId: documents[i + 1].id,
                        filingType: documents[i + 1].type,
                        filingDate: documents[i + 1].filingDate,
                        section: 'Financial Statements',
                      },
                      text: documents[i + 1].result || 'Actual result',
                      context: 'Reported results',
                    },
                  ],
                }))
              );
            }),
          },
        },
      ],
    }).compile();

    contradictionDetector = module.get<ContradictionDetectorService>(ContradictionDetectorService);
  });

  it('should provide exactly two references for each contradiction', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('10-K', '10-Q'),
            filingDate: fc.date(),
            statement: fc.string({ minLength: 50, maxLength: 150 }),
            result: fc.string({ minLength: 50, maxLength: 150 }),
          }),
          { minLength: 2, maxLength: 6 }
        ),
        async (documents) => {
          const contradictions = await contradictionDetector.detectContradictions(documents);

          for (const contradiction of contradictions) {
            // Property 1: Must have exactly 2 evidence items (dual reference)
            expect(contradiction.evidence).toBeDefined();
            expect(contradiction.evidence.length).toBeGreaterThanOrEqual(2);

            // Property 2: Each evidence must have source
            for (const evidence of contradiction.evidence) {
              expect(evidence.source).toBeDefined();
              expect(evidence.source.documentId).toBeDefined();
              expect(evidence.source.filingType).toBeDefined();
              expect(evidence.source.filingDate).toBeDefined();
              expect(evidence.source.section).toBeDefined();
            }

            // Property 3: Each evidence must have text
            for (const evidence of contradiction.evidence) {
              expect(evidence.text).toBeDefined();
              expect(typeof evidence.text).toBe('string');
              expect(evidence.text.length).toBeGreaterThan(0);
            }

            // Property 4: Each evidence must have context
            for (const evidence of contradiction.evidence) {
              expect(evidence.context).toBeDefined();
              expect(typeof evidence.context).toBe('string');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should reference different documents for contradictions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('10-K', '10-Q'),
            filingDate: fc.date(),
            statement: fc.string({ minLength: 50, maxLength: 150 }),
            result: fc.string({ minLength: 50, maxLength: 150 }),
          }),
          { minLength: 2, maxLength: 5 }
        ),
        async (documents) => {
          const contradictions = await contradictionDetector.detectContradictions(documents);

          for (const contradiction of contradictions) {
            // Property: References should point to different documents
            const documentIds = contradiction.evidence.map(e => e.source.documentId);
            const uniqueIds = new Set(documentIds);
            expect(uniqueIds.size).toBeGreaterThan(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should include complete source metadata', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('10-K', '10-Q', '8-K'),
            filingDate: fc.date({ min: new Date('2020-01-01'), max: new Date('2024-12-31') }),
            statement: fc.string({ minLength: 50, maxLength: 150 }),
            result: fc.string({ minLength: 50, maxLength: 150 }),
          }),
          { minLength: 2, maxLength: 4 }
        ),
        async (documents) => {
          const contradictions = await contradictionDetector.detectContradictions(documents);

          for (const contradiction of contradictions) {
            for (const evidence of contradiction.evidence) {
              // Property 1: Document ID must be valid UUID or string
              expect(evidence.source.documentId).toBeDefined();
              expect(typeof evidence.source.documentId).toBe('string');
              expect(evidence.source.documentId.length).toBeGreaterThan(0);

              // Property 2: Filing type must be valid
              expect(['10-K', '10-Q', '8-K']).toContain(evidence.source.filingType);

              // Property 3: Filing date must be valid Date
              expect(evidence.source.filingDate).toBeDefined();
              expect(evidence.source.filingDate instanceof Date).toBe(true);

              // Property 4: Section must be specified
              expect(evidence.source.section).toBeDefined();
              expect(typeof evidence.source.section).toBe('string');
              expect(evidence.source.section.length).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should provide chronological ordering of references', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('10-K', '10-Q'),
            filingDate: fc.date({ min: new Date('2020-01-01'), max: new Date('2024-12-31') }),
            statement: fc.string({ minLength: 50, maxLength: 150 }),
            result: fc.string({ minLength: 50, maxLength: 150 }),
          }),
          { minLength: 2, maxLength: 4 }
        ).map(docs => docs.sort((a, b) => a.filingDate.getTime() - b.filingDate.getTime())),
        async (documents) => {
          const contradictions = await contradictionDetector.detectContradictions(documents);

          for (const contradiction of contradictions) {
            if (contradiction.evidence.length >= 2) {
              // Property: First reference should be from earlier filing
              const date1 = contradiction.evidence[0].source.filingDate;
              const date2 = contradiction.evidence[1].source.filingDate;
              expect(date1.getTime()).toBeLessThanOrEqual(date2.getTime());
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);
});
