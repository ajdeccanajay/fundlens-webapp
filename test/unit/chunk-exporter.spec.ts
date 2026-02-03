/**
 * Chunk Exporter Unit Tests
 * Tests chunk formatting and validation for Bedrock KB
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ChunkExporterService } from '../../src/rag/chunk-exporter.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ChunkExporterService', () => {
  let service: ChunkExporterService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChunkExporterService,
        {
          provide: PrismaService,
          useValue: {
            narrativeChunk: {
              findMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<ChunkExporterService>(ChunkExporterService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('Chunk Validation', () => {
    it('should validate valid chunk', async () => {
      const chunk = {
        ticker: 'SHOP',
        sectionType: 'business',
        content: 'This is a valid chunk with enough content to pass validation. '.repeat(5),
        chunkIndex: 0,
        filingType: '10-K',
        fiscalPeriod: 'FY2024',
        filingDate: new Date(),
      };

      const result = await service.validateChunk(chunk);

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject chunk without ticker', async () => {
      const chunk = {
        sectionType: 'business',
        content: 'Content here',
        chunkIndex: 0,
      };

      const result = await service.validateChunk(chunk);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing ticker');
    });

    it('should reject chunk without content', async () => {
      const chunk = {
        ticker: 'SHOP',
        sectionType: 'business',
        chunkIndex: 0,
      };

      const result = await service.validateChunk(chunk);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing content');
    });

    it('should warn about short content', async () => {
      const chunk = {
        ticker: 'SHOP',
        sectionType: 'business',
        content: 'Short',
        chunkIndex: 0,
      };

      const result = await service.validateChunk(chunk);

      expect(result.warnings).toContain('Content too short (<100 chars)');
    });

    it('should warn about very long content', async () => {
      const chunk = {
        ticker: 'SHOP',
        sectionType: 'business',
        content: 'A'.repeat(9000),
        chunkIndex: 0,
      };

      const result = await service.validateChunk(chunk);

      expect(result.warnings).toContain('Content very long (>8000 chars)');
    });

    it('should warn about missing filing type', async () => {
      const chunk = {
        ticker: 'SHOP',
        sectionType: 'business',
        content: 'Valid content here with enough length to pass. '.repeat(5),
        chunkIndex: 0,
      };

      const result = await service.validateChunk(chunk);

      expect(result.warnings).toContain('Missing filingType');
    });
  });

  describe('Content Cleaning', () => {
    it('should remove HTML tags', () => {
      const content = '<p>This is <b>bold</b> text</p>';
      const cleaned = service['cleanContent'](content);

      expect(cleaned).not.toContain('<');
      expect(cleaned).not.toContain('>');
      expect(cleaned).toContain('This is');
      expect(cleaned).toContain('bold');
    });

    it('should remove XBRL namespace references', () => {
      const content = 'Revenue us-gaap:Revenues was $1B';
      const cleaned = service['cleanContent'](content);

      expect(cleaned).not.toContain('us-gaap:');
    });

    it('should remove URLs', () => {
      const content = 'Visit https://www.example.com for more info';
      const cleaned = service['cleanContent'](content);

      expect(cleaned).not.toContain('https://');
    });

    it('should normalize whitespace', () => {
      const content = 'Multiple   spaces    here\n\nand newlines';
      const cleaned = service['cleanContent'](content);

      expect(cleaned).not.toContain('  ');
    });

    it('should handle empty content', () => {
      const cleaned = service['cleanContent']('');
      expect(cleaned).toBe('');
    });

    it('should handle null content', () => {
      const cleaned = service['cleanContent'](null as any);
      expect(cleaned).toBe('');
    });
  });

  describe('Bedrock Format', () => {
    it('should format chunk for Bedrock', () => {
      const chunk = {
        ticker: 'SHOP',
        sectionType: 'business',
        content: 'Company description content',
        chunkIndex: 5,
        filingType: '10-K',
        fiscalPeriod: 'FY2024',
        filingDate: new Date('2024-03-15'),
        sourcePage: 10,
      };

      const formatted = service['formatChunkForBedrock'](chunk);

      expect(formatted.content).toBe('Company description content');
      expect(formatted.metadata.ticker).toBe('SHOP');
      expect(formatted.metadata.document_type).toBe('sec_filing');
      expect(formatted.metadata.filing_type).toBe('10-K');
      expect(formatted.metadata.section_type).toBe('business');
      expect(formatted.metadata.fiscal_period).toBe('FY2024');
      expect(formatted.metadata.chunk_index).toBe(5);
    });

    it('should handle missing optional fields', () => {
      const chunk = {
        ticker: 'SHOP',
        sectionType: 'mda',
        content: 'MD&A content',
        chunkIndex: 0,
      };

      const formatted = service['formatChunkForBedrock'](chunk);

      expect(formatted.metadata.ticker).toBe('SHOP');
      expect(formatted.metadata.filing_type).toBe('10-K'); // Default
      expect(formatted.metadata.fiscal_period).toBeUndefined();
    });
  });

  describe('Export Statistics', () => {
    it('should calculate export stats', async () => {
      const mockChunks = [
        { ticker: 'SHOP', sectionType: 'business', content: 'A'.repeat(200), chunkIndex: 0 },
        { ticker: 'SHOP', sectionType: 'mda', content: 'B'.repeat(300), chunkIndex: 1 },
        { ticker: 'SHOP', sectionType: 'business', content: 'C'.repeat(250), chunkIndex: 2 },
      ];

      (prisma.narrativeChunk.findMany as jest.Mock).mockResolvedValue(mockChunks);

      const { stats } = await service.exportChunksForBedrock({ ticker: 'SHOP' });

      expect(stats.totalChunks).toBe(3);
      expect(stats.validChunks).toBe(3);
      expect(stats.byTicker['SHOP']).toBe(3);
      expect(stats.bySectionType['business']).toBe(2);
      expect(stats.bySectionType['mda']).toBe(1);
    });
  });
});
