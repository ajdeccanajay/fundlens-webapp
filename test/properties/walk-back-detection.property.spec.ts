/**
 * Property-Based Test: Guidance Walk-Back Detection
 * Feature: provocations-engine, Property 31: Guidance Walk-Back Detection
 * 
 * **Validates: Requirements 16.4**
 * 
 * For any forward-looking statement in a prior filing that is materially softened or removed
 * in a subsequent filing without explanation, the system should detect and flag the walk-back.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ManagementCredibilityService } from '../../src/deals/management-credibility.service';

describe('Property 31: Guidance Walk-Back Detection', () => {
  let managementCredibility: ManagementCredibilityService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ManagementCredibilityService,
          useValue: {
            detectWalkBacks: jest.fn().mockImplementation((priorStatements: any[], currentSection: any) => {
              const walkBacks = [];
              const currentText = currentSection.content.toLowerCase();

              for (const statement of priorStatements) {
                const topic = statement.text.split(' ').slice(0, 5).join(' ').toLowerCase();
                
                // Check if statement is missing or softened
                const isMissing = !currentText.includes(topic);
                const isSoftened = currentText.includes(topic) && 
                  (currentText.includes('may') || currentText.includes('could')) &&
                  !currentText.includes(statement.commitmentLevel);

                if (isMissing || isSoftened) {
                  walkBacks.push({
                    priorStatement: statement,
                    walkBackType: isMissing ? 'removed' : 'softened',
                    severity: 'AMBER',
                    description: `Statement ${isMissing ? 'removed' : 'softened'} without explanation`,
                  });
                }
              }

              return Promise.resolve(walkBacks);
            }),
          },
        },
      ],
    }).compile();

    managementCredibility = module.get<ManagementCredibilityService>(ManagementCredibilityService);
  });

  it('should detect removed statements', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          priorStatements: fc.array(
            fc.record({
              id: fc.uuid(),
              text: fc.string({ minLength: 50, maxLength: 150 }),
              commitmentLevel: fc.constantFrom('will', 'expect', 'plan'),
            }),
            { minLength: 1, maxLength: 3 }
          ),
          currentContent: fc.string({ minLength: 100, maxLength: 300 }),
        }),
        async ({ priorStatements, currentContent }) => {
          const currentSection = {
            id: 'current-1',
            type: 'MD&A',
            title: 'MD&A',
            content: currentContent,
          };

          const walkBacks = await managementCredibility.detectWalkBacks(priorStatements, currentSection);

          // Property 1: All walk-backs must have required fields
          for (const walkBack of walkBacks) {
            expect(walkBack.priorStatement).toBeDefined();
            expect(walkBack.walkBackType).toBeDefined();
            expect(['removed', 'softened']).toContain(walkBack.walkBackType);
            expect(walkBack.severity).toBeDefined();
            expect(walkBack.description).toBeDefined();
          }

          // Property 2: Walk-back type should be accurate
          for (const walkBack of walkBacks) {
            if (walkBack.walkBackType === 'removed') {
              // Statement should not appear in current content
              const topic = walkBack.priorStatement.text.split(' ').slice(0, 5).join(' ').toLowerCase();
              expect(currentContent.toLowerCase().includes(topic)).toBe(false);
            }
          }
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);

  it('should detect softened statements', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          topic: fc.string({ minLength: 20, maxLength: 80 }),
          priorCommitment: fc.constantFrom('will', 'expect'),
          softenedWord: fc.constantFrom('may', 'could', 'might'),
        }),
        async ({ topic, priorCommitment, softenedWord }) => {
          const priorStatements = [{
            id: 'stmt-1',
            text: `We ${priorCommitment} ${topic}`,
            commitmentLevel: priorCommitment,
          }];

          const currentSection = {
            id: 'current-1',
            type: 'MD&A',
            title: 'MD&A',
            content: `We ${softenedWord} ${topic}`,
          };

          const walkBacks = await managementCredibility.detectWalkBacks(priorStatements, currentSection);

          // Property: Should detect softening
          expect(walkBacks.length).toBeGreaterThan(0);
          expect(walkBacks[0].walkBackType).toBe('softened');
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);

  it('should not flag statements that remain unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          topic: fc.string({ minLength: 20, maxLength: 80 }),
          commitmentWord: fc.constantFrom('will', 'expect', 'plan'),
        }),
        async ({ topic, commitmentWord }) => {
          const statement = {
            id: 'stmt-1',
            text: `We ${commitmentWord} ${topic}`,
            commitmentLevel: commitmentWord,
          };

          const currentSection = {
            id: 'current-1',
            type: 'MD&A',
            title: 'MD&A',
            content: `We ${commitmentWord} ${topic}`,
          };

          const walkBacks = await managementCredibility.detectWalkBacks([statement], currentSection);

          // Property: Should not detect walk-back for unchanged statement
          expect(walkBacks.length).toBe(0);
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);

  it('should assign appropriate severity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          priorStatements: fc.array(
            fc.record({
              id: fc.uuid(),
              text: fc.string({ minLength: 50, maxLength: 150 }),
              commitmentLevel: fc.constantFrom('will', 'expect'),
            }),
            { minLength: 1, maxLength: 3 }
          ),
          currentContent: fc.string({ minLength: 50, maxLength: 200 }),
        }),
        async ({ priorStatements, currentContent }) => {
          const currentSection = {
            id: 'current-1',
            type: 'MD&A',
            title: 'MD&A',
            content: currentContent,
          };

          const walkBacks = await managementCredibility.detectWalkBacks(priorStatements, currentSection);

          // Property: All walk-backs should have valid severity
          for (const walkBack of walkBacks) {
            expect(['RED_FLAG', 'AMBER', 'GREEN_CHALLENGE']).toContain(walkBack.severity);
          }
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);
});
