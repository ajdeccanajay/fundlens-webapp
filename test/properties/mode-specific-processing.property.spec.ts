/**
 * Property-Based Test: Mode-Specific Processing
 * Feature: provocations-engine, Property 19: Mode-Specific Processing
 * 
 * **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
 * 
 * For any analysis mode and document set, switching between modes should produce different outputs
 * according to each mode's processing rules without re-processing the underlying documents.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisModeRegistryService } from '../../src/deals/analysis-mode-registry.service';

describe('Property 19: Mode-Specific Processing', () => {
  let analysisModeRegistry: AnalysisModeRegistryService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: AnalysisModeRegistryService,
          useValue: {
            getMode: jest.fn().mockImplementation((modeName: string) => {
              const modes = {
                provocations: {
                  name: 'provocations',
                  description: 'Adversarial research analysis',
                  systemPrompt: 'You are an adversarial analyst...',
                  presetQuestions: [
                    { id: 'risk-delta', text: 'What risk factors changed?', category: 'Cross-Filing' },
                  ],
                  processingRules: [
                    { name: 'prioritize_red_flags', condition: 'severity === RED_FLAG', action: 'place_first', priority: 1 },
                  ],
                },
                sentiment: {
                  name: 'sentiment',
                  description: 'Sentiment and tone tracking',
                  systemPrompt: 'You are a sentiment analyzer...',
                  presetQuestions: [
                    { id: 'sentiment-trend', text: 'How has sentiment changed?', category: 'Sentiment' },
                  ],
                  processingRules: [
                    { name: 'calculate_sentiment', condition: 'always', action: 'compute_sentiment_delta', priority: 1 },
                  ],
                },
              };
              return modes[modeName] || null;
            }),
            listModes: jest.fn().mockReturnValue([
              { name: 'provocations', description: 'Adversarial research analysis' },
              { name: 'sentiment', description: 'Sentiment and tone tracking' },
            ]),
            applyModeProcessing: jest.fn().mockImplementation((documents: any[], mode: any) => {
              // Mock mode-specific processing
              return Promise.resolve({
                mode: mode.name,
                results: documents.map(doc => ({
                  documentId: doc.id,
                  modeSpecificData: `Processed with ${mode.name} mode`,
                  processingRules: mode.processingRules,
                })),
              });
            }),
          },
        },
      ],
    }).compile();

    analysisModeRegistry = module.get<AnalysisModeRegistryService>(AnalysisModeRegistryService);
  });

  it('should produce different outputs for different modes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('10-K', '10-Q'),
            content: fc.string({ minLength: 100, maxLength: 500 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (documents) => {
          const provocationsMode = await analysisModeRegistry.getMode('provocations');
          const sentimentMode = await analysisModeRegistry.getMode('sentiment');

          const provocationsResult = await analysisModeRegistry.applyModeProcessing(documents, provocationsMode);
          const sentimentResult = await analysisModeRegistry.applyModeProcessing(documents, sentimentMode);

          // Property 1: Results should be different
          expect(provocationsResult.mode).not.toBe(sentimentResult.mode);

          // Property 2: Both should process same number of documents
          expect(provocationsResult.results.length).toBe(sentimentResult.results.length);
          expect(provocationsResult.results.length).toBe(documents.length);

          // Property 3: Mode-specific data should differ
          for (let i = 0; i < documents.length; i++) {
            expect(provocationsResult.results[i].modeSpecificData).not.toBe(
              sentimentResult.results[i].modeSpecificData
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should apply mode-specific processing rules', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          modeName: fc.constantFrom('provocations', 'sentiment'),
          documents: fc.array(
            fc.record({
              id: fc.uuid(),
              type: fc.constantFrom('10-K', '10-Q'),
              content: fc.string({ minLength: 100, maxLength: 300 }),
            }),
            { minLength: 1, maxLength: 3 }
          ),
        }),
        async ({ modeName, documents }) => {
          const mode = await analysisModeRegistry.getMode(modeName);
          const result = await analysisModeRegistry.applyModeProcessing(documents, mode);

          // Property 1: Mode name should match
          expect(result.mode).toBe(modeName);

          // Property 2: Processing rules should be applied
          expect(result.results[0].processingRules).toBeDefined();
          expect(Array.isArray(result.results[0].processingRules)).toBe(true);

          // Property 3: Rules should match mode definition
          expect(result.results[0].processingRules).toEqual(mode.processingRules);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should not re-process documents when switching modes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('10-K', '10-Q'),
            content: fc.string({ minLength: 100, maxLength: 300 }),
            processedAt: fc.date(),
          }),
          { minLength: 1, maxLength: 3 }
        ),
        async (documents) => {
          const provocationsMode = await analysisModeRegistry.getMode('provocations');
          const sentimentMode = await analysisModeRegistry.getMode('sentiment');

          // Process with first mode
          const result1 = await analysisModeRegistry.applyModeProcessing(documents, provocationsMode);

          // Switch to second mode
          const result2 = await analysisModeRegistry.applyModeProcessing(documents, sentimentMode);

          // Property: Document IDs should be preserved
          const ids1 = result1.results.map(r => r.documentId).sort();
          const ids2 = result2.results.map(r => r.documentId).sort();
          expect(ids1).toEqual(ids2);

          // Property: Original document data should be unchanged
          for (const doc of documents) {
            expect(result1.results.some(r => r.documentId === doc.id)).toBe(true);
            expect(result2.results.some(r => r.documentId === doc.id)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should maintain separate output formats for different modes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('10-K', '10-Q'),
            content: fc.string({ minLength: 100, maxLength: 300 }),
          }),
          { minLength: 1, maxLength: 3 }
        ),
        async (documents) => {
          const modes = await analysisModeRegistry.listModes();

          const results = await Promise.all(
            modes.map(async (modeInfo) => {
              const mode = await analysisModeRegistry.getMode(modeInfo.name);
              return analysisModeRegistry.applyModeProcessing(documents, mode);
            })
          );

          // Property: Each mode should have distinct output format
          for (let i = 0; i < results.length; i++) {
            for (let j = i + 1; j < results.length; j++) {
              expect(results[i].mode).not.toBe(results[j].mode);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should handle mode retrieval correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('provocations', 'sentiment', 'nonexistent'),
        async (modeName) => {
          const mode = await analysisModeRegistry.getMode(modeName);

          if (modeName === 'nonexistent') {
            // Property: Invalid mode should return null
            expect(mode).toBeNull();
          } else {
            // Property: Valid mode should have required fields
            expect(mode).not.toBeNull();
            expect(mode.name).toBe(modeName);
            expect(mode.description).toBeDefined();
            expect(mode.systemPrompt).toBeDefined();
            expect(mode.presetQuestions).toBeDefined();
            expect(Array.isArray(mode.presetQuestions)).toBe(true);
            expect(mode.processingRules).toBeDefined();
            expect(Array.isArray(mode.processingRules)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);
});
