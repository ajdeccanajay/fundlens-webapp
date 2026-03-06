import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as fs from 'fs/promises';

type TickerMap = Record<string, { cik_str: number; ticker: string; title: string }>;

// Filing types for the new fillings endpoint
interface FilingRow {
  form: string;
  filingDate: string;
  reportDate: string;
  accessionNumber: string;
  primaryDocument: string;
  items?: string;
  url: string | null;
}

interface FillingsOptions {
  startDate?: string;
  endDate?: string;
  formType?: string;
  includeOlderPages?: boolean;
}

@Injectable()
export class SecService {
  private UA = process.env.SEC_USER_AGENT || 'FundLensAI/1.0 (contact: you@example.com)';
  private DELAY = Number(process.env.REQUEST_DELAY_MS || 150);
  private CACHE_TTL = Number(process.env.CACHE_TTL_MS || 86_400_000);

  private tickerMapCache: { data: TickerMap | null; at: number } = { data: null, at: 0 };

  constructor(private readonly http: HttpService) {}

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async getJSON<T = any>(url: string): Promise<T> {
    await this.sleep(this.DELAY); // friendly cushion for SEC rate limit
    const resp = await firstValueFrom(
      this.http.get<T>(url, {
        headers: {
          'User-Agent': this.UA,
          'Accept': 'application/json',
        },
        // NOTE: CORS is SEC-side, but we’re server-to-server so fine.
      })
    );
    return resp.data;
  }

  // 1) Ticker map with 24h cache
  async fetchTickerMap(force = false): Promise<TickerMap> {
    const now = Date.now();
    if (!force && this.tickerMapCache.data && (now - this.tickerMapCache.at) < this.CACHE_TTL) {
      return this.tickerMapCache.data;
    }
    const data = await this.getJSON<TickerMap>('https://www.sec.gov/files/company_tickers.json');
    this.tickerMapCache = { data, at: now };
    return data;
  }

  // 2) Lookup CIK for a ticker
  async getCikForTicker(ticker: string) {
    const T = (ticker || '').trim().toUpperCase();
    if (!T) throw new Error('ticker is required');

    const map = await this.fetchTickerMap();
    const entry = Object.values(map).find(v => (v.ticker || '').toUpperCase() === T);
    if (!entry) throw new Error(`Ticker not found: ${T}`);

    const cikNumeric = String(entry.cik_str).replace(/\D/g, '');
    const cikPadded = cikNumeric.padStart(10, '0');

    return { ticker: T, cik: cikPadded, cik_numeric: Number(cikNumeric), name: entry.title };
  }

  // 3) Submissions by CIK
  async fetchSubmissions(cik10: string) {
    const url = `https://data.sec.gov/submissions/CIK${cik10}.json`;
    return this.getJSON(url);
  }

  // 4) Company Facts (all XBRL facts for a company)
  async fetchCompanyFacts(cik10: string) {
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`;
    return this.getJSON(url);
  }

  // 5) Company Concept (single tag series)
  async fetchCompanyConcept(cik10: string, tag: string, taxonomy = 'us-gaap') {
    const T = taxonomy || 'us-gaap';
    const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik10}/${encodeURIComponent(T)}/${encodeURIComponent(tag)}.json`;
    return this.getJSON(url);
  }

  // 6) Frames (calendar-aligned snapshot)
  async fetchFrames(tag: string, unit = 'USD', frame = 'CY2024Q4I', taxonomy = 'us-gaap') {
    const url = `https://data.sec.gov/api/xbrl/frames/${encodeURIComponent(taxonomy)}/${encodeURIComponent(tag)}/${encodeURIComponent(unit)}/${encodeURIComponent(frame)}.json`;
    return this.getJSON(url);
  }

