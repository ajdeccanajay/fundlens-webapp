/**
 * Property-Based Tests for Tenant Overlay Injection
 *
 * Feature: rag-chatbot-master-engineering, Property 12: Tenant overlay injection
 *
 * Property 12: Tenant overlay injection — For any FinancialAnalysisContext with
 * a `tenantId` that has a corresponding overlay YAML with `asset_class: 'private_equity'`,
 * the built prompt should contain the PE-specific synthesis instructions from the overlay.
 *
 * **Validates: Requirements 11.1, 11.2**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import {
  HybridSynthesisService,
  FinancialAnalysisContext,
  TenantOverlay,
} from '../../src/rag/hybrid-synthesis.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { PerformanceOptimizerService } from '../../src/rag/performance-optimizer.service';
import { QueryIntent, MetricResult, ChunkResult } from '../../src/rag/types/query-intent';

describe('Property Tests - Tenant Overlay Injection', () => {
  let service: HybridSynthesisService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridSynthesisService,
        {
          provide: BedrockService,
          useValue: { invokeClaude: jest.fn() },
        },
        {
          provide: PerformanceOptimizerService,
          useValue: { getModelId: jest.fn().mockReturnValue('claude-3-sonnet') },
        },
      ],
    }).compile();

    service = module.get<HybridSynthesisService>(HybridSynthesisService);
  });

  // ── Generators ─────────────────────────────────────────────────────

  const tickerArb = fc.constantFrom('AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'ABNB');

  const metricNameArb = fc.constantFrom(
    'revenue', 'net_income', 'gross_profit', 'operating_income',
    'ebitda', 'free_cash_flow',
  );

  const yearArb = fc.integer({ min: 2020, max: 2026 });
  const quarterArb = fc.integer({ min: 1, max: 4 });

  const fiscalPeriodArb = fc.oneof(
    yearArb.map((y) => `FY${y}`),
    fc.tuple(quarterArb, yearArb).map(([q, y]) => `Q${q}FY${y}`),
  );

  const metricResultArb = fc.tuple(
    tickerArb,
    metricNameArb,
    fiscalPeriodArb,
    fc.constantFrom('10-K', '10-Q'),
    fc.double({ min: 1, max: 999999, noNaN: true }),
  ).map(([ticker, metric, period, filingType, value]): MetricResult => ({
    ticker,
    normalizedMetric: metric,
    rawLabel: metric,
    value,
    fiscalPeriod: period,
    periodType: period.startsWith('Q') ? 'quarterly' : 'annual',
    filingType,
    statementType: 'income_statement',
    statementDate: new Date('2025-01-01'),
    filingDate: new Date('2025-02-01'),
    confidenceScore: 0.95,
    displayName: metric.replace(/_/g, ' '),
  }));

  const chunkResultArb = fc.tuple(
    tickerArb,
    fc.constantFrom('item_7', 'item_1a', 'item_1'),
    fiscalPeriodArb,
    fc.string({ minLength: 10, maxLength: 80 }),
  ).map(([ticker, sectionType, period, content]): ChunkResult => ({
    content,
    score: 0.85,
    metadata: {
      ticker,
      documentType: '10-K',
      filingType: '10-K',
      sectionType,
      fiscalPeriod: period,
      chunkIndex: 0,
    },
  }));

  const intentArb = fc.constant({
    type: 'hybrid' as const,
    originalQuery: 'test query',
    needsNarrative: true,
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
    confidence: 0.9,
  } as QueryIntent);

  /** Generate synthesis_instructions — non-empty strings that won't be truncated */
  const synthesisInstructionsArb = fc.constantFrom(
    'Focus on cash flow generation and capital allocation discipline.',
    'Emphasize margin of safety and balance sheet protection.',
    'Use PE terminology: owner earnings, asset discount, distributable cash.',
    'Evaluate management credibility through insider ownership.',
    'Prioritize FCF over revenue growth. Frame in terms of intrinsic value.',
  );

  /** Generate a PE tenant overlay with asset_class: 'private_equity' */
  const peOverlayArb = fc.tuple(
    fc.constantFrom('acme_pe', 'third_avenue', 'blackstone_fund', 'kkr_capital'),
    fc.constantFrom('Acme PE', 'Third Avenue', 'Blackstone Fund', 'KKR Capital'),
    synthesisInstructionsArb,
  ).map(([tenantId, displayName, instructions]): TenantOverlay => ({
    tenant_id: tenantId,
    display_name: displayName,
    asset_class: 'private_equity',
    synthesis_instructions: instructions,
  }));

  /** Generate a non-PE tenant overlay (asset_class !== 'private_equity') */
  const nonPeOverlayArb = fc.tuple(
    fc.constantFrom('hedge_alpha', 'quant_fund', 'long_only_mgmt'),
    fc.constantFrom('Hedge Alpha', 'Quant Fund', 'Long Only Mgmt'),
    fc.constantFrom('hedge_fund', 'quantitative', 'long_only', 'mutual_fund') as fc.Arbitrary<string>,
    synthesisInstructionsArb,
  ).map(([tenantId, displayName, assetClass, instructions]): TenantOverlay => ({
    tenant_id: tenantId,
    display_name: displayName,
    asset_class: assetClass,
    synthesis_instructions: instructions,
  }));

  /** Build a FinancialAnalysisContext with a tenantId */
  const contextWithTenantArb = (tenantId: string) =>
    fc.tuple(
      fc.array(metricResultArb, { minLength: 1, maxLength: 3 }),
      fc.array(chunkResultArb, { minLength: 0, maxLength: 2 }),
      intentArb,
    ).map(([metrics, narratives, intent]): FinancialAnalysisContext => ({
      originalQuery: 'What is the free cash flow for AAPL?',
      intent,
      metrics,
      narratives,
      computedResults: [],
      modelTier: 'sonnet',
      tenantId,
    }));

  /** Build a FinancialAnalysisContext without tenantId */
  const contextWithoutTenantArb = fc.tuple(
    fc.array(metricResultArb, { minLength: 1, maxLength: 3 }),
    fc.array(chunkResultArb, { minLength: 0, maxLength: 2 }),
    intentArb,
  ).map(([metrics, narratives, intent]): FinancialAnalysisContext => ({
    originalQuery: 'What is the revenue for MSFT?',
    intent,
    metrics,
    narratives,
    computedResults: [],
    modelTier: 'sonnet',
  }));

  // ── Property 12 Tests ─────────────────────────────────────────────

  describe('Feature: rag-chatbot-master-engineering, Property 12: Tenant overlay injection', () => {
    /**
     * **Validates: Requirements 11.1, 11.2**
     */

    it('prompt contains TENANT-SPECIFIC CONTEXT and PE synthesis instructions when overlay has asset_class private_equity', () => {
      fc.assert(
        fc.property(peOverlayArb, (overlay) => {
          // Mock loadTenantOverlay to return the generated PE overlay
          jest.spyOn(service, 'loadTenantOverlay').mockReturnValue(overlay);

          const ctx: FinancialAnalysisContext = {
            originalQuery: 'What is the FCF for AAPL?',
            intent: {
              type: 'hybrid' as const,
              originalQuery: 'What is the FCF for AAPL?',
              needsNarrative: true,
              needsComparison: false,
              needsComputation: false,
              needsTrend: false,
              confidence: 0.9,
            } as QueryIntent,
            metrics: [{
              ticker: 'AAPL',
              normalizedMetric: 'free_cash_flow',
              rawLabel: 'free_cash_flow',
              value: 100000,
              fiscalPeriod: 'FY2024',
              periodType: 'annual' as const,
              filingType: '10-K',
              statementType: 'cash_flow',
              statementDate: new Date('2025-01-01'),
              filingDate: new Date('2025-02-01'),
              confidenceScore: 0.95,
              displayName: 'Free Cash Flow',
            }],
            narratives: [],
            computedResults: [],
            modelTier: 'sonnet',
            tenantId: overlay.tenant_id,
          };

          const prompt = service.buildStructuredPrompt(ctx);

          expect(prompt).toContain('TENANT-SPECIFIC CONTEXT');
          expect(prompt).toContain('Asset Class: Private Equity');
          expect(prompt).toContain(overlay.synthesis_instructions!);
          expect(prompt).toContain(overlay.display_name);
        }),
        { numRuns: 10 },
      );
    });

    it('prompt contains synthesis instructions but NOT "Private Equity" when overlay has non-PE asset_class', () => {
      fc.assert(
        fc.property(nonPeOverlayArb, (overlay) => {
          jest.spyOn(service, 'loadTenantOverlay').mockReturnValue(overlay);

          const ctx: FinancialAnalysisContext = {
            originalQuery: 'What is the revenue for MSFT?',
            intent: {
              type: 'hybrid' as const,
              originalQuery: 'What is the revenue for MSFT?',
              needsNarrative: true,
              needsComparison: false,
              needsComputation: false,
              needsTrend: false,
              confidence: 0.9,
            } as QueryIntent,
            metrics: [{
              ticker: 'MSFT',
              normalizedMetric: 'revenue',
              rawLabel: 'revenue',
              value: 200000,
              fiscalPeriod: 'FY2024',
              periodType: 'annual' as const,
              filingType: '10-K',
              statementType: 'income_statement',
              statementDate: new Date('2025-01-01'),
              filingDate: new Date('2025-02-01'),
              confidenceScore: 0.95,
              displayName: 'Revenue',
            }],
            narratives: [],
            computedResults: [],
            modelTier: 'sonnet',
            tenantId: overlay.tenant_id,
          };

          const prompt = service.buildStructuredPrompt(ctx);

          expect(prompt).toContain('TENANT-SPECIFIC CONTEXT');
          expect(prompt).toContain(overlay.synthesis_instructions!);
          expect(prompt).toContain(overlay.display_name);
          expect(prompt).not.toContain('Asset Class: Private Equity');
        }),
        { numRuns: 10 },
      );
    });

    it('prompt does NOT contain TENANT-SPECIFIC CONTEXT when overlay is null', () => {
      fc.assert(
        fc.property(contextWithoutTenantArb, (ctx) => {
          // No tenantId means no overlay loading
          jest.spyOn(service, 'loadTenantOverlay').mockReturnValue(null);

          const ctxWithTenant = { ...ctx, tenantId: 'nonexistent_tenant' };
          const prompt = service.buildStructuredPrompt(ctxWithTenant);

          expect(prompt).not.toContain('TENANT-SPECIFIC CONTEXT');
          expect(prompt).not.toContain('Asset Class: Private Equity');
        }),
        { numRuns: 10 },
      );
    });

    it('prompt does NOT contain TENANT-SPECIFIC CONTEXT when tenantId is absent', () => {
      fc.assert(
        fc.property(contextWithoutTenantArb, (ctx) => {
          const prompt = service.buildStructuredPrompt(ctx);

          expect(prompt).not.toContain('TENANT-SPECIFIC CONTEXT');
        }),
        { numRuns: 10 },
      );
    });

    it('tenant display_name appears in prompt when overlay is loaded', () => {
      fc.assert(
        fc.property(peOverlayArb, (overlay) => {
          jest.spyOn(service, 'loadTenantOverlay').mockReturnValue(overlay);

          const ctx: FinancialAnalysisContext = {
            originalQuery: 'Analyze leverage for ABNB',
            intent: {
              type: 'hybrid' as const,
              originalQuery: 'Analyze leverage for ABNB',
              needsNarrative: true,
              needsComparison: false,
              needsComputation: false,
              needsTrend: false,
              confidence: 0.9,
            } as QueryIntent,
            metrics: [{
              ticker: 'ABNB',
              normalizedMetric: 'ebitda',
              rawLabel: 'ebitda',
              value: 50000,
              fiscalPeriod: 'FY2024',
              periodType: 'annual' as const,
              filingType: '10-K',
              statementType: 'income_statement',
              statementDate: new Date('2025-01-01'),
              filingDate: new Date('2025-02-01'),
              confidenceScore: 0.95,
              displayName: 'EBITDA',
            }],
            narratives: [],
            computedResults: [],
            modelTier: 'sonnet',
            tenantId: overlay.tenant_id,
          };

          const prompt = service.buildStructuredPrompt(ctx);

          expect(prompt).toContain(`Tenant: ${overlay.display_name}`);
        }),
        { numRuns: 10 },
      );
    });
  });
});
