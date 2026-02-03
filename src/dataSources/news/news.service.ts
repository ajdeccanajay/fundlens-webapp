import { Injectable } from '@nestjs/common';
import yahooFinance from 'yahoo-finance2';

export type Headline = {
  title: string;
  link: string;
  pubDate: string;        // ISO 8601
  source?: string;
  type?: string;
};

@Injectable()
export class NewsService {
  private toHeadline(item: any): Headline | null {
    if (!item) return null;
    const title = item.title ?? item.headline ?? null;
    const link = item.link ?? item.url ?? null;

    // Yahoo news commonly exposes 'providerPublishTime' (unix seconds)
    const ts = item.providerPublishTime ?? item.pubDate ?? item.published_at ?? null;
    const pubDate = ts
      ? new Date(typeof ts === 'number' ? ts * 1000 : ts).toISOString()
      : new Date().toISOString();

    if (!title || !link) return null;
    return {
      title,
      link,
      pubDate,
      source: item.publisher ?? item.provider ?? undefined,
      type: item.type ?? undefined,
    };
  }

  /**
   * Company-specific news using 'insights' endpoint
   * (works well for per-ticker headlines).
   */
  async headlinesBySymbol(symbol: string, limit = 30): Promise<Headline[]> {
    const data: any = await yahooFinance.insights(symbol); // module exists in yahoo-finance2
    const rawList: any[] =
      data?.news ||
      data?.companyNews ||
      data?.finance?.insights?.news ||
      [];

    return rawList
      .map((x) => this.toHeadline(x))
      .filter((x): x is Headline => !!x)
      .sort((a, b) => b.pubDate.localeCompare(a.pubDate))
      .slice(0, limit);
  }

  /**
   * Free-text search news using 'search' module, then pluck 'news' array.
   * Good for general “market” headlines (not restricted to a single ticker).
   */
  async headlinesByQuery(query = 'markets', limit = 30, lang = 'en-US', region = 'US'): Promise<Headline[]> {
    const res: any = await yahooFinance.search(query, { lang, region });
    const rawNews: any[] = res?.news ?? [];

    return rawNews
      .map((x) => this.toHeadline(x))
      .filter((x): x is Headline => !!x)
      .sort((a, b) => b.pubDate.localeCompare(a.pubDate))
      .slice(0, limit);
  }
}
