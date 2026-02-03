import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';

export interface ParsedSECDocument {
  export_info: {
    parser: string;
    version: string;
    parse_time_seconds: number;
    total_sections: number;
    total_text_chunks: number;
    total_tables: number;
    total_text_length: number;
  };
  document_structure: any;
  content_analysis: {
    sections: any[];
    tables: any[];
    table_summary: any;
  };
  metadata: any;
}

export interface XBRLMetrics {
  company: string;
  cik: string;
  timestamp: string;
  time_window: {
    start: string;
    end: string;
    basis: string;
  };
  metrics: Record<string, any>;
  formulas: Record<string, string>;
}

@Injectable()
export class SecParserService {
  private readonly logger = new Logger(SecParserService.name);
  private readonly pythonApiUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.pythonApiUrl = this.config.get('PYTHON_PARSER_URL', 'http://localhost:8000');
  }

  async parseSECDocument(filingUrl: string, filingType: string): Promise<ParsedSECDocument> {
    try {
      this.logger.log(`Parsing SEC document: ${filingUrl}`);
      
      // Download the HTML filing
      const htmlResponse = await firstValueFrom(
        this.http.get(filingUrl, {
          headers: {
            'User-Agent': this.config.get('SEC_USER_AGENT', 'FundLensAI/1.0'),
          },
        }),
      );

      const htmlContent = htmlResponse.data;
      
      // Send to Python parser
      const parseResponse = await firstValueFrom(
        this.http.post(`${this.pythonApiUrl}/sec-parser`, {
          filing_type: filingType,
          html_content: htmlContent,
          output_format: 'json',
        }),
      );

      return parseResponse.data;
    } catch (error) {
      this.logger.error(`Error parsing SEC document: ${error.message}`);
      throw error;
    }
  }

  async getXBRLMetrics(
    cik: string,
    startDate: string,
    endDate: string,
    basis: string = 'FY',
    metrics?: string[],
  ): Promise<XBRLMetrics> {
    try {
      this.logger.log(`Fetching XBRL metrics for CIK: ${cik}`);
      
      const response = await firstValueFrom(
        this.http.post(`${this.pythonApiUrl}/xbrl-parser`, {
          cik,
          start_date: startDate,
          end_date: endDate,
          basis,
          metrics,
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching XBRL metrics: ${error.message}`);
      throw error;
    }
  }

  async parseAndAnalyzeFiling(
    cik: string,
    filingUrl: string,
    filingType: string,
    startDate: string,
    endDate: string,
  ) {
    try {
      // Parse the document and get XBRL metrics in parallel
      const [parsedDoc, xbrlMetrics] = await Promise.all([
        this.parseSECDocument(filingUrl, filingType),
        this.getXBRLMetrics(cik, startDate, endDate),
      ]);

      return {
        parsed_document: parsedDoc,
        xbrl_metrics: xbrlMetrics,
        combined_analysis: {
          total_sections: parsedDoc.export_info.total_sections,
          total_tables: parsedDoc.export_info.total_tables,
          financial_metrics_count: Object.keys(xbrlMetrics.metrics).length,
          parse_time: parsedDoc.export_info.parse_time_seconds,
        },
      };
    } catch (error) {
      this.logger.error(`Error in parseAndAnalyzeFiling: ${error.message}`);
      throw error;
    }
  }
}
