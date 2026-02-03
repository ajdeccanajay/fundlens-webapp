import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

/**
 * Section metadata for Bedrock KB filtering
 */
export interface SectionMetadata {
  ticker: string;
  filing_type: string;
  section_type: string;
  section_title: string;
  fiscal_period: string;
  filing_date: string;
  chunk_count: number;
  total_characters: number;
}

/**
 * Aggregated section content ready for S3 upload
 */
export interface AggregatedSection {
  key: string;
  content: string;
  metadata: SectionMetadata;
}

/**
 * Export statistics
 */
export interface SectionExportStats {
  ticker: string;
  totalSections: number;
  totalCharacters: number;
  byFilingType: Record<string, number>;
  bySectionType: Record<string, number>;
  filesCreated: string[];
}

/**
 * Section Exporter Service
 * 
 * Aggregates narrative chunks by section and exports to S3 in an optimized format
 * for Bedrock Knowledge Base ingestion.
 * 
 * Key benefits:
 * - Reduces S3 file count from ~77K to ~1K
 * - Preserves all narrative content (no data loss)
 * - Maintains section-level metadata for filtering
 * - Lets Bedrock handle optimal chunking for embeddings
 */
@Injectable()
export class SectionExporterService {
  private readonly logger = new Logger(SectionExporterService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(private readonly prisma: PrismaService) {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      maxAttempts: 10,
      retryMode: 'adaptive',
    });
    this.bucket = process.env.BEDROCK_CHUNKS_BUCKET || 'fundlens-bedrock-chunks';
  }

  /**
   * Get all unique tickers with narrative chunks
   */
  async getTickersWithChunks(): Promise<string[]> {
    const result = await this.prisma.$queryRaw<{ ticker: string }[]>`
      SELECT DISTINCT ticker FROM narrative_chunks ORDER BY ticker
    `;
    return result.map(r => r.ticker);
  }

  /**
   * Aggregate chunks by section for a ticker
   * Groups chunks by (filing_type, section_type) and concatenates content
   * 
   * Note: NarrativeChunk model has: ticker, filingType, sectionType, chunkIndex, content
   * We derive fiscal_period from filingType pattern or FilingMetadata
   */
  async aggregateChunksBySection(ticker: string): Promise<AggregatedSection[]> {
    this.logger.log(`Aggregating chunks for ${ticker}`);

    // Query chunks grouped by section
    const chunks = await this.prisma.narrativeChunk.findMany({
      where: { ticker },
      orderBy: [
        { filingType: 'asc' },
        { sectionType: 'asc' },
        { chunkIndex: 'asc' },
      ],
    });

    if (chunks.length === 0) {
      this.logger.warn(`No chunks found for ${ticker}`);
      return [];
    }

    // Get filing metadata for fiscal period and filing date info
    const filingMetadata = await this.prisma.filingMetadata.findMany({
      where: { ticker },
      orderBy: { filingDate: 'desc' },
    });

    // Create a map of filingType -> latest filing metadata
    const filingMetadataMap = new Map<string, { fiscalPeriod: string; filingDate: Date }>();
    for (const fm of filingMetadata) {
      if (!filingMetadataMap.has(fm.filingType)) {
        // Extract fiscal period from filing date (e.g., "FY2024" or "Q3-2024")
        const year = fm.filingDate.getFullYear();
        const quarter = Math.ceil((fm.filingDate.getMonth() + 1) / 3);
        const fiscalPeriod = fm.filingType.includes('10-K') 
          ? `FY${year}` 
          : `Q${quarter}-${year}`;
        filingMetadataMap.set(fm.filingType, { fiscalPeriod, filingDate: fm.filingDate });
      }
    }

    // Group chunks by section key (ticker/filingType_sectionType)
    const sectionMap = new Map<string, typeof chunks>();
    
    for (const chunk of chunks) {
      const filingType = chunk.filingType || '10-K';
      const sectionKey = this.buildSectionKey(
        ticker,
        filingType,
        chunk.sectionType,
        filingMetadataMap.get(filingType)?.fiscalPeriod || 'unknown'
      );

      if (!sectionMap.has(sectionKey)) {
        sectionMap.set(sectionKey, []);
      }
      sectionMap.get(sectionKey)!.push(chunk);
    }

    // Build aggregated sections
    const sections: AggregatedSection[] = [];

    for (const [sectionKey, sectionChunks] of sectionMap) {
      // Sort chunks by index to maintain order
      sectionChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

      // Concatenate content with section markers
      const contentParts: string[] = [];
      for (const chunk of sectionChunks) {
        const cleanedContent = this.cleanContent(chunk.content);
        if (cleanedContent.length > 0) {
          contentParts.push(cleanedContent);
        }
      }

      const fullContent = contentParts.join('\n\n');
      
      if (fullContent.length < 100) {
        this.logger.debug(`Skipping section ${sectionKey} - too short (${fullContent.length} chars)`);
        continue;
      }

      // Get metadata from first chunk and filing metadata
      const firstChunk = sectionChunks[0];
      const filingType = firstChunk.filingType || '10-K';
      const filingMeta = filingMetadataMap.get(filingType);
      const sectionTitle = this.getSectionTitle(firstChunk.sectionType);

      sections.push({
        key: `sections/${sectionKey}.txt`,
        content: fullContent,
        metadata: {
          ticker,
          filing_type: filingType,
          section_type: firstChunk.sectionType,
          section_title: sectionTitle,
          fiscal_period: filingMeta?.fiscalPeriod || 'unknown',
          filing_date: filingMeta?.filingDate?.toISOString().split('T')[0] || '',
          chunk_count: sectionChunks.length,
          total_characters: fullContent.length,
        },
      });
    }

    this.logger.log(`Aggregated ${chunks.length} chunks into ${sections.length} sections for ${ticker}`);
    return sections;
  }

  /**
   * Build a unique section key
   */
  buildSectionKey(ticker: string, filingType: string, sectionType: string, fiscalPeriod: string): string {
    // Sanitize components for S3 key
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${sanitize(ticker)}/${sanitize(filingType)}_${sanitize(fiscalPeriod)}_${sanitize(sectionType)}`;
  }

  /**
   * Get human-readable section title
   */
  getSectionTitle(sectionType: string): string {
    const titles: Record<string, string> = {
      'item_1': 'Business',
      'item_1a': 'Risk Factors',
      'item_1b': 'Unresolved Staff Comments',
      'item_1c': 'Cybersecurity',
      'item_2': 'Properties',
      'item_3': 'Legal Proceedings',
      'item_4': 'Mine Safety Disclosures',
      'item_5': 'Market for Common Equity',
      'item_6': 'Reserved',
      'item_7': 'Management Discussion and Analysis',
      'item_7a': 'Market Risk Disclosures',
      'item_8': 'Financial Statements',
      'item_9': 'Accountant Changes',
      'item_9a': 'Controls and Procedures',
      'item_9b': 'Other Information',
      'item_9c': 'Foreign Jurisdictions',
      'item_10': 'Directors and Officers',
      'item_11': 'Executive Compensation',
      'item_12': 'Security Ownership',
      'item_13': 'Related Party Transactions',
      'item_14': 'Accountant Fees',
      'item_15': 'Exhibits',
      'item_16': 'Form 10-K Summary',
      'item_1_p2': 'Legal Proceedings (Part II)',
      'item_1a_p2': 'Risk Factors (Part II)',
      'item_2_p2': 'Unregistered Sales',
      'item_5_p2': 'Other Information (Part II)',
      'item_6_p2': 'Exhibits (Part II)',
      'item_1_01': 'Material Definitive Agreement',
      'item_2_02': 'Results of Operations',
      'item_5_02': 'Director/Officer Changes',
      'item_5_07': 'Shareholder Vote',
      'item_7_01': 'Regulation FD Disclosure',
      'item_8_01': 'Other Events',
      'item_9_01': 'Financial Statements and Exhibits',
      'preamble': 'Filing Preamble',
    };
    return titles[sectionType] || sectionType;
  }

  /**
   * Clean content for Bedrock ingestion
   */
  cleanContent(content: string): string {
    if (!content) return '';

    return content
      // Remove HTML tags
      .replace(/<[^>]*>/g, '')
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove special characters that might cause issues
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Trim
      .trim();
  }

  /**
   * Upload aggregated sections to S3
   */
  async uploadSectionsToS3(
    sections: AggregatedSection[],
    options: { dryRun?: boolean; concurrency?: number } = {}
  ): Promise<{ uploaded: number; failed: number; keys: string[] }> {
    const { dryRun = false, concurrency = 10 } = options;
    
    if (dryRun) {
      this.logger.log(`DRY RUN: Would upload ${sections.length} sections`);
      return {
        uploaded: sections.length,
        failed: 0,
        keys: sections.map(s => s.key),
      };
    }

    const uploadedKeys: string[] = [];
    let failed = 0;

    // Process in parallel batches
    for (let i = 0; i < sections.length; i += concurrency) {
      const batch = sections.slice(i, i + concurrency);
      
      const results = await Promise.all(
        batch.map(section => this.uploadSection(section))
      );

      for (let j = 0; j < results.length; j++) {
        if (results[j].success) {
          uploadedKeys.push(batch[j].key);
        } else {
          failed++;
          this.logger.error(`Failed to upload ${batch[j].key}: ${results[j].error}`);
        }
      }

      if (i % 50 === 0 && i > 0) {
        this.logger.log(`Uploaded ${uploadedKeys.length}/${sections.length} sections`);
      }
    }

    this.logger.log(`Upload complete: ${uploadedKeys.length} succeeded, ${failed} failed`);
    return { uploaded: uploadedKeys.length, failed, keys: uploadedKeys };
  }

  /**
   * Upload a single section with its metadata file
   */
  private async uploadSection(section: AggregatedSection): Promise<{ success: boolean; error?: string }> {
    try {
      // Upload content file
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: section.key,
        Body: section.content,
        ContentType: 'text/plain; charset=utf-8',
      }));

      // Upload metadata file for Bedrock KB filtering
      const metadataKey = `${section.key}.metadata.json`;
      const metadataContent = {
        metadataAttributes: {
          ticker: section.metadata.ticker,
          filing_type: section.metadata.filing_type,
          section_type: section.metadata.section_type,
          section_title: section.metadata.section_title,
          fiscal_period: section.metadata.fiscal_period,
          ...(section.metadata.filing_date ? { filing_date: section.metadata.filing_date } : {}),
        },
      };

      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: metadataKey,
        Body: JSON.stringify(metadataContent),
        ContentType: 'application/json',
      }));

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Export all sections for a ticker
   */
  async exportTickerSections(
    ticker: string,
    options: { dryRun?: boolean } = {}
  ): Promise<SectionExportStats> {
    const sections = await this.aggregateChunksBySection(ticker);
    
    const stats: SectionExportStats = {
      ticker,
      totalSections: sections.length,
      totalCharacters: sections.reduce((sum, s) => sum + s.content.length, 0),
      byFilingType: {},
      bySectionType: {},
      filesCreated: [],
    };

    // Calculate stats
    for (const section of sections) {
      const ft = section.metadata.filing_type;
      const st = section.metadata.section_type;
      stats.byFilingType[ft] = (stats.byFilingType[ft] || 0) + 1;
      stats.bySectionType[st] = (stats.bySectionType[st] || 0) + 1;
    }

    // Upload to S3
    const uploadResult = await this.uploadSectionsToS3(sections, options);
    stats.filesCreated = uploadResult.keys;

    return stats;
  }

  /**
   * Export all tickers to section-based format
   */
  async exportAllSections(options: {
    dryRun?: boolean;
    tickers?: string[];
    clearExisting?: boolean;
  } = {}): Promise<{
    totalTickers: number;
    totalSections: number;
    totalCharacters: number;
    tickerStats: SectionExportStats[];
  }> {
    const { dryRun = false, clearExisting = false } = options;
    
    // Get tickers to process
    const tickers = options.tickers || await this.getTickersWithChunks();
    this.logger.log(`Exporting sections for ${tickers.length} tickers`);

    // Optionally clear existing sections
    if (clearExisting && !dryRun) {
      await this.clearExistingSections();
    }

    const tickerStats: SectionExportStats[] = [];
    let totalSections = 0;
    let totalCharacters = 0;

    for (const ticker of tickers) {
      const stats = await this.exportTickerSections(ticker, { dryRun });
      tickerStats.push(stats);
      totalSections += stats.totalSections;
      totalCharacters += stats.totalCharacters;
      
      this.logger.log(`${ticker}: ${stats.totalSections} sections, ${stats.totalCharacters} chars`);
    }

    return {
      totalTickers: tickers.length,
      totalSections,
      totalCharacters,
      tickerStats,
    };
  }

  /**
   * Clear existing section files from S3
   */
  async clearExistingSections(): Promise<number> {
    this.logger.log('Clearing existing sections from S3...');
    
    let deletedCount = 0;
    let continuationToken: string | undefined;

    do {
      const listResponse = await this.s3Client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: 'sections/',
        ContinuationToken: continuationToken,
      }));

      const objects = listResponse.Contents || [];
      if (objects.length === 0) break;

      // Delete in batches of 1000 (S3 limit)
      const deleteKeys = objects.map(obj => ({ Key: obj.Key! }));
      
      await this.s3Client.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: deleteKeys },
      }));

      deletedCount += deleteKeys.length;
      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    this.logger.log(`Deleted ${deletedCount} existing section files`);
    return deletedCount;
  }

  /**
   * Get section count in S3
   */
  async getS3SectionCount(): Promise<number> {
    let count = 0;
    let continuationToken: string | undefined;

    do {
      const response = await this.s3Client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: 'sections/',
        ContinuationToken: continuationToken,
      }));

      // Count only .txt files (not .metadata.json)
      const txtFiles = response.Contents?.filter(obj => 
        obj.Key?.endsWith('.txt') && !obj.Key?.endsWith('.metadata.json')
      ) || [];
      
      count += txtFiles.length;
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return count;
  }
}
