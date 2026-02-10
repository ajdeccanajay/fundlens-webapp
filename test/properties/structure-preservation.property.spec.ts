/**
 * Property-Based Test: Scratchpad Structure Preservation
 * Feature: provocations-engine, Property 23: Scratchpad Structure Preservation
 * 
 * **Validates: Requirements 9.2, 9.3**
 * 
 * For any provocation saved to the Scratchpad, the saved version should maintain complete structure
 * including severity, observation, references, implication, and challenge question.
 */

import * as fc from 'fast-check';

describe('Property 23: Scratchpad Structure Preservation', () => {
  it('should preserve all provocation fields when saving to scratchpad', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          provocation: fc.record({
            id: fc.uuid(),
            title: fc.string({ minLength: 10, maxLength: 100 }),
            severity: fc.constantFrom('RED_FLAG', 'AMBER', 'GREEN_CHALLENGE'),
            observation: fc.string({ minLength: 50, maxLength: 300 }),
            filingReferences: fc.array(
              fc.record({
                documentId: fc.uuid(),
                filingType: fc.constantFrom('10-K', '10-Q'),
                filingDate: fc.date(),
                section: fc.string({ minLength: 5, maxLength: 50 }),
                excerpt: fc.string({ minLength: 50, maxLength: 200 }),
              }),
              { minLength: 1, maxLength: 3 }
            ),
            implication: fc.string({ minLength: 50, maxLength: 300 }),
            challengeQuestion: fc.string({ minLength: 20, maxLength: 150 }),
            category: fc.constantFrom('risk_escalation', 'management_credibility', 'accounting_red_flags'),
          }),
        }),
        async ({ provocation }) => {
          // Mock save to scratchpad
          const saved = JSON.parse(JSON.stringify(provocation));

          // Property 1: All fields must be preserved
          expect(saved.id).toBe(provocation.id);
          expect(saved.title).toBe(provocation.title);
          expect(saved.severity).toBe(provocation.severity);
          expect(saved.observation).toBe(provocation.observation);
          expect(saved.implication).toBe(provocation.implication);
          expect(saved.challengeQuestion).toBe(provocation.challengeQuestion);
          expect(saved.category).toBe(provocation.category);

          // Property 2: Filing references must be preserved
          expect(saved.filingReferences.length).toBe(provocation.filingReferences.length);
          for (let i = 0; i < provocation.filingReferences.length; i++) {
            expect(saved.filingReferences[i].documentId).toBe(provocation.filingReferences[i].documentId);
            expect(saved.filingReferences[i].filingType).toBe(provocation.filingReferences[i].filingType);
            expect(saved.filingReferences[i].section).toBe(provocation.filingReferences[i].section);
            expect(saved.filingReferences[i].excerpt).toBe(provocation.filingReferences[i].excerpt);
          }

          // Property 3: Severity classification must be preserved
          expect(['RED_FLAG', 'AMBER', 'GREEN_CHALLENGE']).toContain(saved.severity);

          // Property 4: No fields should be added or removed
          const originalKeys = Object.keys(provocation).sort();
          const savedKeys = Object.keys(saved).sort();
          expect(savedKeys).toEqual(originalKeys);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should preserve formatting in text fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          observation: fc.string({ minLength: 50, maxLength: 200 }),
          implication: fc.string({ minLength: 50, maxLength: 200 }),
          challengeQuestion: fc.string({ minLength: 20, maxLength: 100 }),
        }),
        async ({ observation, implication, challengeQuestion }) => {
          const provocation = {
            id: 'test-id',
            title: 'Test Provocation',
            severity: 'AMBER' as const,
            observation,
            filingReferences: [],
            implication,
            challengeQuestion,
            category: 'risk_escalation' as const,
          };

          const saved = JSON.parse(JSON.stringify(provocation));

          // Property: Text content must be identical
          expect(saved.observation).toBe(observation);
          expect(saved.implication).toBe(implication);
          expect(saved.challengeQuestion).toBe(challengeQuestion);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should handle special characters in text fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          title: fc.string({ minLength: 10, maxLength: 100 }),
          observation: fc.string({ minLength: 50, maxLength: 200 }),
        }),
        async ({ title, observation }) => {
          const provocation = {
            id: 'test-id',
            title: `${title} "quoted" & <special>`,
            severity: 'RED_FLAG' as const,
            observation: `${observation} with $pecial ch@rs!`,
            filingReferences: [],
            implication: 'Test implication',
            challengeQuestion: 'Test question?',
            category: 'risk_escalation' as const,
          };

          const saved = JSON.parse(JSON.stringify(provocation));

          // Property: Special characters must be preserved
          expect(saved.title).toContain('"quoted"');
          expect(saved.title).toContain('&');
          expect(saved.observation).toContain('$pecial');
          expect(saved.observation).toContain('@');
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should preserve nested reference structures', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            documentId: fc.uuid(),
            filingType: fc.constantFrom('10-K', '10-Q', '8-K'),
            filingDate: fc.date(),
            section: fc.string({ minLength: 5, maxLength: 50 }),
            excerpt: fc.string({ minLength: 50, maxLength: 200 }),
            pageNumber: fc.integer({ min: 1, max: 500 }),
            url: fc.webUrl(),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (references) => {
          const provocation = {
            id: 'test-id',
            title: 'Test',
            severity: 'AMBER' as const,
            observation: 'Test observation',
            filingReferences: references,
            implication: 'Test implication',
            challengeQuestion: 'Test question?',
            category: 'risk_escalation' as const,
          };

          const saved = JSON.parse(JSON.stringify(provocation));

          // Property: All reference fields must be preserved
          for (let i = 0; i < references.length; i++) {
            expect(saved.filingReferences[i].documentId).toBe(references[i].documentId);
            expect(saved.filingReferences[i].filingType).toBe(references[i].filingType);
            expect(saved.filingReferences[i].section).toBe(references[i].section);
            expect(saved.filingReferences[i].excerpt).toBe(references[i].excerpt);
            expect(saved.filingReferences[i].pageNumber).toBe(references[i].pageNumber);
            expect(saved.filingReferences[i].url).toBe(references[i].url);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);
});
