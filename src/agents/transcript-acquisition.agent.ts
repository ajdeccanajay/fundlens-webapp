/**
 * Transcript Acquisition Agent — multi-strategy earnings call transcript search.
 * Phase 4 of Filing Expansion spec (§6.4).
 *
 * STRATEGIES (tried in order):
 * 1. Direct DuckDuckGo search for transcript text on company IR pages
 * 2. DuckDuckGo search for press releases containing earnings call transcripts
 * 3. Browse known IR page earnings/transcripts sub-pages
 * 4. Search for "{company} earnings call transcript Q{n} {year}" broadly
 *
 * All free. No paid APIs. No Seeking Alpha or subscription sites.
 */

import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../rag/bedrock.service';
import { WebBrowseTool, BrowseResult } from './tools/web-browse.tool';
import { IrPageMapping } from './ir-page-finder.agent';

export interface AvailableTranscript {
  quarterIdentifier: string; // e.g., "Q3FY2025"
  downloadUrl: string;
  format: 'html' | 'pdf' | 'audio';
  title: string;
  callDate?: string;
}

export interface TranscriptResult {
  ticker: string;
  quarter: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  content?: string;
}

// Blocked domains — subscription/paywall sites
const BLOCKED_DOMAINS = [
  'seekingalpha.com', 'motleyfool.com', 'tipranks.com',
  'zacks.com', 'thestreet.com', 'barrons.com', 'wsj.com',
  'bloomberg.com', 'reuters.com', 'ft.com', 'nasdaq.com/articles',
];

@Injectable()
export class TranscriptAcquisitionAgent {
  private readonly logger = new Logger(TranscriptAcquisitionAgent.name);
  private readonly webBrowse = new WebBrowseTool();

  constructor(
    private readonly bedrock: BedrockService,
  ) {}

  /**
   * Acquire transcripts for a ticker using multiple strategies.
   */
  async acquireTranscripts(
    irMapping: IrPageMapping,
    ticker: string,
    existingQuarters: string[],
  ): Promise<TranscriptResult[]> {
    this.logger.log(`🎙️ Acquiring transcripts for ${ticker} (existing: ${existingQuarters.length} quarters)`);

    const results: TranscriptResult[] = [];
    const acquiredQuarters = new Set(existingQuarters);

    // Determine which quarters we want (last 8 quarters)
    const targetQuarters = this.getTargetQuarters(8);
    const missingQuarters = targetQuarters.filter(q => !acquiredQuarters.has(q));

    if (missingQuarters.length === 0) {
      this.logger.log(`All target quarters already acquired for ${ticker}`);
      return [];
    }

    this.logger.log(`Target quarters for ${ticker}: ${missingQuarters.join(', ')}`);

    // Strategy 1: Browse IR page earnings/transcripts sub-pages directly
    const irResults = await this.strategyBrowseIrPage(irMapping, ticker, acquiredQuarters);
    for (const r of irResults) {
      if (r.status === 'success') acquiredQuarters.add(r.quarter);
      results.push(r);
    }

    // Strategy 2: Direct DuckDuckGo search for each missing quarter
    const stillMissing = missingQuarters.filter(q => !acquiredQuarters.has(q));
    if (stillMissing.length > 0) {
      const searchResults = await this.strategyDirectSearch(
        ticker, irMapping.companyName, stillMissing, acquiredQuarters,
      );
      for (const r of searchResults) {
        if (r.status === 'success') acquiredQuarters.add(r.quarter);
        results.push(r);
      }
    }

    // Strategy 3: Broad search for company earnings transcripts
    const stillMissing2 = missingQuarters.filter(q => !acquiredQuarters.has(q));
    if (stillMissing2.length > 0) {
      const broadResults = await this.strategyBroadSearch(
        ticker, irMapping.companyName, stillMissing2, acquiredQuarters,
      );
      results.push(...broadResults);
    }

    const successCount = results.filter(r => r.status === 'success').length;
    this.logger.log(
      `🎙️ Transcript acquisition for ${ticker}: ${successCount} success, ` +
      `${results.filter(r => r.status === 'failed').length} failed, ` +
      `${results.filter(r => r.status === 'skipped').length} skipped`,
    );

    return results;
  }

