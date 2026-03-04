/**
 * IR Page Finder Agent — discovers company investor relations pages.
 * Phase 4 of Filing Expansion spec (§6.3).
 *
 * Uses web browsing + LLM analysis to find and map IR page structure.
 * Caches results in IrPageMapping table with staleness detection.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../rag/bedrock.service';
import { WebBrowseTool, BrowseResult } from './tools/web-browse.tool';

export interface IrPageMapping {
  ticker: string;
  companyName: string;
  irBaseUrl: string;
  earningsPage: string | null;
  transcriptsPage: string | null;
  secFilingsPage: string | null;
  pressReleasesPage: string | null;
  webcasts: string | null;
  confidence: number;
  notes: string;
  lastVerified: Date;
  verificationFailures: number;
}

@Injectable()
export class IrPageFinderAgent {
  private readonly logger = new Logger(IrPageFinderAgent.name);
  private readonly webBrowse = new WebBrowseTool();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
  ) {}

  /**
   * Find the IR page for a company. Uses cache if fresh, otherwise discovers.
   */
  async findIrPage(ticker: string, companyName: string): Promise<IrPageMapping> {
    // Check cache
    const cached = await this.getFromCache(ticker);
    if (cached && !this.isStale(cached)) {
      this.logger.log(`IR page cache hit for ${ticker}: ${cached.irBaseUrl}`);
      return cached;
    }

    this.logger.log(`Discovering IR page for ${ticker} (${companyName})`);

    // Common IR page patterns to try first (fast path)
    const irUrl = await this.tryCommonPatterns(ticker, companyName);

    if (irUrl) {
      const mapping = await this.mapIrPageStructure(irUrl, ticker, companyName);
      await this.cacheMapping(mapping);
      return mapping;
    }

    // Fallback: use LLM to identify IR page from search-like heuristics
    const fallbackMapping = this.createLowConfidenceMapping(ticker, companyName);
    await this.cacheMapping(fallbackMapping);
    return fallbackMapping;
  }

  /**
   * Try common IR page URL patterns before resorting to web search.
   */
  private async tryCommonPatterns(ticker: string, companyName: string): Promise<string | null> {
    // Common IR page URL patterns
    const companySlug = companyName.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 30);

    const patterns = [
      `https://investor.${companySlug}.com`,
      `https://ir.${companySlug}.com`,
      `https://investors.${companySlug}.com`,
      `https://www.${companySlug}.com/investor-relations`,
      `https://www.${companySlug}.com/investors`,
    ];

    for (const url of patterns) {
      try {
        const result = await this.webBrowse.execute({ url });
        if (result.statusCode === 200 && result.text.length > 500) {
          // Verify this looks like an IR page
          const textLower = result.text.toLowerCase();
          const irSignals = [
            'investor relations', 'quarterly results', 'earnings',
            'sec filings', 'annual report', 'press release',
            'financial results', 'stockholder',
          ];
          const signalCount = irSignals.filter(s => textLower.includes(s)).length;
          if (signalCount >= 2) {
            this.logger.log(`Found IR page via pattern: ${url}`);
            return url;
          }
        }
      } catch {
        // Pattern didn't work, try next
      }
    }

    return null;
  }

  /**
   * Map the structure of an IR page using LLM analysis.
   */
  async mapIrPageStructure(
    irUrl: string,
    ticker: string,
    companyName: string,
  ): Promise<IrPageMapping> {
    let page: BrowseResult;
    try {
      page = await this.webBrowse.execute({ url: irUrl });
    } catch (error) {
      this.logger.warn(`Failed to browse IR page ${irUrl}: ${error.message}`);
      return this.createLowConfidenceMapping(ticker, companyName);
    }

    const prompt = `You are navigating the investor relations website for ${companyName} (${ticker}).

PAGE URL: ${irUrl}
PAGE CONTENT: ${page.text.substring(0, 8000)}
LINKS: ${page.links.slice(0, 50).map(l => `${l.text} -> ${l.href}`).join('\n')}

Identify URLs for each section. Set null if not found.
Respond as JSON only:
{
  "earningsPage": "URL to quarterly earnings page or null",
  "transcriptsPage": "URL to transcripts page or null",
  "secFilingsPage": "URL to SEC filings page or null",
  "pressReleasesPage": "URL to press releases or null",
  "webcasts": "URL to webcasts/events or null",
  "confidence": 0.0-1.0,
  "notes": "brief observations"
}`;

    try {
      const response = await this.bedrock.invokeClaude({
        prompt,
        max_tokens: 1000,
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.createLowConfidenceMapping(ticker, companyName);
      }

      const structure = JSON.parse(jsonMatch[0]);

      return {
        ticker,
        companyName,
        irBaseUrl: irUrl,
        earningsPage: structure.earningsPage || null,
        transcriptsPage: structure.transcriptsPage || null,
        secFilingsPage: structure.secFilingsPage || null,
        pressReleasesPage: structure.pressReleasesPage || null,
        webcasts: structure.webcasts || null,
        confidence: Math.min(1.0, Math.max(0.0, structure.confidence || 0.5)),
        notes: structure.notes || '',
        lastVerified: new Date(),
        verificationFailures: 0,
      };
    } catch (error) {
      this.logger.error(`LLM IR page analysis failed: ${error.message}`);
      return this.createLowConfidenceMapping(ticker, companyName);
    }
  }

  private createLowConfidenceMapping(ticker: string, companyName: string): IrPageMapping {
    return {
      ticker,
      companyName,
      irBaseUrl: '',
      earningsPage: null,
      transcriptsPage: null,
      secFilingsPage: null,
      pressReleasesPage: null,
      webcasts: null,
      confidence: 0.1,
      notes: 'Could not discover IR page automatically',
      lastVerified: new Date(),
      verificationFailures: 1,
    };
  }

  private async getFromCache(ticker: string): Promise<IrPageMapping | null> {
    try {
      const records = await this.prisma.$queryRaw`
        SELECT ticker, company_name, ir_base_url, earnings_page_url,
               transcripts_page_url, sec_filings_page_url, press_releases_url,
               webcasts_url, confidence, notes, last_verified, verification_failures
        FROM ir_page_mappings WHERE ticker = ${ticker.toUpperCase()} LIMIT 1
      ` as any[];
      if (!records || records.length === 0) return null;
      const r = records[0];

      return {
        ticker: r.ticker,
        companyName: r.company_name,
        irBaseUrl: r.ir_base_url,
        earningsPage: r.earnings_page_url,
        transcriptsPage: r.transcripts_page_url,
        secFilingsPage: r.sec_filings_page_url,
        pressReleasesPage: r.press_releases_url,
        webcasts: r.webcasts_url,
        confidence: Number(r.confidence) || 0,
        notes: r.notes || '',
        lastVerified: new Date(r.last_verified),
        verificationFailures: r.verification_failures || 0,
      };
    } catch {
      return null;
    }
  }

  private async cacheMapping(mapping: IrPageMapping): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO ir_page_mappings (
          ticker, company_name, ir_base_url, earnings_page_url,
          transcripts_page_url, sec_filings_page_url, press_releases_url,
          webcasts_url, confidence, notes, last_verified, verification_failures
        ) VALUES (
          ${mapping.ticker.toUpperCase()}, ${mapping.companyName}, ${mapping.irBaseUrl},
          ${mapping.earningsPage}, ${mapping.transcriptsPage}, ${mapping.secFilingsPage},
          ${mapping.pressReleasesPage}, ${mapping.webcasts}, ${mapping.confidence},
          ${mapping.notes}, ${mapping.lastVerified}, ${mapping.verificationFailures}
        )
        ON CONFLICT (ticker) DO UPDATE SET
          company_name = EXCLUDED.company_name,
          ir_base_url = EXCLUDED.ir_base_url,
          earnings_page_url = EXCLUDED.earnings_page_url,
          transcripts_page_url = EXCLUDED.transcripts_page_url,
          sec_filings_page_url = EXCLUDED.sec_filings_page_url,
          press_releases_url = EXCLUDED.press_releases_url,
          webcasts_url = EXCLUDED.webcasts_url,
          confidence = EXCLUDED.confidence,
          notes = EXCLUDED.notes,
          last_verified = EXCLUDED.last_verified,
          verification_failures = EXCLUDED.verification_failures,
          updated_at = NOW()
      `;
    } catch (error) {
      this.logger.warn(`Failed to cache IR mapping: ${error.message}`);
    }
  }

  /**
   * Staleness detection (§6.3):
   * - >30 days old → stale
   * - verification failures + >7 days → stale
   * - low confidence + >14 days → stale
   */
  private isStale(mapping: IrPageMapping): boolean {
    const daysSince = (Date.now() - mapping.lastVerified.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 30) return true;
    if (mapping.verificationFailures > 0 && daysSince > 7) return true;
    if (mapping.confidence < 0.7 && daysSince > 14) return true;
    return false;
  }
}
