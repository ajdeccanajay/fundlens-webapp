/**
 * WebBrowseTool — HTTP + Cheerio web browsing with robots.txt and rate limiting.
 * Phase 4 of Filing Expansion spec (§6.5).
 */

import { Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';

export interface PageLink {
  text: string;
  href: string;
}

export interface BrowseResult {
  text: string;
  links: PageLink[];
  url: string;
  statusCode: number;
}

export interface AgentTool {
  name: string;
  execute(params: Record<string, any>): Promise<any>;
}

// Per-domain rate limiter: 1 request per 2 seconds
const domainLastRequest = new Map<string, number>();
const RATE_LIMIT_MS = 2000;

// robots.txt cache
const robotsCache = new Map<string, { allowed: boolean; fetchedAt: number }>();
const ROBOTS_CACHE_TTL = 3600000; // 1 hour

export class WebBrowseTool implements AgentTool {
  name = 'web_browse';
  private readonly logger = new Logger(WebBrowseTool.name);

  async execute(params: { url: string }): Promise<BrowseResult> {
    const { url } = params;

    // Respect robots.txt
    const robotsAllowed = await this.checkRobotsTxt(url);
    if (!robotsAllowed) {
      throw new Error(`Blocked by robots.txt: ${url}`);
    }

    // Rate limit per domain
    await this.rateLimitAcquire(this.getDomain(url));

    // Fetch with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'FundLens/1.0 (financial-research; support@fundlens.com)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${url}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove noise elements
      $('script, style, nav, footer, header, aside, .cookie-banner, noscript').remove();

      // Extract text
      const text = $('body')
        .text()
        .replace(/\s+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Extract links
      const links: PageLink[] = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        const linkText = $(el).text().trim();
        if (href && linkText && linkText.length > 0) {
          links.push({
            text: linkText.substring(0, 200),
            href: this.resolveUrl(href, url),
          });
        }
      });

      this.logger.debug(`Browsed ${url}: ${text.length} chars, ${links.length} links`);

      return {
        text: text.substring(0, 50000),
        links,
        url,
        statusCode: response.status,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async checkRobotsTxt(url: string): Promise<boolean> {
    const domain = this.getDomain(url);
    const cached = robotsCache.get(domain);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL) {
      return cached.allowed;
    }

    try {
      const robotsUrl = `${new URL(url).origin}/robots.txt`;
      const response = await fetch(robotsUrl, {
        headers: { 'User-Agent': 'FundLens/1.0' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        // No robots.txt = allowed
        robotsCache.set(domain, { allowed: true, fetchedAt: Date.now() });
        return true;
      }

      const text = await response.text();
      // Simple check: look for Disallow: / for our user agent or *
      const lines = text.split('\n');
      let inOurSection = false;
      let inWildcard = false;

      for (const line of lines) {
        const trimmed = line.trim().toLowerCase();
        if (trimmed.startsWith('user-agent:')) {
          const agent = trimmed.replace('user-agent:', '').trim();
          inOurSection = agent === 'fundlens' || agent === 'fundlens/1.0';
          inWildcard = agent === '*';
        }
        if ((inOurSection || inWildcard) && trimmed === 'disallow: /') {
          robotsCache.set(domain, { allowed: false, fetchedAt: Date.now() });
          return false;
        }
      }

      robotsCache.set(domain, { allowed: true, fetchedAt: Date.now() });
      return true;
    } catch {
      // If we can't fetch robots.txt, assume allowed
      robotsCache.set(domain, { allowed: true, fetchedAt: Date.now() });
      return true;
    }
  }

  private async rateLimitAcquire(domain: string): Promise<void> {
    const lastReq = domainLastRequest.get(domain) || 0;
    const elapsed = Date.now() - lastReq;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
    }
    domainLastRequest.set(domain, Date.now());
  }

  private getDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private resolveUrl(href: string, baseUrl: string): string {
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return href;
    }
  }
}