  // ─── Strategy 1: Browse IR Page ──────────────────────────────────────

  private async strategyBrowseIrPage(
    irMapping: IrPageMapping,
    ticker: string,
    acquiredQuarters: Set<string>,
  ): Promise<TranscriptResult[]> {
    const earningsUrl = irMapping.transcriptsPage || irMapping.earningsPage;
    if (!earningsUrl) return [];

    this.logger.log(`Strategy 1: Browsing IR page ${earningsUrl}`);

    try {
      const page = await this.webBrowse.execute({ url: earningsUrl });
      const transcripts = await this.identifyTranscriptsFromPage(page, ticker, acquiredQuarters);
      return this.downloadTranscripts(transcripts, ticker);
    } catch (error) {
      this.logger.warn(`Strategy 1 failed for ${ticker}: ${error.message}`);
      return [];
    }
  }

  // ─── Strategy 2: Direct DuckDuckGo Search Per Quarter ────────────────

  private async strategyDirectSearch(
    ticker: string,
    companyName: string,
    missingQuarters: string[],
    acquiredQuarters: Set<string>,
  ): Promise<TranscriptResult[]> {
    this.logger.log(`Strategy 2: Direct search for ${missingQuarters.length} quarters`);
    const results: TranscriptResult[] = [];

    // Limit to 4 searches to avoid rate limiting
    const quartersToSearch = missingQuarters.slice(0, 4);

    for (const quarter of quartersToSearch) {
      if (acquiredQuarters.has(quarter)) continue;

      try {
        const { year, q } = this.parseQuarter(quarter);
        const queries = [
          `"${companyName}" "earnings call transcript" "${q}" "${year}"`,
          `"${ticker}" earnings call transcript ${q} ${year}`,
        ];

        for (const query of queries) {
          const searchResults = await this.searchDuckDuckGo(query);
          const validResults = searchResults.filter(r => !this.isBlockedDomain(r.url));

          if (validResults.length === 0) continue;

          // Try the top 3 results
          for (const sr of validResults.slice(0, 3)) {
            try {
              const page = await this.webBrowse.execute({ url: sr.url });
              if (this.looksLikeTranscript(page.text, ticker, companyName)) {
                const content = this.cleanTranscriptText(page.text);
                if (content.length > 500) {
                  results.push({ ticker, quarter, status: 'success', content });
                  acquiredQuarters.add(quarter);
                  this.logger.log(`✅ Found transcript for ${ticker} ${quarter} via search: ${sr.url}`);
                  break;
                }
              }
            } catch {
              // Try next result
            }
          }

          if (acquiredQuarters.has(quarter)) break; // Found it, move to next quarter
        }

        if (!acquiredQuarters.has(quarter)) {
          results.push({ ticker, quarter, status: 'failed', error: 'No transcript found via direct search' });
        }

        // Rate limit between quarters
        await this.sleep(2000);
      } catch (error) {
        results.push({ ticker, quarter, status: 'failed', error: error.message });
      }
    }

    return results;
  }

  // ─── Strategy 3: Broad Search ────────────────────────────────────────

