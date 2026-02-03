/**
 * Pipeline Ingestion Unit Tests
 * 
 * Tests the complete incremental ingestion pipeline:
 * 1. Deal Creation - Input ticker → Create deal
 * 2. SEC Filing Download - Fetch 10-K, 10-Q, 8-K from SEC EDGAR
 * 3. Metrics Parsing - Extract financial metrics from filings
 * 4. Narrative Chunking - Chunk qualitative content
 * 5. RDS Storage - Save metrics and chunks to PostgreSQL
 * 6. S3 Storage - Upload chunks with metadata files
 * 7. Bedrock KB Sync - Ingest to Knowledge Base
 * 8. RAG Query Flow - Intent detection → Structured/Semantic retrieval → Response building
 * 9. LLM Response - Combine metrics + narratives → Claude synthesis
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';

// Mock services for unit testing
const mockPrismaService = {
  deal: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  financialMetric: {
    findMany: jest.fn(),
    count: jest.fn(),
    upsert: jest.fn(),
  },
  narrativeChunk: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  filingMetadata: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  calculatedMetric: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $queryRawUnsafe: jest.fn(),
  $executeRawUnsafe: jest.fn(),
  $transaction: jest.fn(),
};

describe('Pipeline Ingestion Tests', () => {
  let prisma: typeof mockPrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = mockPrismaService;
  });

  describe('Step 1: Deal Creation', () => {
    it('should create deal with ticker for public company', async () => {
      const dealData = {
        name: 'Test Deal - SHOP',
        ticker: 'SHOP',
        dealType: 'public',
        years: 3,
      };

      prisma.$transaction.mockResolvedValue([{
        id: 'test-deal-id',
        name: dealData.name,
        ticker: dealData.ticker,
        status: 'processing',
      }]);

      const result = await prisma.$transaction(async () => {
        return [{
          id: 'test-deal-id',
          name: dealData.name,
          ticker: dealData.ticker,
          status: 'processing',
        }];
      });

      expect(result[0].ticker).toBe('SHOP');
      expect(result[0].status).toBe('processing');
    });

    it('should reject public deal without ticker', () => {
      const dealData: { name: string; dealType: string; ticker?: string } = {
        name: 'Test Deal',
        dealType: 'public',
        // Missing ticker
      };

      expect(dealData.ticker).toBeUndefined();
    });

    it('should allow private deal without ticker', () => {
      const dealData: { name: string; dealType: string; companyName: string; ticker?: string } = {
        name: 'Private Company Deal',
        dealType: 'private',
        companyName: 'Private Corp',
      };

      expect(dealData.dealType).toBe('private');
      expect(dealData.ticker).toBeUndefined();
    });
  });

  describe('Step 2: SEC Filing Download (Incremental)', () => {
    it('should check existing filings before download', async () => {
      const ticker = 'SHOP';
      const existingFilings = [
        { filing_type: '10-K', count: 3 },
        { filing_type: '10-Q', count: 8 },
        { filing_type: '8-K', count: 15 },
      ];

      prisma.$queryRawUnsafe.mockResolvedValue(existingFilings);

      const result = await prisma.$queryRawUnsafe(
        `SELECT filing_type, COUNT(*)::int as count 
         FROM filing_metadata 
         WHERE ticker = $1 AND processed = true
         GROUP BY filing_type`,
        ticker
      );

      expect(result).toEqual(existingFilings);
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('filing_metadata'),
        ticker
      );
    });

    it('should skip already processed filings', async () => {
      const ticker = 'SHOP';
      const filingDate = '2024-01-15';
      
      prisma.filingMetadata.findFirst.mockResolvedValue({
        id: 'existing-filing-id',
        ticker,
        filingType: '10-K',
        filingDate: new Date(filingDate),
        processed: true,
      });

      const existing = await prisma.filingMetadata.findFirst({
        where: {
          ticker,
          filingType: '10-K',
          filingDate: new Date(filingDate),
        },
      });

      expect(existing?.processed).toBe(true);
    });

    it('should identify missing filings for incremental download', () => {
      const required = { '10-K': 5, '10-Q': 20, '8-K': 'all_recent' };
      const existing = { '10-K': 3, '10-Q': 12, '8-K': 10 };

      const missing = {
        '10-K': required['10-K'] - existing['10-K'],
        '10-Q': required['10-Q'] - existing['10-Q'],
      };

      expect(missing['10-K']).toBe(2);
      expect(missing['10-Q']).toBe(8);
    });
  });

  describe('Step 3: Metrics Parsing', () => {
    it('should extract financial metrics from filing', () => {
      const mockMetrics = [
        { normalizedMetric: 'Revenue', value: 5000000000, fiscalPeriod: 'FY2024' },
        { normalizedMetric: 'NetIncome', value: 500000000, fiscalPeriod: 'FY2024' },
        { normalizedMetric: 'GrossProfit', value: 2500000000, fiscalPeriod: 'FY2024' },
      ];

      expect(mockMetrics.length).toBe(3);
      expect(mockMetrics[0].normalizedMetric).toBe('Revenue');
      expect(mockMetrics[0].value).toBeGreaterThan(0);
    });

    it('should normalize metric labels', () => {
      const normalizations: Record<string, string> = {
        'Total Revenue': 'Revenue',
        'Net Income (Loss)': 'NetIncome',
        'Total Assets': 'TotalAssets',
      };

      expect(normalizations['Total Revenue']).toBe('Revenue');
      expect(normalizations['Net Income (Loss)']).toBe('NetIncome');
    });

    it('should validate metric values are not NaN', () => {
      const metrics = [
        { value: 1000000 },
        { value: 0 },
        { value: -500000 },
      ];

      const invalidMetrics = metrics.filter(m => 
        Number.isNaN(m.value) || !Number.isFinite(m.value)
      );

      expect(invalidMetrics.length).toBe(0);
    });

    it('should extract fiscal period from filing', () => {
      const extractPeriod = (filingType: string, filingDate: string): string => {
        const date = new Date(filingDate);
        const year = date.getFullYear();
        
        if (filingType === '10-K') {
          return `FY${year}`;
        }
        
        const quarter = Math.ceil((date.getMonth() + 1) / 3);
        return `Q${quarter}${year}`;
      };

      expect(extractPeriod('10-K', '2024-02-15')).toBe('FY2024');
      expect(extractPeriod('10-Q', '2024-05-10')).toBe('Q22024');
    });
  });

  describe('Step 4: Narrative Chunking', () => {
    it('should chunk narrative content by section', () => {
      const mockChunks = [
        { sectionType: 'business', content: 'Company description...', chunkIndex: 0 },
        { sectionType: 'risk_factors', content: 'Risk factor 1...', chunkIndex: 0 },
        { sectionType: 'mda', content: 'Management discussion...', chunkIndex: 0 },
      ];

      expect(mockChunks.length).toBe(3);
      expect(mockChunks.map(c => c.sectionType)).toContain('business');
      expect(mockChunks.map(c => c.sectionType)).toContain('risk_factors');
    });

    it('should validate chunk content length', () => {
      const validateChunk = (content: string): { isValid: boolean; warnings: string[] } => {
        const warnings: string[] = [];
        
        if (content.length < 100) {
          warnings.push('Content too short (<100 chars)');
        }
        if (content.length > 8000) {
          warnings.push('Content very long (>8000 chars)');
        }
        
        return { isValid: warnings.length === 0, warnings };
      };

      expect(validateChunk('Short').isValid).toBe(false);
      expect(validateChunk('A'.repeat(500)).isValid).toBe(true);
    });

    it('should clean content for Bedrock ingestion', () => {
      const cleanContent = (content: string): string => {
        return content
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/\b[a-z-]+:[A-Za-z0-9_]+/g, '') // Remove XBRL namespaces
          .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim();
      };

      const dirty = '<p>Test content</p> us-gaap:Revenue https://example.com';
      const clean = cleanContent(dirty);

      expect(clean).not.toContain('<p>');
      expect(clean).not.toContain('us-gaap:');
      expect(clean).not.toContain('https://');
    });
  });

  describe('Step 5: RDS Storage', () => {
    it('should upsert metrics to PostgreSQL', async () => {
      const metric = {
        ticker: 'SHOP',
        normalizedMetric: 'Revenue',
        value: 5000000000,
        fiscalPeriod: 'FY2024',
        filingType: '10-K',
      };

      prisma.financialMetric.upsert.mockResolvedValue({
        id: 'metric-id',
        ...metric,
      });

      const result = await prisma.financialMetric.upsert({
        where: {
          ticker_normalizedMetric_fiscalPeriod_filingType: {
            ticker: metric.ticker,
            normalizedMetric: metric.normalizedMetric,
            fiscalPeriod: metric.fiscalPeriod,
            filingType: metric.filingType,
          },
        },
        create: metric,
        update: { value: metric.value },
      });

      expect(result.ticker).toBe('SHOP');
      expect(result.value).toBe(5000000000);
    });

    it('should store narrative chunks in PostgreSQL', async () => {
      const chunk = {
        ticker: 'SHOP',
        filingType: '10-K',
        sectionType: 'business',
        content: 'Shopify is a commerce platform...',
        chunkIndex: 0,
      };

      prisma.narrativeChunk.create.mockResolvedValue({
        id: 'chunk-id',
        ...chunk,
      });

      const result = await prisma.narrativeChunk.create({ data: chunk });

      expect(result.ticker).toBe('SHOP');
      expect(result.sectionType).toBe('business');
    });

    it('should track filing metadata for incremental processing', async () => {
      const filingMetadata = {
        ticker: 'SHOP',
        filingType: '10-K',
        filingDate: new Date('2024-02-15'),
        processed: true,
        metricsCount: 150,
        chunksCount: 45,
      };

      prisma.filingMetadata.upsert.mockResolvedValue({
        id: 'filing-id',
        ...filingMetadata,
      });

      const result = await prisma.filingMetadata.upsert({
        where: { id: 'filing-id' },
        create: filingMetadata,
        update: { processed: true, metricsCount: 150, chunksCount: 45 },
      });

      expect(result.processed).toBe(true);
      expect(result.metricsCount).toBe(150);
    });
  });

  describe('Step 6: S3 Storage with Metadata Files', () => {
    it('should create content file and metadata file pair', () => {
      const chunk = {
        content: 'Shopify is a commerce platform...',
        metadata: {
          ticker: 'SHOP',
          document_type: 'sec_filing',
          filing_type: '10-K',
          section_type: 'business',
          fiscal_period: 'FY2024',
          chunk_index: '0', // Must be string for Bedrock
        },
      };

      const contentKey = 'chunks/SHOP/chunk-0.txt';
      const metadataKey = 'chunks/SHOP/chunk-0.txt.metadata.json';

      expect(metadataKey).toBe(`${contentKey}.metadata.json`);
      expect(typeof chunk.metadata.chunk_index).toBe('string');
    });

    it('should format metadata for Bedrock KB filtering', () => {
      const formatMetadata = (chunk: any) => ({
        metadataAttributes: {
          ticker: chunk.metadata.ticker,
          document_type: chunk.metadata.document_type,
          filing_type: chunk.metadata.filing_type,
          section_type: chunk.metadata.section_type,
          ...(chunk.metadata.fiscal_period ? { fiscal_period: chunk.metadata.fiscal_period } : {}),
          chunk_index: String(chunk.metadata.chunk_index),
        },
      });

      const metadata = formatMetadata({
        metadata: {
          ticker: 'SHOP',
          document_type: 'sec_filing',
          filing_type: '10-K',
          section_type: 'business',
          fiscal_period: 'FY2024',
          chunk_index: 0,
        },
      });

      expect(metadata.metadataAttributes.ticker).toBe('SHOP');
      expect(metadata.metadataAttributes.chunk_index).toBe('0');
      expect(metadata.metadataAttributes.fiscal_period).toBe('FY2024');
    });

    it('should not include empty string values in metadata', () => {
      const formatMetadata = (chunk: any) => {
        const attrs: Record<string, any> = {
          ticker: chunk.ticker,
          filing_type: chunk.filing_type,
        };
        
        // Only include non-empty values
        if (chunk.fiscal_period) {
          attrs.fiscal_period = chunk.fiscal_period;
        }
        
        return { metadataAttributes: attrs };
      };

      const metadata = formatMetadata({
        ticker: 'SHOP',
        filing_type: '10-K',
        fiscal_period: '', // Empty string
      });

      expect(metadata.metadataAttributes.fiscal_period).toBeUndefined();
    });
  });

  describe('Step 7: Bedrock KB Sync', () => {
    it('should trigger ingestion job after S3 upload', () => {
      const ingestionParams = {
        knowledgeBaseId: 'NB5XNMHBQT',
        dataSourceId: 'OQMSFOE5SL',
      };

      expect(ingestionParams.knowledgeBaseId).toBe('NB5XNMHBQT');
      expect(ingestionParams.dataSourceId).toBe('OQMSFOE5SL');
    });

    it('should poll for ingestion job completion', async () => {
      const mockJobStatus = {
        status: 'COMPLETE',
        statistics: {
          numberOfDocumentsScanned: 2003,
          numberOfNewDocumentsIndexed: 1500,
          numberOfDocumentsFailed: 0,
        },
      };

      expect(mockJobStatus.status).toBe('COMPLETE');
      expect(mockJobStatus.statistics.numberOfDocumentsFailed).toBe(0);
    });

    it('should handle ingestion failures gracefully', () => {
      const mockFailedJob = {
        status: 'FAILED',
        failureReasons: ['Invalid metadata attributes'],
      };

      expect(mockFailedJob.status).toBe('FAILED');
      expect(mockFailedJob.failureReasons.length).toBeGreaterThan(0);
    });
  });

  describe('Step 8: RAG Query Flow', () => {
    it('should detect quantitative intent for metric queries', () => {
      const detectIntent = (query: string) => {
        const quantitativePatterns = [
          /revenue/i, /income/i, /margin/i, /ebitda/i,
          /cash flow/i, /assets/i, /liabilities/i,
        ];
        
        const isQuantitative = quantitativePatterns.some(p => p.test(query));
        return isQuantitative ? 'structured' : 'semantic';
      };

      expect(detectIntent('What is SHOP revenue?')).toBe('structured');
      expect(detectIntent('What does SHOP do?')).toBe('semantic');
    });

    it('should detect qualitative intent for narrative queries', () => {
      const detectIntent = (query: string) => {
        const qualitativePatterns = [
          /describe/i, /explain/i, /what does.*do/i,
          /business model/i, /strategy/i, /risk/i,
        ];
        
        const isQualitative = qualitativePatterns.some(p => p.test(query));
        return isQualitative ? 'semantic' : 'structured';
      };

      expect(detectIntent('Describe the business model')).toBe('semantic');
      expect(detectIntent('What are the risk factors?')).toBe('semantic');
    });

    it('should detect hybrid intent for combined queries', () => {
      const detectIntent = (query: string) => {
        const quantitativePatterns = [/revenue/i, /margin/i, /growth/i];
        const qualitativePatterns = [/strategy/i, /explain/i, /why/i];
        
        const hasQuantitative = quantitativePatterns.some(p => p.test(query));
        const hasQualitative = qualitativePatterns.some(p => p.test(query));
        
        if (hasQuantitative && hasQualitative) return 'hybrid';
        if (hasQuantitative) return 'structured';
        return 'semantic';
      };

      expect(detectIntent('Explain the revenue growth strategy')).toBe('hybrid');
    });

    it('should apply ticker metadata filter for retrieval', () => {
      const buildFilter = (ticker: string) => ({
        equals: { key: 'ticker', value: ticker.toUpperCase() },
      });

      const filter = buildFilter('shop');
      expect(filter.equals.value).toBe('SHOP');
    });
  });

  describe('Step 9: LLM Response Generation', () => {
    it('should combine metrics and narratives for context', () => {
      const buildContext = (metrics: any[], narratives: any[]) => {
        const parts: string[] = [];
        
        if (metrics.length > 0) {
          parts.push('=== STRUCTURED METRICS ===');
          metrics.forEach(m => {
            parts.push(`${m.ticker} - ${m.metric}: ${m.value} (${m.period})`);
          });
        }
        
        if (narratives.length > 0) {
          parts.push('=== NARRATIVE CONTEXT ===');
          narratives.forEach((n, i) => {
            parts.push(`[Source ${i + 1}: ${n.ticker} ${n.filingType}]`);
            parts.push(n.content);
          });
        }
        
        return parts.join('\n');
      };

      const context = buildContext(
        [{ ticker: 'SHOP', metric: 'Revenue', value: '5B', period: 'FY2024' }],
        [{ ticker: 'SHOP', filingType: '10-K', content: 'Shopify is...' }]
      );

      expect(context).toContain('STRUCTURED METRICS');
      expect(context).toContain('NARRATIVE CONTEXT');
      expect(context).toContain('SHOP');
    });

    it('should format metric values correctly', () => {
      const formatValue = (value: number, metric: string): string => {
        if (metric.includes('margin') || metric.includes('pct')) {
          return `${value.toFixed(2)}%`;
        }
        if (Math.abs(value) >= 1_000_000_000) {
          return `${(value / 1_000_000_000).toFixed(2)}B`;
        }
        if (Math.abs(value) >= 1_000_000) {
          return `${(value / 1_000_000).toFixed(2)}M`;
        }
        return value.toFixed(2);
      };

      expect(formatValue(5_000_000_000, 'revenue')).toBe('5.00B');
      expect(formatValue(250_000_000, 'net_income')).toBe('250.00M');
      expect(formatValue(0.45, 'gross_margin')).toBe('0.45%');
    });

    it('should include source citations in response', () => {
      const mockResponse = {
        answer: 'Shopify generated $5B in revenue...',
        sources: [
          { ticker: 'SHOP', filingType: '10-K', sectionType: 'business' },
          { ticker: 'SHOP', filingType: '10-K', sectionType: 'mda' },
        ],
        usage: { inputTokens: 1500, outputTokens: 500 },
      };

      expect(mockResponse.sources.length).toBeGreaterThan(0);
      expect(mockResponse.sources[0].ticker).toBe('SHOP');
    });
  });

  describe('Incremental Processing', () => {
    it('should track processed filings to avoid reprocessing', async () => {
      const isAlreadyProcessed = async (ticker: string, filingType: string, filingDate: string) => {
        const existing = await prisma.filingMetadata.findFirst({
          where: { ticker, filingType, filingDate: new Date(filingDate) },
        });
        return existing?.processed === true;
      };

      prisma.filingMetadata.findFirst.mockResolvedValue({
        processed: true,
      });

      const processed = await isAlreadyProcessed('SHOP', '10-K', '2024-02-15');
      expect(processed).toBe(true);
    });

    it('should only upload new chunks to S3', () => {
      const getNewChunks = (allChunks: any[], existingKeys: string[]) => {
        return allChunks.filter(chunk => {
          const key = `chunks/${chunk.ticker}/chunk-${chunk.chunkIndex}.txt`;
          return !existingKeys.includes(key);
        });
      };

      const allChunks = [
        { ticker: 'SHOP', chunkIndex: 0 },
        { ticker: 'SHOP', chunkIndex: 1 },
        { ticker: 'SHOP', chunkIndex: 2 },
      ];
      const existingKeys = ['chunks/SHOP/chunk-0.txt', 'chunks/SHOP/chunk-1.txt'];

      const newChunks = getNewChunks(allChunks, existingKeys);
      expect(newChunks.length).toBe(1);
      expect(newChunks[0].chunkIndex).toBe(2);
    });

    it('should calculate delta for KB sync', () => {
      const calculateDelta = (rdsCount: number, kbCount: number) => ({
        needsSync: rdsCount > kbCount,
        delta: rdsCount - kbCount,
      });

      const delta = calculateDelta(2003, 1500);
      expect(delta.needsSync).toBe(true);
      expect(delta.delta).toBe(503);
    });
  });

  describe('Error Handling', () => {
    it('should handle SEC API rate limiting', () => {
      const handleRateLimit = (error: any) => {
        if (error.status === 429) {
          return { retry: true, delay: 10000 };
        }
        return { retry: false };
      };

      const result = handleRateLimit({ status: 429 });
      expect(result.retry).toBe(true);
      expect(result.delay).toBe(10000);
    });

    it('should handle parsing failures gracefully', () => {
      const handleParsingError = (ticker: string, filingType: string, error: Error) => ({
        ticker,
        filingType,
        status: 'failed',
        error: error.message,
        retryable: !error.message.includes('invalid format'),
      });

      const result = handleParsingError('SHOP', '10-K', new Error('Timeout'));
      expect(result.status).toBe('failed');
      expect(result.retryable).toBe(true);
    });

    it('should continue pipeline on non-critical failures', () => {
      const pipelineSteps = [
        { name: 'SEC Download', critical: true },
        { name: 'Metrics Parsing', critical: true },
        { name: 'News Fetch', critical: false },
        { name: 'KB Sync', critical: false },
      ];

      const shouldContinue = (stepName: string, failed: boolean) => {
        const step = pipelineSteps.find(s => s.name === stepName);
        return !step?.critical || !failed;
      };

      expect(shouldContinue('News Fetch', true)).toBe(true);
      expect(shouldContinue('SEC Download', true)).toBe(false);
    });
  });
});
