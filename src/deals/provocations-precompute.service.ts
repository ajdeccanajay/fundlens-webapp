import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TemporalDiffEngineService } from './temporal-diff-engine.service';
import { ProvocationGeneratorService } from './provocation-generator.service';

@Injectable()
export class ProvocationsPrecomputeService {
  private readonly logger = new Logger(ProvocationsPrecomputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly diffEngine: TemporalDiffEngineService,
    private readonly provocationGenerator: ProvocationGeneratorService,
  ) {}

  /**
   * Pre-compute diffs when a new filing is ingested.
   * Compares against the 2 most recent prior filings of the same type.
   */
  async preComputeDiffs(ticker: string, filingType: string, newFilingDate: Date): Promise<void> {
    this.logger.log(`Pre-computing diffs for ${ticker} ${filingType} ${newFilingDate.toISOString()}`);

    // Find prior filings of the same type
    const priorFilings = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker,
        filingType,
        filingDate: { lt: newFilingDate },
      },
      distinct: ['filingDate'],
      orderBy: { filingDate: 'desc' },
      take: 2,
      select: { filingDate: true },
    });

    for (const prior of priorFilings) {
      try {
        await this.diffEngine.compareDocuments(
          ticker, filingType, prior.filingDate, newFilingDate,
        );
        this.logger.log(`Diff computed: ${prior.filingDate.toISOString()} → ${newFilingDate.toISOString()}`);
      } catch (error) {
        this.logger.error(`Diff computation failed: ${error.message}`);
      }
    }
  }

  /**
   * Pre-generate provocations for a ticker and cache them.
   */
  async preGenerateProvocations(ticker: string, analysisMode: string = 'provocations'): Promise<void> {
    this.logger.log(`Pre-generating provocations for ${ticker} mode=${analysisMode}`);

    // Check cache first
    const cached = await this.prisma.provocationsCache.findFirst({
      where: {
        ticker,
        analysisMode,
        expiresAt: { gt: new Date() },
      },
    });

    if (cached) {
      this.logger.log(`Cache hit for ${ticker} ${analysisMode}`);
      return;
    }

    // Get the two most recent filing dates
    const filings = await this.prisma.narrativeChunk.findMany({
      where: { ticker },
      distinct: ['filingDate', 'filingType'],
      orderBy: { filingDate: 'desc' },
      take: 4,
      select: { filingDate: true, filingType: true },
    });

    if (filings.length < 2) {
      this.logger.log(`Not enough filings for ${ticker} to generate provocations`);
      return;
    }

    // Group by filing type and compare most recent pairs
    const byType = new Map<string, Date[]>();
    for (const f of filings) {
      const dates = byType.get(f.filingType) || [];
      dates.push(f.filingDate);
      byType.set(f.filingType, dates);
    }

    const allProvocations: any[] = [];

    for (const [filingType, dates] of byType) {
      if (dates.length < 2) continue;
      const [newer, older] = dates;

      try {
        const diff = await this.diffEngine.compareDocuments(ticker, filingType, older, newer);
        const provocations = await this.provocationGenerator.generateProvocations(diff, analysisMode);
        allProvocations.push(...provocations);
      } catch (error) {
        this.logger.error(`Provocation generation failed for ${ticker} ${filingType}: ${error.message}`);
      }
    }

    if (allProvocations.length > 0) {
      // Cache results
      await this.prisma.provocationsCache.create({
        data: {
          ticker,
          analysisMode,
          provocations: allProvocations as any,
          sourceDocuments: filings.map(f => `${f.filingType}-${f.filingDate.toISOString()}`),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        },
      });

      // Also save individual provocations
      await this.provocationGenerator.saveProvocations(ticker, analysisMode, allProvocations);
      this.logger.log(`Cached ${allProvocations.length} provocations for ${ticker}`);
    }
  }

  /**
   * Get cached provocations or generate on-demand.
   */
  async getProvocations(ticker: string, analysisMode: string = 'provocations'): Promise<any[]> {
    // Check cache
    const cached = await this.prisma.provocationsCache.findFirst({
      where: {
        ticker,
        analysisMode,
        expiresAt: { gt: new Date() },
      },
      orderBy: { computedAt: 'desc' },
    });

    if (cached) {
      return cached.provocations as any[];
    }

    // Generate on-demand
    await this.preGenerateProvocations(ticker, analysisMode);

    // Return from DB
    const provocations = await this.prisma.provocation.findMany({
      where: { ticker, analysisMode },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return provocations;
  }

  /**
   * Get the 5 pre-computed value investing provocations.
   * These are generated immediately on workspace load - no waiting for 3 queries.
   */
  async getValueInvestingProvocations(ticker: string): Promise<any[]> {
    const upperTicker = ticker.toUpperCase();
    this.logger.log(`Getting value investing provocations for ${upperTicker}`);

    // Check cache first (use special mode name)
    const cached = await this.prisma.provocationsCache.findFirst({
      where: {
        ticker: upperTicker,
        analysisMode: 'value_investing_precomputed',
        expiresAt: { gt: new Date() },
      },
      orderBy: { computedAt: 'desc' },
    });

    if (cached && Array.isArray(cached.provocations) && cached.provocations.length > 0) {
      this.logger.log(`Cache hit for ${upperTicker} value investing provocations`);
      return cached.provocations as any[];
    }

    // Generate fresh provocations
    this.logger.log(`Generating fresh value investing provocations for ${upperTicker}`);
    const provocations = await this.provocationGenerator.generateValueInvestingProvocations(upperTicker);

    if (provocations.length > 0) {
      // Cache results for 24 hours
      await this.prisma.provocationsCache.create({
        data: {
          ticker: upperTicker,
          analysisMode: 'value_investing_precomputed',
          provocations: provocations as any,
          sourceDocuments: ['10-K', '10-Q'],
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      // Also save individual provocations
      await this.provocationGenerator.saveProvocations(upperTicker, 'value_investing_precomputed', provocations);
      this.logger.log(`Cached ${provocations.length} value investing provocations for ${upperTicker}`);
    }

    return provocations;
  }

  /**
   * Invalidate cache for a ticker (call when new filings are ingested).
   */
  async invalidateCache(ticker: string): Promise<void> {
    const upperTicker = ticker.toUpperCase();
    await this.prisma.provocationsCache.deleteMany({
      where: { ticker: upperTicker },
    });
    this.logger.log(`Invalidated provocations cache for ${upperTicker}`);
  }
}