  private async strategyBroadSearch(
    ticker: string,
    companyName: string,
    missingQuarters: string[],
    acquiredQuarters: Set<string>,
  ): Promise<TranscriptResult[]> {
    this.logger.log(`Strategy 3: Broad search for ${ticker} transcripts`);
    const results: TranscriptResult[] = [];

    const queries = [
      `${companyName} earnings call transcript site:${this.guessCompanyDomain(companyName)}`,
      `${ticker} quarterly earnings call transcript ${new Date().getFullYear()}`,
      `${companyName} investor day transcript`,
    ];

    for (const query of queries) {
      try {
        const searchResults = await this.searchDuckDuckGo(query);
        const validResults = searchResults.filter(r => !this.isBlockedDomain(r.url));

        for (const sr of validResults.slice(0, 3)) {
          try {
            const page = await this.webBrowse.execute({ url: sr.url });
            if (!this.looksLikeTranscript(page.text, ticker, companyName)) continue;

            // Try to identify which quarter this transcript is for
            const quarter = this.identifyQuarterFromText(page.text, missingQuarters);
            if (quarter && !acquiredQuarters.has(quarter)) {
              const content = this.cleanTranscriptText(page.text);
              if (content.length > 500) {
                results.push({ ticker, quarter, status: 'success', content });
                acquiredQuarters.add(quarter);
                this.logger.log(`✅ Found transcript for ${ticker} ${quarter} via broad search: ${sr.url}`);
              }
            }
          } catch {
            // Try next
          }
        }
      } catch {
        // Try next query
      }

      await this.sleep(2000);
    }

    return results;
  }

  // ─── Transcript Identification & Download ────────────────────────────

  /**
   * Use LLM to identify available transcripts from an earnings page.
   */
  private async identifyTranscriptsFromPage(
    page: BrowseResult,
    ticker: string,
    acquiredQuarters: Set<string>,
  ): Promise<AvailableTranscript[]> {
    const prompt = `You are analyzing an investor relations earnings page for ${ticker}.

PAGE URL: ${page.url}
PAGE TEXT (first 5000 chars): ${page.text.substring(0, 5000)}
LINKS: ${page.links.slice(0, 80).map(l => `${l.text} -> ${l.href}`).join('\n')}

ALREADY HAVE: ${[...acquiredQuarters].join(', ') || 'none'}

Identify available earnings call transcripts. For each, provide:
- quarterIdentifier: e.g., "Q3FY2025" or "Q4FY2024"
- downloadUrl: direct URL to the transcript
- format: "html", "pdf", or "audio"
- title: the link text or title
- callDate: date if visible (YYYY-MM-DD)

Return ONLY a JSON array. If no transcripts found, return [].
Skip quarters we already have.`;

    try {
      const response = await this.bedrock.invokeClaude({ prompt, max_tokens: 2000 });
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((t: any) => t.quarterIdentifier && t.downloadUrl)
        .map((t: any) => ({
          quarterIdentifier: t.quarterIdentifier,
          downloadUrl: t.downloadUrl,
          format: (['html', 'pdf', 'audio'].includes(t.format) ? t.format : 'html') as 'html' | 'pdf' | 'audio',
          title: t.title || `${ticker} ${t.quarterIdentifier}`,
          callDate: t.callDate,
        }));
    } catch (error) {
      this.logger.error(`Failed to identify transcripts via LLM: ${error.message}`);
      return [];
    }
  }

