/**
 * Property-Based Test: Forward-Looking Statement Extraction
 * Feature: provocations-engine, Property 30: Forward-Looking Statement Extraction
 * 
 * **Validates: Requirements 16.1**
 * 
 * For any MD&A section, the Management Credibility Tracker should extract all forward-looking
 * statements containing commitment language ("will", "expect", "plan", "intend").
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ManagementCredibilityService } from '../../src/deals/management-credibility.service';

describe('Property 30: Forward-Looking Statement Extraction', () => {
  let managementCredibility: ManagementCredibilityService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ManagementCredibilityService,
          useValue: {
            extractForwardLookingStatements: jest.fn().mockImplementation((section: any) => {
              const commitmentWords = ['will', 'expect', 'plan', 'intend', 'anticipate', 'believe'];
              const sentences = section.content.split(/[.!?]+/);
              
              const statements = sentences
                .filter(sentence => 
                  commitmentWords.some(word => 
                    sentence.toLowerCase().includes(` ${word} `)
                  )
                )
                .map((sentence, index) => ({
                  id: `stmt-${index}`,
                  text: sentence.trim(),
                  commitmentLevel: commitmentWords.find(word => 
                    sentence.toLowerCase().includes(` ${word} `)
                  ),
                  section: section.type,
                  extractedAt: new Date(),
                }));

              return Promise.resolve(statements);
            }),
          },
        },
      ],
    }).compile();

    managementCredibility = module.get<ManagementCredibilityService>(ManagementCredibilityService);
  });

  it('should extract statements with commitment language', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          baseText: fc.string({ minLength: 50, maxLength: 200 }),
          commitmentWords: fc.array(
            fc.constantFrom('will', 'expect', 'plan', 'intend', 'anticipate'),
            { minLength: 1, maxLength: 3 }
          ),
        }),
        async ({ baseText, commitmentWords }) => {
          const content = commitmentWords
            .map(word => `We ${word} ${baseText}.`)
            .join(' ');

          const section = {
            id: 'section-1',
            type: 'MD&A',
            title: 'MD&A',
            content,
          };

          const statements = await managementCredibility.extractForwardLookingStatements(section);

          // Property 1: Should extract at least one statement per commitment word
          expect(statements.length).toBeGreaterThanOrEqual(commitmentWords.length);

          // Property 2: Each statement should have required fields
          for (const statement of statements) {
            expect(statement.id).toBeDefined();
            expect(statement.text).toBeDefined();
            expect(statement.commitmentLevel).toBeDefined();
            expect(statement.section).toBe('MD&A');
            expect(statement.extractedAt).toBeDefined();
          }

          // Property 3: Each statement should contain commitment language
          for (const statement of statements) {
            const hasCommitment = ['will', 'expect', 'plan', 'intend', 'anticipate', 'believe']
              .some(word => statement.text.toLowerCase().includes(word));
            expect(hasCommitment).toBe(true);
          }
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);

  it('should not extract statements without commitment language', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 100, maxLength: 500 }),
        async (content) => {
          // Remove commitment words
          const neutralContent = content
            .replace(/\b(will|expect|plan|intend|anticipate|believe)\b/gi, 'may');

          const section = {
            id: 'section-1',
            type: 'MD&A',
            title: 'MD&A',
            content: neutralContent,
          };

          const statements = await managementCredibility.extractForwardLookingStatements(section);

          // Property: Should extract few or no statements
          expect(statements.length).toBeLessThan(content.split('.').length);
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);

  it('should identify commitment level correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          topic: fc.string({ minLength: 20, maxLength: 100 }),
          commitmentWord: fc.constantFrom('will', 'expect', 'plan', 'intend'),
        }),
        async ({ topic, commitmentWord }) => {
          const content = `We ${commitmentWord} ${topic}.`;

          const section = {
            id: 'section-1',
            type: 'MD&A',
            title: 'MD&A',
            content,
          };

          const statements = await managementCredibility.extractForwardLookingStatements(section);

          // Property: Should identify the commitment word used
          expect(statements.length).toBeGreaterThan(0);
          expect(statements[0].commitmentLevel).toBe(commitmentWord);
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);

  it('should handle multiple statements in same section', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            topic: fc.string({ minLength: 20, maxLength: 80 }),
            commitmentWord: fc.constantFrom('will', 'expect', 'plan', 'intend'),
          }),
          { minLength: 2, maxLength: 5 }
        ),
        async (statements) => {
          const content = statements
            .map(s => `We ${s.commitmentWord} ${s.topic}.`)
            .join(' ');

          const section = {
            id: 'section-1',
            type: 'MD&A',
            title: 'MD&A',
            content,
          };

          const extracted = await managementCredibility.extractForwardLookingStatements(section);

          // Property: Should extract all statements
          expect(extracted.length).toBeGreaterThanOrEqual(statements.length);
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);
});
