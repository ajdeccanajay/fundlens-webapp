/**
 * IR Page Finder Agent — discovers company investor relations pages.
 * Phase 4 of Filing Expansion spec (§6.3).
 *
 * STRATEGY (multi-layer, never gives up):
 * 1. Cache check (fast path)
 * 2. Common URL patterns (investor.company.com, ir.company.com, etc.)
 * 3. DuckDuckGo HTML search (free, no API key) — multiple query strategies
 * 4. LLM-guided link analysis from search results
 * 5. Deep navigation: follow promising links to find earnings/transcripts pages
 *
 * All free. No paid APIs. No subscriptions.
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

// Signals that indicate a page is an IR page
const IR_SIGNALS = [
  'investor relations', 'quarterly results', 'earnings',
  'sec filings', 'annual report', 'press release',
  'financial results', 'stockholder', 'shareholder',
  'quarterly earnings', 'earnings call', 'transcript',
];

// Signals for earnings/transcript sub-pages
const EARNINGS_SIGNALS = [
  'earnings call', 'transcript', 'quarterly results',
  'earnings release', 'conference call', 'webcast',
];

interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

@Injectable()
export class IrPageFinderAgent {
  private readonly logger = new Logger(IrPageFinderAgent.name);
  private readonly webBrowse = new WebBrowseTool();

  // In-memory cache (persisted to DB when available)
  private readonly cache = new Map<string, IrPageMapping>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
  ) {}

  /**
   * Main entry point — find the IR page for a company.
   * Never returns confidence < 0.3 without exhausting ALL strategies.
   */
  async findIrPage(ticker: string, companyName: string): Promise<IrPageMapping> {
    const upperTicker = ticker.toUpperCase();
    this.logger.log(`Finding IR page for ${upperTicker} (${companyName})`);

    // Strategy 1: Cache check
    const cached = await this.getFromCache(upperTicker);
    if (cached && !this.isStale(cached)) {
      this.logger.log(`Cache hit for ${upperTicker}: ${cached.irBaseUrl} (confidence: ${cached.confidence})`);
      return cached;
    }

    // Strategy 2: Common URL patterns
    const patternResult = await this.tryCommonPatterns(upperTicker, companyName);
    if (patternResult && patternResult.confidence >= 0.7) {
      this.logger.log(`Pattern match for ${upperTicker}: ${patternResult.irBaseUrl}`);
      await this.cacheMapping(patternResult);
      return patternResult;
    }

    // Strategy 3: DuckDuckGo search + LLM analysis
    const searchResult = await this.findIrPageViaSearch(upperTicker, companyName);
    if (searchResult && searchResult.confidence >= 0.5) {
      this.logger.log(`Search found IR page for ${upperTicker}: ${searchResult.irBaseUrl}`);
      await this.cacheMapping(searchResult);
      return searchResult;
    }

    // Strategy 4: If we got a low-confidence pattern result, try to improve it with deep nav
    const bestSoFar = searchResult || patternResult;
    if (bestSoFar && bestSoFar.irBaseUrl) {
      const deepResult = await this.deepNavigate(bestSoFar);
      if (deepResult.confidence > bestSoFar.confidence) {
        this.logger.log(`Deep nav improved confidence for ${upperTicker}: ${deepResult.confidence}`);
        await this.cacheMapping(deepResult);
        return deepResult;
      }
    }

    // Strategy 5: Last resort — try company website root + /investors
    const lastResort = await this.tryCompanyWebsiteRoot(upperTicker, companyName);
    if (lastResort && lastResort.confidence >= 0.3) {
      await this.cacheMapping(lastResort);
      return lastResort;
    }

    // Return best result we have, even if low confidence
    if (bestSoFar) {
      // Bump confidence to at least 0.3 if we found SOMETHING
      if (bestSoFar.irBaseUrl && bestSoFar.confidence < 0.3) {
        bestSoFar.confidence = 0.3;
        bestSoFar.notes += ' [confidence floor applied — URL found but unverified]';
      }
      await this.cacheMapping(bestSoFar);
      return bestSoFar;
    }

    return this.createLowConfidenceMapping(upperTicker, companyName, 'All strategies exhausted');
  }

  // ─── Strategy 2: Common URL Patterns ───────────────────────────────

  private async tryCommonPatterns(ticker: string, companyName: string): Promise<IrPageMapping | null> {
    // Derive company domain slug from name (e.g., "Apple Inc." → "apple")
    const slug = companyName
      .replace(/\s*(Inc\.?|Corp\.?|Ltd\.?|LLC|PLC|N\.?V\.?|S\.?A\.?|Co\.?|Group|Holdings?|International)\s*/gi, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    const patterns = [
      `https://investor.${slug}.com`,
      `https://investors.${slug}.com`,
      `https://ir.${slug}.com`,
      `https://www.${slug}.com/investor-relations`,
      `https://www.${slug}.com/investors`,
      `https://${slug}.com/investor-relations`,
      `https://${slug}.com/investors`,
    ];

    for (const url of patterns) {
      try {
        const result = await this.webBrowse.execute({ url });
        const irScore = this.scoreIrPage(result);
        if (irScore >= 0.5) {
          const mapping = this.createBaseMapping(ticker, companyName);
          mapping.irBaseUrl = result.url; // Use final URL after redirects
          mapping.confidence = Math.min(0.9, 0.5 + irScore * 0.4);
          mapping.notes = `Found via URL pattern: ${url}`;
          await this.extractSubPages(result, mapping);
          return mapping;
        }
      } catch {
        // Pattern didn't work, try next
      }
    }

    return null;
  }

  // ─── Strategy 3: DuckDuckGo Search ─────────────────────────────────

  /**
   * Search DuckDuckGo HTML (free, no API key) for the company's IR page.
   */
  private async searchWithDuckDuckGo(query: string): Promise<DuckDuckGoResult[]> {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn(`DuckDuckGo search failed: HTTP ${response.status}`);
        return [];
      }

      const html = await response.text();
      return this.parseDuckDuckGoResults(html);
    } catch (error) {
      this.logger.warn(`DuckDuckGo search error: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse DuckDuckGo HTML search results page.
   */
  private parseDuckDuckGoResults(html: string): DuckDuckGoResult[] {
    const results: DuckDuckGoResult[] = [];

    try {
      const cheerio = require('cheerio');
      const $ = cheerio.load(html);

      // DuckDuckGo HTML results are in .result elements
      $('.result').each((_: number, el: any) => {
        const titleEl = $(el).find('.result__a');
        const snippetEl = $(el).find('.result__snippet');
        const title = titleEl.text().trim();
        let href = titleEl.attr('href') || '';

        // DuckDuckGo wraps URLs in redirect — extract the actual URL
        if (href.includes('uddg=')) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) {
            href = decodeURIComponent(match[1]);
          }
        }

        const snippet = snippetEl.text().trim();

        if (title && href && href.startsWith('http')) {
          results.push({ title, url: href, snippet });
        }
      });
    } catch (error) {
      // Fallback: regex-based extraction
      const linkRegex = /class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)</g;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(html)) !== null) {
        let href = match[1];
        if (href.includes('uddg=')) {
          const uddgMatch = href.match(/uddg=([^&]+)/);
          if (uddgMatch) href = decodeURIComponent(uddgMatch[1]);
        }
        if (href.startsWith('http')) {
          results.push({ title: match[2].trim(), url: href, snippet: '' });
        }
      }
    }

    return results.slice(0, 15);
  }

  /**
   * Multi-query search strategy: try several queries, combine results.
   */
  private async findIrPageViaSearch(ticker: string, companyName: string): Promise<IrPageMapping | null> {
    const queries = [
      `${ticker} investor relations earnings transcripts`,
      `${companyName} investor relations`,
      `${companyName} earnings call transcript site:${this.guessCompanyDomain(companyName)}`,
      `"${ticker}" "investor relations" site:${this.guessCompanyDomain(companyName)}`,
    ];

    const allResults: DuckDuckGoResult[] = [];

    for (const query of queries) {
      const results = await this.searchWithDuckDuckGo(query);
      allResults.push(...results);
      // If we got good results, don't need more queries
      if (results.length >= 5) break;
    }

    if (allResults.length === 0) {
      this.logger.warn(`No DuckDuckGo results for ${ticker}`);
      return null;
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const uniqueResults = allResults.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    // Use LLM to pick the best IR page URL from search results
    const bestUrl = await this.llmPickBestIrUrl(ticker, companyName, uniqueResults);
    if (!bestUrl) return null;

    // Browse the selected URL and verify it's an IR page
    try {
      const page = await this.webBrowse.execute({ url: bestUrl });
      const irScore = this.scoreIrPage(page);

      const mapping = this.createBaseMapping(ticker, companyName);
      mapping.irBaseUrl = page.url;
      mapping.confidence = Math.min(0.95, 0.4 + irScore * 0.5);
      mapping.notes = `Found via DuckDuckGo search (IR score: ${irScore.toFixed(2)})`;
      await this.extractSubPages(page, mapping);
      return mapping;
    } catch (error) {
      this.logger.warn(`Failed to browse search result ${bestUrl}: ${error.message}`);
      // Still return a mapping with the URL — it might work later
      const mapping = this.createBaseMapping(ticker, companyName);
      mapping.irBaseUrl = bestUrl;
      mapping.confidence = 0.35;
      mapping.notes = `URL from search but browse failed: ${error.message}`;
      return mapping;
    }
  }

  /**
   * Use LLM to pick the best IR page URL from search results.
   */
  private async llmPickBestIrUrl(
    ticker: string,
    companyName: string,
    results: DuckDuckGoResult[],
  ): Promise<string | null> {
    const resultsText = results
      .slice(0, 15)
      .map((r, i) => `${i + 1}. [${r.title}] ${r.url}\n   ${r.snippet}`)
      .join('\n');

    const prompt = `You are identifying the investor relations page for ${companyName} (ticker: ${ticker}).

Here are web search results:
${resultsText}

Which URL is most likely the company's official investor relations page where earnings call transcripts would be found?

Rules:
- Prefer the company's OWN website (not third-party sites like seekingalpha, yahoo, marketwatch)
- Look for URLs containing "investor", "ir", "earnings", "quarterly-results"
- The URL should be from the company's official domain
- If multiple good options, pick the one most likely to have earnings transcripts

Return ONLY the URL, nothing else. If none are suitable, return "NONE".`;

    try {
      const response = await this.bedrock.invokeClaude({
        prompt,
        max_tokens: 200,
      });

      const url = response.trim();
      if (url === 'NONE' || !url.startsWith('http')) return null;
      return url;
    } catch (error) {
      this.logger.error(`LLM pick failed: ${error.message}`);
      // Fallback: pick the first result that looks like an IR page
      return this.heuristicPickBestUrl(results);
    }
  }

  /**
   * Heuristic fallback: pick the best URL without LLM.
   */
  private heuristicPickBestUrl(results: DuckDuckGoResult[]): string | null {
    const irKeywords = ['investor', 'ir.', 'earnings', 'quarterly-results', 'financial-results'];
    const thirdParty = ['seekingalpha', 'yahoo', 'marketwatch', 'reuters', 'bloomberg', 'fool.com', 'wsj.com'];

    for (const result of results) {
      const urlLower = result.url.toLowerCase();
      const isThirdParty = thirdParty.some(tp => urlLower.includes(tp));
      if (isThirdParty) continue;

      const hasIrSignal = irKeywords.some(kw => urlLower.includes(kw));
      if (hasIrSignal) return result.url;
    }

    // If nothing matched, return first non-third-party result
    for (const result of results) {
      const urlLower = result.url.toLowerCase();
      const isThirdParty = thirdParty.some(tp => urlLower.includes(tp));
      if (!isThirdParty) return result.url;
    }

    return null;
  }

  // ─── Strategy 5: Company Website Root ──────────────────────────────

  private async tryCompanyWebsiteRoot(ticker: string, companyName: string): Promise<IrPageMapping | null> {
    const domain = this.guessCompanyDomain(companyName);
    const rootUrls = [
      `https://www.${domain}`,
      `https://${domain}`,
    ];

    for (const rootUrl of rootUrls) {
      try {
        const page = await this.webBrowse.execute({ url: rootUrl });

        // Look for IR links on the homepage
        const irLinks = page.links.filter(link => {
          const text = link.text.toLowerCase();
          const href = link.href.toLowerCase();
          return IR_SIGNALS.some(sig => text.includes(sig) || href.includes(sig.replace(/\s/g, '-')));
        });

        if (irLinks.length > 0) {
          // Follow the first IR link
          const irLink = irLinks[0];
          try {
            const irPage = await this.webBrowse.execute({ url: irLink.href });
            const irScore = this.scoreIrPage(irPage);

            const mapping = this.createBaseMapping(ticker, companyName);
            mapping.irBaseUrl = irPage.url;
            mapping.confidence = Math.min(0.8, 0.3 + irScore * 0.5);
            mapping.notes = `Found via company homepage link: ${irLink.text}`;
            await this.extractSubPages(irPage, mapping);
            return mapping;
          } catch {
            // Link didn't work
          }
        }
      } catch {
        // Root URL didn't work
      }
    }

    return null;
  }

  // ─── Deep Navigation ───────────────────────────────────────────────

  /**
   * If we found an IR page but no earnings/transcripts link,
   * follow promising links one level deep.
   */
  private async deepNavigate(mapping: IrPageMapping): Promise<IrPageMapping> {
    if (mapping.earningsPage || mapping.transcriptsPage) {
      return mapping; // Already have what we need
    }

    try {
      const page = await this.webBrowse.execute({ url: mapping.irBaseUrl });

      // Find links that might lead to earnings/transcripts
      const earningsLinks = page.links.filter(link => {
        const text = link.text.toLowerCase();
        const href = link.href.toLowerCase();
        return EARNINGS_SIGNALS.some(sig =>
          text.includes(sig) || href.includes(sig.replace(/\s/g, '-')),
        );
      });

      for (const link of earningsLinks.slice(0, 3)) {
        try {
          const subPage = await this.webBrowse.execute({ url: link.href });
          const hasTranscripts = subPage.text.toLowerCase().includes('transcript') ||
            subPage.links.some(l => l.text.toLowerCase().includes('transcript'));

          if (hasTranscripts) {
            mapping.transcriptsPage = subPage.url;
            mapping.confidence = Math.max(mapping.confidence, 0.7);
            mapping.notes += ` | Deep nav found transcripts: ${link.text}`;
            return mapping;
          }

          // Check if it's an earnings page even without explicit "transcript" text
          const earningsScore = EARNINGS_SIGNALS.reduce((score, sig) =>
            score + (subPage.text.toLowerCase().includes(sig) ? 1 : 0), 0);

          if (earningsScore >= 2) {
            mapping.earningsPage = subPage.url;
            mapping.confidence = Math.max(mapping.confidence, 0.6);
            mapping.notes += ` | Deep nav found earnings page: ${link.text}`;
          }
        } catch {
          // Sub-page didn't load
        }
      }
    } catch {
      // Deep nav failed, return original
    }

    return mapping;
  }

  // ─── Page Scoring & Sub-page Extraction ────────────────────────────

  /**
   * Score how likely a page is to be an IR page (0-1).
   */
  private scoreIrPage(page: BrowseResult): number {
    const textLower = page.text.toLowerCase();
    let score = 0;

    for (const signal of IR_SIGNALS) {
      if (textLower.includes(signal)) score += 1;
    }

    // Bonus for URL signals
    const urlLower = page.url.toLowerCase();
    if (urlLower.includes('investor')) score += 2;
    if (urlLower.includes('/ir')) score += 1;

    // Normalize to 0-1
    return Math.min(1, score / 8);
  }

  /**
   * Extract sub-page URLs (earnings, transcripts, SEC filings, etc.) from an IR page.
   */
  private async extractSubPages(page: BrowseResult, mapping: IrPageMapping): Promise<void> {
    for (const link of page.links) {
      const text = link.text.toLowerCase();
      const href = link.href.toLowerCase();

      if (!mapping.earningsPage && (
        text.includes('earnings') || text.includes('quarterly results') ||
        href.includes('earnings') || href.includes('quarterly-results')
      )) {
        mapping.earningsPage = link.href;
      }

      if (!mapping.transcriptsPage && (
        text.includes('transcript') ||
        href.includes('transcript')
      )) {
        mapping.transcriptsPage = link.href;
      }

      if (!mapping.secFilingsPage && (
        text.includes('sec filing') || text.includes('sec filings') ||
        href.includes('sec-filing') || href.includes('sec_filing')
      )) {
        mapping.secFilingsPage = link.href;
      }

      if (!mapping.pressReleasesPage && (
        text.includes('press release') || text.includes('news') ||
        href.includes('press-release') || href.includes('news')
      )) {
        mapping.pressReleasesPage = link.href;
      }

      if (!mapping.webcasts && (
        text.includes('webcast') || text.includes('audio') ||
        href.includes('webcast')
      )) {
        mapping.webcasts = link.href;
      }
    }
  }

  /**
   * Map the full structure of an IR page (called after initial discovery).
   */
  async mapIrPageStructure(mapping: IrPageMapping): Promise<IrPageMapping> {
    try {
      const page = await this.webBrowse.execute({ url: mapping.irBaseUrl });
      await this.extractSubPages(page, mapping);

      // If no transcripts page found, try deep navigation
      if (!mapping.transcriptsPage && !mapping.earningsPage) {
        await this.deepNavigate(mapping);
      }

      mapping.lastVerified = new Date();
      return mapping;
    } catch (error) {
      this.logger.warn(`Failed to map IR page structure: ${error.message}`);
      mapping.verificationFailures += 1;
      return mapping;
    }
  }

  // ─── Cache Management ──────────────────────────────────────────────

  async getFromCache(ticker: string): Promise<IrPageMapping | null> {
    // Check in-memory cache first
    const memCached = this.cache.get(ticker);
    if (memCached) return memCached;

    // Check database
    try {
      const rows = await this.prisma.$queryRaw`
        SELECT * FROM ir_page_mappings WHERE ticker = ${ticker} LIMIT 1
      ` as any[];

      if (rows.length > 0) {
        const row = rows[0];
        const mapping: IrPageMapping = {
          ticker: row.ticker,
          companyName: row.company_name,
          irBaseUrl: row.ir_base_url,
          earningsPage: row.earnings_page,
          transcriptsPage: row.transcripts_page,
          secFilingsPage: row.sec_filings_page,
          pressReleasesPage: row.press_releases_page,
          webcasts: row.webcasts,
          confidence: row.confidence,
          notes: row.notes || '',
          lastVerified: new Date(row.last_verified),
          verificationFailures: row.verification_failures || 0,
        };
        this.cache.set(ticker, mapping);
        return mapping;
      }
    } catch {
      // Table may not exist yet — that's fine
    }

    return null;
  }

  async cacheMapping(mapping: IrPageMapping): Promise<void> {
    // In-memory cache
    this.cache.set(mapping.ticker, mapping);

    // Persist to database
    try {
      await this.prisma.$executeRaw`
        INSERT INTO ir_page_mappings (
          ticker, company_name, ir_base_url, earnings_page, transcripts_page,
          sec_filings_page, press_releases_page, webcasts, confidence, notes,
          last_verified, verification_failures
        ) VALUES (
          ${mapping.ticker}, ${mapping.companyName}, ${mapping.irBaseUrl},
          ${mapping.earningsPage}, ${mapping.transcriptsPage},
          ${mapping.secFilingsPage}, ${mapping.pressReleasesPage},
          ${mapping.webcasts}, ${mapping.confidence}, ${mapping.notes},
          ${mapping.lastVerified}, ${mapping.verificationFailures}
        )
        ON CONFLICT (ticker) DO UPDATE SET
          ir_base_url = EXCLUDED.ir_base_url,
          earnings_page = EXCLUDED.earnings_page,
          transcripts_page = EXCLUDED.transcripts_page,
          sec_filings_page = EXCLUDED.sec_filings_page,
          press_releases_page = EXCLUDED.press_releases_page,
          webcasts = EXCLUDED.webcasts,
          confidence = EXCLUDED.confidence,
          notes = EXCLUDED.notes,
          last_verified = EXCLUDED.last_verified,
          verification_failures = EXCLUDED.verification_failures
      `;
    } catch (error) {
      this.logger.warn(`Failed to persist IR mapping to DB: ${error.message}`);
    }
  }

  isStale(mapping: IrPageMapping): boolean {
    const ageMs = Date.now() - mapping.lastVerified.getTime();
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
    return ageMs > maxAgeMs || mapping.verificationFailures > 3;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private createBaseMapping(ticker: string, companyName: string): IrPageMapping {
    return {
      ticker,
      companyName,
      irBaseUrl: '',
      earningsPage: null,
      transcriptsPage: null,
      secFilingsPage: null,
      pressReleasesPage: null,
      webcasts: null,
      confidence: 0,
      notes: '',
      lastVerified: new Date(),
      verificationFailures: 0,
    };
  }

  createLowConfidenceMapping(ticker: string, companyName: string, reason: string): IrPageMapping {
    return {
      ...this.createBaseMapping(ticker, companyName),
      confidence: 0.1,
      notes: `Low confidence: ${reason}`,
    };
  }

  /**
   * Guess the company's domain from its name.
   * e.g., "Shopify Inc." → "shopify.com", "Apple Inc." → "apple.com"
   */
  private guessCompanyDomain(companyName: string): string {
    const slug = companyName
      .replace(/\s*(Inc\.?|Corp\.?|Corporation|Ltd\.?|LLC|PLC|N\.?V\.?|S\.?A\.?|Co\.?|Group|Holdings?|International|Technologies|Technology|Platforms?|Entertainment|Communications?)\s*/gi, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    return `${slug}.com`;
  }
}