  private async downloadTranscripts(
    transcripts: AvailableTranscript[],
    ticker: string,
  ): Promise<TranscriptResult[]> {
    const results: TranscriptResult[] = [];

    for (const transcript of transcripts) {
      if (transcript.format === 'audio') {
        results.push({
          ticker,
          quarter: transcript.quarterIdentifier,
          status: 'skipped',
          error: 'Audio-only — requires Whisper transcription (future phase)',
        });
        continue;
      }

      try {
        const page = await this.webBrowse.execute({ url: transcript.downloadUrl });
        const content = this.cleanTranscriptText(page.text);
        if (content.length > 500) {
          results.push({ ticker, quarter: transcript.quarterIdentifier, status: 'success', content });
        } else {
          results.push({
            ticker,
            quarter: transcript.quarterIdentifier,
            status: 'failed',
            error: `Content too short (${content.length} chars)`,
          });
        }
      } catch (error) {
        results.push({
          ticker,
          quarter: transcript.quarterIdentifier,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return results;
  }

  // ─── DuckDuckGo Search ───────────────────────────────────────────────

  private async searchDuckDuckGo(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) return [];

      const html = await response.text();
      return this.parseDuckDuckGoResults(html);
    } catch (error) {
      this.logger.warn(`DuckDuckGo search error: ${error.message}`);
      return [];
    }
  }

  private parseDuckDuckGoResults(html: string): Array<{ title: string; url: string; snippet: string }> {
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    try {
      const cheerio = require('cheerio');
      const $ = cheerio.load(html);

      $('.result').each((_: number, el: any) => {
        const titleEl = $(el).find('.result__a');
        const snippetEl = $(el).find('.result__snippet');
        const title = titleEl.text().trim();
        let href = titleEl.attr('href') || '';

        if (href.includes('uddg=')) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) href = decodeURIComponent(match[1]);
        }

        const snippet = snippetEl.text().trim();
        if (title && href && href.startsWith('http')) {
          results.push({ title, url: href, snippet });
        }
      });
    } catch {
      // Fallback: regex extraction
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

  // ─── Helpers ─────────────────────────────────────────────────────────

  private isBlockedDomain(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return BLOCKED_DOMAINS.some(d => hostname.includes(d));
    } catch {
      return false;
    }
  }

  /**
   * Heuristic check: does this text look like an earnings call transcript?
   */
  private looksLikeTranscript(text: string, ticker: string, companyName: string): boolean {
    const lower = text.toLowerCase();
    const signals = [
      'earnings call', 'conference call', 'prepared remarks',
      'question-and-answer', 'q&a session', 'operator',
      'good morning', 'good afternoon', 'thank you for joining',
      'forward-looking statements', 'earnings per share',
    ];
    const matchCount = signals.filter(s => lower.includes(s)).length;

    // Must mention the company or ticker
    const mentionsCompany = lower.includes(ticker.toLowerCase()) ||
      lower.includes(companyName.toLowerCase().split(' ')[0]);

    return mentionsCompany && matchCount >= 2;
  }

  /**
   * Try to identify which fiscal quarter a transcript belongs to.
   */
  private identifyQuarterFromText(text: string, targetQuarters: string[]): string | null {
    const lower = text.toLowerCase();

    for (const quarter of targetQuarters) {
      const { year, q } = this.parseQuarter(quarter);
      // Look for patterns like "Q3 2025", "third quarter 2025", "Q3FY2025"
      const patterns = [
        `q${q.replace('Q', '')} ${year}`,
        `q${q.replace('Q', '')}fy${year}`,
        `${this.quarterToOrdinal(q)} quarter ${year}`,
        `${this.quarterToOrdinal(q)} quarter of ${year}`,
        `fiscal ${year}.*${this.quarterToOrdinal(q)}`,
      ];

      if (patterns.some(p => lower.includes(p))) {
        return quarter;
      }
    }

    return null;
  }

  private quarterToOrdinal(q: string): string {
    const map: Record<string, string> = { Q1: 'first', Q2: 'second', Q3: 'third', Q4: 'fourth' };
    return map[q] || q;
  }

  private parseQuarter(quarter: string): { year: string; q: string } {
    // Parse "Q3FY2025" or "Q3-2025"
    const match = quarter.match(/Q(\d)(?:FY)?[-]?(\d{4})/i);
    if (match) return { q: `Q${match[1]}`, year: match[2] };
    return { q: 'Q1', year: new Date().getFullYear().toString() };
  }

  /**
   * Get target quarters to search for (last N quarters from today).
   */
  private getTargetQuarters(count: number): string[] {
    const quarters: string[] = [];
    const now = new Date();
    let year = now.getFullYear();
    let q = Math.ceil((now.getMonth() + 1) / 3);

    for (let i = 0; i < count; i++) {
      quarters.push(`Q${q}FY${year}`);
      q--;
      if (q === 0) { q = 4; year--; }
    }

    return quarters;
  }

  private cleanTranscriptText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private guessCompanyDomain(companyName: string): string {
    const slug = companyName
      .replace(/\s*(Inc\.?|Corp\.?|Ltd\.?|LLC|PLC|N\.?V\.?|S\.?A\.?|Co\.?|Group|Holdings?|International)\s*/gi, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return `${slug}.com`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
