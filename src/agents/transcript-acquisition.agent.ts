/**
 * Transcript Acquisition Agent — downloads earnings call transcripts.
 * Phase 4 of Filing Expansion spec (§6.4).
 *
 * Navigates IR pages, identifies available transcripts, downloads them,
 * and dispatches to the transcript parser.
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

@Injectable()
export class TranscriptAcquisitionAgent {
  private readonly logger = new Logger(TranscriptAcquisitionAgent.name);
  private readonly webBrowse = new WebBrowseTool();

  constructor(
    private readonly bedrock: BedrockService,
  ) {}

  /**
   * Acquire transcripts for a ticker using its IR page mapping.
   */
  async acquireTranscripts(
    irMapping: IrPageMapping,
    ticker: string,
    existingQuarters: string[],
  ): Promise<TranscriptResult[]> {
    const earningsUrl = irMapping.transcriptsPage || irMapping.earningsPage;
    if (!earningsUrl) {
      this.logger.warn(`No earnings/transcripts URL for ${ticker}`);
      return [];
    }

    this.logger.log(`Acquiring transcripts for ${ticker} from ${earningsUrl}`);

    let page: BrowseResult;
    try {
      page = await this.webBrowse.execute({ url: earningsUrl });
    } catch (error) {
      this.logger.error(`Failed to browse earnings page: ${error.message}`);
      return [];
    }

    // Identify available transcripts via LLM
    const available = await this.identifyAvailableTranscripts(page, ticker, existingQuarters);

    const results: TranscriptResult[] = [];
    for (const transcript of available) {
      if (existingQuarters.includes(transcript.quarterIdentifier)) {
        results.push({ ticker, quarter: transcript.quarterIdentifier, status: 'skipped' });
        continue;
      }

      if (transcript.format === 'audio') {
        this.logger.log(`Skipping audio-only transcript: ${transcript.title}`);
        results.push({
          ticker,
          quarter: transcript.quarterIdentifier,
          status: 'skipped',
          error: 'Audio-only — requires Whisper transcription (future phase)',
        });
        continue;
      }

      try {
        const content = await this.downloadTranscript(transcript);
        results.push({
          ticker,
          quarter: transcript.quarterIdentifier,
          status: 'success',
          content,
        });
      } catch (error) {
        this.logger.error(`Failed to download transcript ${transcript.title}: ${error.message}`);
        results.push({
          ticker,
          quarter: transcript.quarterIdentifier,
          status: 'failed',
          error: error.message,
        });
      }
    }

    this.logger.log(
      `Transcript acquisition for ${ticker}: ${results.filter(r => r.status === 'success').length} success, ` +
      `${results.filter(r => r.status === 'failed').length} failed, ` +
      `${results.filter(r => r.status === 'skipped').length} skipped`,
    );

    return results;
  }

  /**
   * Use LLM to identify available transcripts from an earnings page.
   */
  private async identifyAvailableTranscripts(
    page: BrowseResult,
    ticker: string,
    existingQuarters: string[],
  ): Promise<AvailableTranscript[]> {
    const prompt = `You are analyzing an investor relations earnings page for ${ticker}.

PAGE URL: ${page.url}
PAGE TEXT (first 5000 chars): ${page.text.substring(0, 5000)}
LINKS: ${page.links.slice(0, 80).map(l => `${l.text} -> ${l.href}`).join('\n')}

ALREADY HAVE: ${existingQuarters.join(', ') || 'none'}

Identify available earnings call transcripts. For each, provide:
- quarterIdentifier: e.g., "Q3FY2025" or "Q4FY2024"
- downloadUrl: direct URL to the transcript
- format: "html", "pdf", or "audio"
- title: the link text or title
- callDate: date if visible (YYYY-MM-DD)

Return ONLY a JSON array. If no transcripts found, return [].
Skip quarters we already have.`;

    try {
      const response = await this.bedrock.invokeClaude({
        prompt,
        max_tokens: 2000,
      });

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
      this.logger.error(`Failed to identify transcripts: ${error.message}`);
      return [];
    }
  }

  /**
   * Download a transcript from its URL.
   */
  private async downloadTranscript(transcript: AvailableTranscript): Promise<string> {
    if (transcript.format === 'html') {
      const page = await this.webBrowse.execute({ url: transcript.downloadUrl });
      return this.extractTranscriptText(page);
    } else if (transcript.format === 'pdf') {
      // For PDF, fetch raw and extract text (basic approach)
      const response = await fetch(transcript.downloadUrl, {
        headers: { 'User-Agent': 'FundLens/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Return raw text — the Python parser will handle HTML tags
      const text = await response.text();
      return text;
    }

    throw new Error(`Unsupported format: ${transcript.format}`);
  }

  /**
   * Extract transcript text from a web page, removing navigation chrome.
   */
  private extractTranscriptText(page: BrowseResult): string {
    // The WebBrowseTool already strips nav/footer/header
    // Just return the cleaned text
    return page.text;
  }
}
