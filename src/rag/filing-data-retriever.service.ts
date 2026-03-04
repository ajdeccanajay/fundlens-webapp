/**
 * Filing Data Retriever — Structured queries for Form 4 and 13F data
 *
 * Phase 2: Provides structured query routes for insider transactions
 * and institutional holdings, complementing the existing StructuredRetrieverService
 * which handles financial metrics from 10-K/10-Q/8-K.
 *
 * Spec: KIRO_SPEC_FILING_EXPANSION_AND_AGENTIC_ACQUISITION §Phase 2 items 7-8
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface InsiderTransactionResult {
  ticker: string;
  insiderName: string;
  insiderTitle: string | null;
  relationship: string;
  transactionDate: Date;
  transactionCode: string;
  sharesTransacted: number;
  pricePerShare: number | null;
  sharesOwnedAfter: number | null;
  isDerivative: boolean;
  derivativeTitle: string | null;
}

export interface InstitutionalHoldingResult {
  ticker: string | null;
  holderName: string;
  cusip: string;
  issuerName: string;
  sharesHeld: string; // BigInt serialized as string
  marketValue: number;
  quarter: string;
  reportDate: Date;
}

@Injectable()
export class FilingDataRetrieverService {
  private readonly logger = new Logger(FilingDataRetrieverService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get recent insider transactions for a ticker.
   * Answers queries like "Any insider selling at NVDA?"
   */
  async getInsiderTransactions(
    ticker: string,
    options?: { limit?: number; transactionCodes?: string[]; daysBack?: number },
  ): Promise<InsiderTransactionResult[]> {
    const limit = options?.limit || 20;
    const daysBack = options?.daysBack || 365;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    try {
      let whereClause = `WHERE ticker = $1 AND transaction_date >= $2`;
      const params: any[] = [ticker.toUpperCase(), cutoff];

      if (options?.transactionCodes?.length) {
        whereClause += ` AND transaction_code = ANY($3)`;
        params.push(options.transactionCodes);
      }

      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT ticker, insider_name, insider_title, insider_relationship,
                transaction_date, transaction_code, shares_transacted,
                price_per_share, shares_owned_after, is_derivative, derivative_title
         FROM insider_transactions
         ${whereClause}
         ORDER BY transaction_date DESC
         LIMIT ${limit}`,
        ...params,
      );

      return rows.map((r) => ({
        ticker: r.ticker,
        insiderName: r.insider_name,
        insiderTitle: r.insider_title,
        relationship: r.insider_relationship,
        transactionDate: r.transaction_date,
        transactionCode: r.transaction_code,
        sharesTransacted: Number(r.shares_transacted),
        pricePerShare: r.price_per_share ? Number(r.price_per_share) : null,
        sharesOwnedAfter: r.shares_owned_after ? Number(r.shares_owned_after) : null,
        isDerivative: r.is_derivative,
        derivativeTitle: r.derivative_title,
      }));
    } catch (error) {
      this.logger.warn(`Failed to query insider transactions for ${ticker}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get top institutional holders for a ticker (latest quarter).
   * Answers queries like "Who are NVDA's largest institutional holders?"
   */
  async getInstitutionalHoldings(
    ticker: string,
    options?: { limit?: number; quarter?: string },
  ): Promise<InstitutionalHoldingResult[]> {
    const limit = options?.limit || 20;

    try {
      let query: string;
      const params: any[] = [ticker.toUpperCase()];

      if (options?.quarter) {
        query = `
          SELECT ticker, holder_name, cusip, issuer_name,
                 shares_held::text as shares_held, market_value,
                 quarter, report_date
          FROM institutional_holdings
          WHERE ticker = $1 AND quarter = $2
          ORDER BY market_value DESC
          LIMIT ${limit}
        `;
        params.push(options.quarter);
      } else {
        // Get latest quarter's data
        query = `
          SELECT ticker, holder_name, cusip, issuer_name,
                 shares_held::text as shares_held, market_value,
                 quarter, report_date
          FROM institutional_holdings
          WHERE ticker = $1
            AND quarter = (
              SELECT quarter FROM institutional_holdings
              WHERE ticker = $1
              ORDER BY report_date DESC
              LIMIT 1
            )
          ORDER BY market_value DESC
          LIMIT ${limit}
        `;
      }

      const rows = await this.prisma.$queryRawUnsafe<any[]>(query, ...params);

      return rows.map((r) => ({
        ticker: r.ticker,
        holderName: r.holder_name,
        cusip: r.cusip,
        issuerName: r.issuer_name,
        sharesHeld: r.shares_held,
        marketValue: Number(r.market_value),
        quarter: r.quarter,
        reportDate: r.report_date,
      }));
    } catch (error) {
      this.logger.warn(`Failed to query institutional holdings for ${ticker}: ${error.message}`);
      return [];
    }
  }

  /**
   * Build a narrative summary of insider activity for synthesis context.
   * This is injected into the RAG pipeline as a "virtual narrative" so the
   * LLM can reference insider data in its analysis.
   */
  async buildInsiderNarrative(ticker: string): Promise<string | null> {
    const transactions = await this.getInsiderTransactions(ticker, { limit: 10, daysBack: 180 });
    if (transactions.length === 0) return null;

    const lines = [`Recent insider transactions for ${ticker} (last 6 months):\n`];
    for (const t of transactions) {
      const action = t.transactionCode === 'P' ? 'Purchased' :
                     t.transactionCode === 'S' ? 'Sold' :
                     t.transactionCode === 'A' ? 'Acquired (award)' :
                     t.transactionCode === 'M' ? 'Exercised options' :
                     t.transactionCode === 'D' ? 'Disposed' :
                     `Transaction (${t.transactionCode})`;
      const price = t.pricePerShare ? ` at $${t.pricePerShare.toFixed(2)}/share` : '';
      const date = new Date(t.transactionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const title = t.insiderTitle ? ` (${t.insiderTitle})` : '';
      lines.push(`• ${t.insiderName}${title}: ${action} ${t.sharesTransacted.toLocaleString()} shares${price} on ${date}`);
    }

    return lines.join('\n');
  }

  /**
   * Build a narrative summary of institutional holdings for synthesis context.
   */
  async buildHoldingsNarrative(ticker: string): Promise<string | null> {
    const holdings = await this.getInstitutionalHoldings(ticker, { limit: 10 });
    if (holdings.length === 0) return null;

    const quarter = holdings[0]?.quarter || 'latest';
    const lines = [`Top institutional holders of ${ticker} (${quarter}):\n`];
    for (const h of holdings) {
      const value = (h.marketValue / 1_000_000).toFixed(1);
      const shares = Number(h.sharesHeld).toLocaleString();
      lines.push(`• ${h.holderName}: ${shares} shares ($${value}M)`);
    }

    return lines.join('\n');
  }
}