  // 7) Aggregate everything we typically need for FundLens MVP
  async aggregateForTicker(ticker: string, opts?: { form?: string; tag?: string; unit?: string; frame?: string }) {
    const { cik } = await this.getCikForTicker(ticker);
    const [submissions, facts] = await Promise.all([
      this.fetchSubmissions(cik),
      this.fetchCompanyFacts(cik),
    ]);

    const tag = opts?.tag || 'Revenues';
    const unit = opts?.unit || 'USD';
    const frame = opts?.frame || 'CY2024Q4I';

    // Try to get the concept + frames, but don’t fail the whole request if one is missing
    let concept: any = null, frames: any = null;
    try { concept = await this.fetchCompanyConcept(cik, tag); } catch { /* ignore */ }
    try { frames = await this.fetchFrames(tag, unit, frame); } catch { /* ignore */ }

    return {
      cik,
      ticker: ticker.toUpperCase(),
      requested: { tag, unit, frame },
      submissions_summary: {
        forms: submissions?.filings?.recent?.form?.slice?.(0, 5) ?? [],
        filingDates: submissions?.filings?.recent?.filingDate?.slice?.(0, 5) ?? []
      },
      raw: {
        submissions,
        facts,
        concept,
        frames
      }
    };
  }

  // 8) Save JSON to disk (optional)
  async saveJSON(obj: any, filename?: string) {
    const name = filename || `sec_${Date.now()}.json`;
    await fs.mkdir('data', { recursive: true });
    const path = `data/${name}`;
    await fs.writeFile(path, JSON.stringify(obj, null, 2), 'utf-8');
    return { saved: true, path };
  }

  // 9) Get SEC Filings (integrated fetch_filling functionality)
  async getFillings(cik: string, options: FillingsOptions = {}) {
    const { startDate, endDate, formType, includeOlderPages = false } = options;
    
    // Set default date range to past 5 years if no dates specified
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;
    
    if (!effectiveStartDate && !effectiveEndDate) {
      const today = new Date();
      const fiveYearsAgo = new Date();
      fiveYearsAgo.setFullYear(today.getFullYear() - 5);
      
      effectiveStartDate = fiveYearsAgo.toISOString().split('T')[0]; // YYYY-MM-DD format
      effectiveEndDate = today.toISOString().split('T')[0]; // YYYY-MM-DD format
    }

    // Fetch all filings
    const allRows = await this.fetchAllFilingRows(cik, includeOlderPages);
    
    // Filter by date range
    const filteredRows = this.filterFilingRowsByDate(allRows, effectiveStartDate, effectiveEndDate);
    
    // Filter by form type if specified
    let finalRows = filteredRows;
    if (formType && formType !== 'all') {
      finalRows = this.filterFilingRowsByForm(filteredRows, formType);
    }

    // Get ticker info for display
    const tickerInfo = await this.getTickerForCik(cik);
    
    // Categorize filings
    const tenKs = this.filterFilingRowsByForm(filteredRows, '10-K');
    const tenQs = this.filterFilingRowsByForm(filteredRows, '10-Q');
    const eightKs = this.filterFilingRowsByForm(filteredRows, '8-K');

    return {
      metadata: {
        cik,
        ticker: tickerInfo?.ticker || null,
        companyName: tickerInfo?.name || null,
        dateRange: {
          startDate: effectiveStartDate,
          endDate: effectiveEndDate
        },
        formType: formType || 'all',
        includeOlderPages
      },
      summary: {
        totalFilings: allRows.length,
        filingsInDateRange: filteredRows.length,
        finalResults: finalRows.length,
        tenKCount: tenKs.length,
        tenQCount: tenQs.length,
        eightKCount: eightKs.length
      },
      filings: {
        tenK: tenKs.map(this.mapFilingRow),
        tenQ: tenQs.map(this.mapFilingRow),
        eightK: eightKs.map(this.mapFilingRow)
      },
      allFilings: finalRows.map(this.mapFilingRow)
    };
  }

  // Helper method to fetch all filing rows
  private async fetchAllFilingRows(cik: string, includeOlderPages: boolean): Promise<FilingRow[]> {
    const submissions = await this.fetchSubmissions(cik);
    
    let allRows = this.rowsFromRecent(submissions.filings.recent, cik);

    // Include older pages if requested
    if (includeOlderPages && submissions.filings?.files) {
      const files = Array.isArray(submissions.filings.files) ? submissions.filings.files : [];
      
      for (const file of files) {
        const pageUrl = `https://data.sec.gov/submissions/${file.name}`;
        try {
          const pageData = await this.getJSON(pageUrl);
          if (pageData?.filings?.recent) {
            allRows = allRows.concat(this.rowsFromRecent(pageData.filings.recent, cik));
          }
        } catch (error) {
          console.warn(`Error fetching ${pageUrl}:`, error);
        }
      }
    }
    
    return allRows;
  }

