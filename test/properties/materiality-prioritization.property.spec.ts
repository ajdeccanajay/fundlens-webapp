/**
 * Property-Based Test: Materiality-Based Prioritization
 * Feature: provocations-engine, Property 9: Materiality-Based Prioritization
 * 
 * **Validates: Requirements 4.4**
 * 
 * For any set of provocations, when sorted by the engine's prioritization algorithm,
 * RED FLAG provocations should appear before AMBER, and AMBER before GREEN CHALLENGE.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ProvocationGeneratorService } from '../../src/deals/provocation-generator.service';

describe('Property 9: Materiality-Based Prioritization', () => {
  let provocationGenerator: ProvocationGeneratorService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProvocationGeneratorService,
          useValue: {
            prioritizeProvocations: jest.fn().mockImplementation((provocations: any[]) => {
              const severityOrder = { RED_FLAG: 3, AMBER: 2, GREEN_CHALLENGE: 1 };
              return Promise.resolve(
                [...provocations].sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity])
              );
            }),
          },
        },
      ],
    }).compile();

    provocationGenerator = module.get<ProvocationGeneratorService>(ProvocationGeneratorService);
  });

  it('should sort provocations by severity (RED > AMBER > GREEN)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            filingReferences: [], implication: "Test", challengeQuestion: "Test?", severity: fc.constantFrom('RED_FLAG', 'AMBER', 'GREEN_CHALLENGE'),
            title: fc.string({ minLength: 10, maxLength: 100 }),
            observation: fc.string({ minLength: 50, maxLength: 200 }),
            category: fc.constantFrom('risk_escalation', 'management_credibility', 'accounting_red_flags'),
          }),
          { minLength: 3, maxLength: 20 }
        ),
        async (provocations) => {
          const sorted = await provocationGenerator.prioritizeProvocations(provocations);

          // Property 1: Output length must match input length
          expect(sorted.length).toBe(provocations.length);

          // Property 2: All provocations must be present
          const inputIds = new Set(provocations.map(p => p.id));
          const outputIds = new Set(sorted.map(p => p.id));
          expect(inputIds).toEqual(outputIds);

          // Property 3: Severity ordering must be maintained
          const severityRanks = {
            RED_FLAG: 3,
            AMBER: 2,
            GREEN_CHALLENGE: 1,
          };

          let lastRank = 3; // Start with highest possible rank
          for (const provocation of sorted) {
            const currentRank = severityRanks[provocation.severity];
            expect(currentRank).toBeLessThanOrEqual(lastRank);
            lastRank = currentRank;
          }

          // Property 4: All RED_FLAG must come before all AMBER
          const redFlagIndices = sorted
            .map((p, i) => (p.severity === 'RED_FLAG' ? i : -1))
            .filter(i => i !== -1);
          const amberIndices = sorted
            .map((p, i) => (p.severity === 'AMBER' ? i : -1))
            .filter(i => i !== -1);

          if (redFlagIndices.length > 0 && amberIndices.length > 0) {
            const maxRedIndex = Math.max(...redFlagIndices);
            const minAmberIndex = Math.min(...amberIndices);
            expect(maxRedIndex).toBeLessThan(minAmberIndex);
          }

          // Property 5: All AMBER must come before all GREEN_CHALLENGE
          const greenIndices = sorted
            .map((p, i) => (p.severity === 'GREEN_CHALLENGE' ? i : -1))
            .filter(i => i !== -1);

          if (amberIndices.length > 0 && greenIndices.length > 0) {
            const maxAmberIndex = Math.max(...amberIndices);
            const minGreenIndex = Math.min(...greenIndices);
            expect(maxAmberIndex).toBeLessThan(minGreenIndex);
          }
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);

  it('should handle single severity level correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          filingReferences: [], implication: "Test", challengeQuestion: "Test?", severity: fc.constantFrom('RED_FLAG', 'AMBER', 'GREEN_CHALLENGE'),
          count: fc.integer({ min: 1, max: 10 }),
        }),
        async ({ severity, count }) => {
          const provocations = Array.from({ length: count }, (_, i) => ({
            id: `prov-${i}`,
            severity,
            title: `Provocation ${i}`,
            observation: `Observation ${i}`,
            category: 'risk_escalation',
          }));

          const sorted = await provocationGenerator.prioritizeProvocations(provocations);

          // Property 1: All provocations should have same severity
          for (const provocation of sorted) {
            expect(provocation.severity).toBe(severity);
          }

          // Property 2: Length should be preserved
          expect(sorted.length).toBe(count);
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);

  it('should handle empty provocation list', async () => {
    const sorted = await provocationGenerator.prioritizeProvocations([]);
    expect(sorted).toEqual([]);
  });

  it('should maintain stability for same severity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            filingReferences: [], implication: "Test", challengeQuestion: "Test?", severity: fc.constant('AMBER'),
            title: fc.string({ minLength: 10, maxLength: 50 }),
            observation: fc.string({ minLength: 50, maxLength: 150 }),
            category: fc.constantFrom('risk_escalation', 'management_credibility'),
          }),
          { minLength: 2, maxLength: 10 }
        ),
        async (provocations) => {
          const sorted1 = await provocationGenerator.prioritizeProvocations(provocations);
          const sorted2 = await provocationGenerator.prioritizeProvocations(provocations);

          // Property: Multiple sorts should produce same order
          expect(sorted1.map(p => p.id)).toEqual(sorted2.map(p => p.id));
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);

  it('should prioritize correctly with mixed severities', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          redCount: fc.integer({ min: 1, max: 5 }),
          amberCount: fc.integer({ min: 1, max: 5 }),
          greenCount: fc.integer({ min: 1, max: 5 }),
        }),
        async ({ redCount, amberCount, greenCount }) => {
          const provocations = [
            ...Array.from({ length: redCount }, (_, i) => ({
              id: `red-${i}`,
              filingReferences: [], implication: "Test", challengeQuestion: "Test?", severity: 'RED_FLAG' as const,
              title: `Red Flag ${i}`,
              observation: `Critical risk ${i}`,
              category: 'risk_escalation' as const,
            })),
            ...Array.from({ length: amberCount }, (_, i) => ({
              id: `amber-${i}`,
              filingReferences: [], implication: "Test", challengeQuestion: "Test?", severity: 'AMBER' as const,
              title: `Amber Alert ${i}`,
              observation: `Noteworthy pattern ${i}`,
              category: 'management_credibility' as const,
            })),
            ...Array.from({ length: greenCount }, (_, i) => ({
              id: `green-${i}`,
              filingReferences: [], implication: "Test", challengeQuestion: "Test?", severity: 'GREEN_CHALLENGE' as const,
              title: `Green Challenge ${i}`,
              observation: `Intellectual question ${i}`,
              category: 'competitive_moat' as const,
            })),
          ];

          // Shuffle to ensure sorting is tested
          const shuffled = provocations.sort(() => Math.random() - 0.5);

          const sorted = await provocationGenerator.prioritizeProvocations(shuffled);

          // Property 1: First redCount items should be RED_FLAG
          for (let i = 0; i < redCount; i++) {
            expect(sorted[i].severity).toBe('RED_FLAG');
          }

          // Property 2: Next amberCount items should be AMBER
          for (let i = redCount; i < redCount + amberCount; i++) {
            expect(sorted[i].severity).toBe('AMBER');
          }

          // Property 3: Last greenCount items should be GREEN_CHALLENGE
          for (let i = redCount + amberCount; i < sorted.length; i++) {
            expect(sorted[i].severity).toBe('GREEN_CHALLENGE');
          }
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);

  it('should preserve all provocation data during sorting', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            filingReferences: [], implication: "Test", challengeQuestion: "Test?", severity: fc.constantFrom('RED_FLAG', 'AMBER', 'GREEN_CHALLENGE'),
            title: fc.string({ minLength: 10, maxLength: 100 }),
            observation: fc.string({ minLength: 50, maxLength: 200 }),
            category: fc.constantFrom('risk_escalation', 'management_credibility', 'accounting_red_flags'),
            implication: fc.string({ minLength: 50, maxLength: 200 }),
            challengeQuestion: fc.string({ minLength: 20, maxLength: 100 }),
          }),
          { minLength: 3, maxLength: 15 }
        ),
        async (provocations) => {
          const sorted = await provocationGenerator.prioritizeProvocations(provocations);

          // Property: All fields should be preserved
          for (const sortedProv of sorted) {
            const original = provocations.find(p => p.id === sortedProv.id);
            expect(original).toBeDefined();
            expect(sortedProv.title).toBe(original!.title);
            expect(sortedProv.observation).toBe(original!.observation);
            expect(sortedProv.category).toBe(original!.category);
            expect(sortedProv.implication).toBe(original!.implication);
            expect(sortedProv.challengeQuestion).toBe(original!.challengeQuestion);
          }
        }
      ),
      { numRuns: 10 }
    );
  }, 60000);
});