  // Helper method to convert SEC response to filing rows
  private rowsFromRecent(recent: any, cik: string): FilingRow[] {
    if (!recent || !Array.isArray(recent.form)) return [];
    
    const L = recent.form.length;
    const safe = (arr: any[] | undefined, i: number): any => 
      (Array.isArray(arr) && i < arr.length ? arr[i] : null);

    const rows: FilingRow[] = [];
    for (let i = 0; i < L; i++) {
      const form = safe(recent.form, i);
      const accession = safe(recent.accessionNumber, i);
      const primaryDocument = safe(recent.primaryDocument, i);
      
      rows.push({
        form,
        filingDate: safe(recent.filingDate, i),
        reportDate: safe(recent.reportDate, i),
        accessionNumber: accession,
        primaryDocument,
        items: safe(recent.items, i),
        url: accession && primaryDocument
          ? this.buildArchiveUrl(cik, accession, primaryDocument)
          : null,
      });
    }
    return rows;
  }

  // Helper method to build archive URL
  private buildArchiveUrl(cik: string, accession: string, primaryDocument: string): string {
    const cikNoZeros = String(parseInt(cik, 10));
    const accPlain = accession.replace(/-/g, "");
    return `https://www.sec.gov/Archives/edgar/data/${cikNoZeros}/${accPlain}/${primaryDocument}`;
  }

  // Helper method to filter filings by date range
  private filterFilingRowsByDate(rows: FilingRow[], startDate?: string, endDate?: string): FilingRow[] {
    if (!startDate && !endDate) return rows;
    
    return rows.filter(row => {
      const filingDate = new Date(row.filingDate);
      
      if (startDate && filingDate < new Date(startDate)) {
        return false;
      }
      
      if (endDate && filingDate > new Date(endDate)) {
        return false;
      }
      
      return true;
    });
  }

  // Helper method to filter filings by form type
  private filterFilingRowsByForm(rows: FilingRow[], formType: string): FilingRow[] {
      // Match base form type AND amended versions (e.g., 10-K matches 10-K/A, 10-K/A/A)
      // Also handle 40-F for Canadian companies (equivalent to 10-K)
      return rows.filter(row => {
        const form = row.form?.trim();
        if (!form) return false;
        // Exact match
        if (form === formType) return true;
        // Amended filing match: 10-K/A, 10-Q/A, 8-K/A, etc.
        if (form.startsWith(formType + '/')) return true;
        // NT (notification of late filing) match: NT 10-K, NT 10-Q
        if (form === `NT ${formType}`) return true;
        return false;
      });
    }

  // Helper method to map filing row to response format
  private mapFilingRow(filing: FilingRow) {
    return {
      form: filing.form,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      accessionNumber: filing.accessionNumber,
      primaryDocument: filing.primaryDocument,
      items: filing.items,
      url: filing.url
    };
  }

  // Helper method to get ticker info for a CIK
  private async getTickerForCik(cik: string) {
    try {
      const map = await this.fetchTickerMap();
      const entry = Object.values(map).find(v => {
        const cikNumeric = String(v.cik_str).replace(/\D/g, '');
        const cikPadded = cikNumeric.padStart(10, '0');
        return cikPadded === cik;
      });
      
      if (!entry) return null;
      
      const cikNumeric = String(entry.cik_str).replace(/\D/g, '');
      const cikPadded = cikNumeric.padStart(10, '0');
      
      return {
        ticker: entry.ticker,
        cik: cikPadded,
        cik_numeric: Number(cikNumeric),
        name: entry.title
      };
    } catch (error) {
      console.warn(`Warning: Could not fetch ticker for CIK ${cik}:`, error);
      return null;
    }
  }
}
