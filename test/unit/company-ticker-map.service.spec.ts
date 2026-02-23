import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanyTickerMapService } from '../../src/rag/intent-detection/company-ticker-map.service';

describe('CompanyTickerMapService', () => {
  let service: CompanyTickerMapService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      dataSource: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    service = new CompanyTickerMapService(mockPrisma);
    // Initialize the service (loads base reference list + attempts DB load)
    await service.onModuleInit();
  });

  describe('resolve()', () => {
    it('should resolve "apple" to AAPL', () => {
      expect(service.resolve('apple')).toBe('AAPL');
    });

    it('should resolve "Apple Inc" to AAPL', () => {
      expect(service.resolve('Apple Inc')).toBe('AAPL');
    });

    it('should resolve "Apple Inc." to AAPL', () => {
      expect(service.resolve('Apple Inc.')).toBe('AAPL');
    });

    it('should resolve "microsoft" to MSFT', () => {
      expect(service.resolve('microsoft')).toBe('MSFT');
    });

    it('should resolve "Microsoft Corporation" to MSFT', () => {
      expect(service.resolve('Microsoft Corporation')).toBe('MSFT');
    });

    it('should resolve "nvidia" to NVDA', () => {
      expect(service.resolve('nvidia')).toBe('NVDA');
    });

    it('should resolve "Nvidia Corp" to NVDA', () => {
      expect(service.resolve('Nvidia Corp')).toBe('NVDA');
    });

    it('should resolve "amazon" to AMZN', () => {
      expect(service.resolve('amazon')).toBe('AMZN');
    });

    it('should resolve "google" to GOOGL', () => {
      expect(service.resolve('google')).toBe('GOOGL');
    });

    it('should resolve "tesla" to TSLA', () => {
      expect(service.resolve('tesla')).toBe('TSLA');
    });

    it('should be case-insensitive', () => {
      expect(service.resolve('APPLE')).toBe('AAPL');
      expect(service.resolve('Apple')).toBe('AAPL');
      expect(service.resolve('apple')).toBe('AAPL');
      expect(service.resolve('NVIDIA')).toBe('NVDA');
    });

    it('should handle leading/trailing whitespace', () => {
      expect(service.resolve('  apple  ')).toBe('AAPL');
      expect(service.resolve(' microsoft ')).toBe('MSFT');
    });

    it('should return undefined for unknown company names', () => {
      expect(service.resolve('unknown company xyz')).toBeUndefined();
      expect(service.resolve('')).toBeUndefined();
    });

    it('should resolve ticker symbols as keys (e.g., "aapl" → AAPL)', () => {
      expect(service.resolve('aapl')).toBe('AAPL');
      expect(service.resolve('msft')).toBe('MSFT');
      expect(service.resolve('nvda')).toBe('NVDA');
    });

    it('should resolve financial companies', () => {
      expect(service.resolve('jpmorgan')).toBe('JPM');
      expect(service.resolve('goldman sachs')).toBe('GS');
      expect(service.resolve('visa')).toBe('V');
      expect(service.resolve('mastercard')).toBe('MA');
    });

    it('should resolve healthcare companies', () => {
      expect(service.resolve('pfizer')).toBe('PFE');
      expect(service.resolve('eli lilly')).toBe('LLY');
      expect(service.resolve('amgen')).toBe('AMGN');
    });

    it('should resolve consumer companies', () => {
      expect(service.resolve('walmart')).toBe('WMT');
      expect(service.resolve('costco')).toBe('COST');
      expect(service.resolve('coca-cola')).toBe('KO');
      expect(service.resolve('nike')).toBe('NKE');
    });

    it('should resolve energy companies', () => {
      expect(service.resolve('exxon')).toBe('XOM');
      expect(service.resolve('chevron')).toBe('CVX');
    });
  });

  describe('resolveAll()', () => {
    it('should find a single company name in a query', () => {
      const tickers = service.resolveAll('What is Apple revenue?');
      expect(tickers).toContain('AAPL');
    });

    it('should find multiple company names in a query', () => {
      const tickers = service.resolveAll('Compare Apple and Microsoft revenue');
      expect(tickers).toContain('AAPL');
      expect(tickers).toContain('MSFT');
    });

    it('should return deduplicated tickers', () => {
      // "apple" and "apple inc" both map to AAPL — result should be deduplicated
      const tickers = service.resolveAll('Apple Inc reported strong results for apple');
      const aaplCount = tickers.filter((t) => t === 'AAPL').length;
      expect(aaplCount).toBe(1);
    });

    it('should be case-insensitive for query matching', () => {
      const tickers = service.resolveAll('NVIDIA vs AMD chip war');
      expect(tickers).toContain('NVDA');
      expect(tickers).toContain('AMD');
    });

    it('should return empty array when no company names are found', () => {
      // Note: query must not contain any substring matching a company name or ticker key
      // e.g., "t" is AT&T's ticker key, so avoid words containing single-letter ticker matches
      const tickers = service.resolveAll('12345 67890');
      expect(tickers).toEqual([]);
    });

    it('should find three or more companies in a query', () => {
      const tickers = service.resolveAll(
        'Compare Apple, Microsoft, and Google cloud revenue',
      );
      expect(tickers).toContain('AAPL');
      expect(tickers).toContain('MSFT');
      expect(tickers).toContain('GOOGL');
    });
  });

  describe('getAllTickers()', () => {
    it('should return a Set of all known tickers', () => {
      const tickers = service.getAllTickers();
      expect(tickers).toBeInstanceOf(Set);
      expect(tickers.has('AAPL')).toBe(true);
      expect(tickers.has('MSFT')).toBe(true);
      expect(tickers.has('NVDA')).toBe(true);
      expect(tickers.has('AMZN')).toBe(true);
      expect(tickers.has('GOOGL')).toBe(true);
    });

    it('should contain major sector tickers', () => {
      const tickers = service.getAllTickers();
      // Tech
      expect(tickers.has('META')).toBe(true);
      // Finance
      expect(tickers.has('JPM')).toBe(true);
      // Healthcare
      expect(tickers.has('UNH')).toBe(true);
      // Consumer
      expect(tickers.has('WMT')).toBe(true);
      // Energy
      expect(tickers.has('XOM')).toBe(true);
    });
  });

  describe('base reference list', () => {
    it('should contain expected major companies', () => {
      const size = service.getMapSize();
      // Base reference list has ~100 companies with multiple name variants each
      // Plus ticker-as-key entries, so total should be well over 100
      expect(size).toBeGreaterThan(100);
    });

    it('should include name variants for major companies', () => {
      // Apple has: apple, apple inc, apple inc., aapl
      expect(service.resolve('apple')).toBe('AAPL');
      expect(service.resolve('apple inc')).toBe('AAPL');
      expect(service.resolve('apple inc.')).toBe('AAPL');

      // Meta has: meta, meta platforms, meta platforms inc, facebook
      expect(service.resolve('meta')).toBe('META');
      expect(service.resolve('meta platforms')).toBe('META');
      expect(service.resolve('facebook')).toBe('META');
    });
  });

  describe('refresh() with database data', () => {
    it('should load tenant tickers from database and merge with base list', async () => {
      mockPrisma.dataSource.findMany.mockResolvedValue([
        {
          sourceId: 'ZZZZ-10-K-2024',
          metadata: { ticker: 'ZZZZ', companyName: 'Zzz Corp' },
        },
      ]);

      await service.refresh();

      // Tenant ticker should be available
      expect(service.resolve('zzz corp')).toBe('ZZZZ');
      expect(service.resolve('zzzz')).toBe('ZZZZ');
      // Base list should still work
      expect(service.resolve('apple')).toBe('AAPL');
    });

    it('should allow tenant tickers to override base list entries', async () => {
      // If a tenant has a custom mapping, it should take precedence
      mockPrisma.dataSource.findMany.mockResolvedValue([
        {
          sourceId: 'CUSTOM-10-K-2024',
          metadata: { ticker: 'CUSTOM', companyName: 'Apple' },
        },
      ]);

      await service.refresh();

      // Tenant override takes precedence (tenant entries spread after base)
      expect(service.resolve('apple')).toBe('CUSTOM');
    });

    it('should gracefully handle database failure and fall back to base list', async () => {
      mockPrisma.dataSource.findMany.mockRejectedValue(
        new Error('Database connection failed'),
      );

      await service.refresh();

      // Base list should still work
      expect(service.resolve('apple')).toBe('AAPL');
      expect(service.resolve('microsoft')).toBe('MSFT');
    });

    it('should extract tickers from sourceId patterns', async () => {
      mockPrisma.dataSource.findMany.mockResolvedValue([
        {
          sourceId: 'NEWCO-10-K-2024',
          metadata: {},
        },
      ]);

      await service.refresh();

      // Should extract NEWCO from sourceId pattern
      expect(service.resolve('newco')).toBe('NEWCO');
    });
  });

  describe('no hardcoded companyMap usage', () => {
    it('should NOT have a static companyMap property — mapping is loaded dynamically', () => {
      // The old IntentDetectorService had a hardcoded companyMap object.
      // CompanyTickerMapService loads its map dynamically via refresh().
      // Verify the service uses a private Map that's populated at runtime.
      const serviceAny = service as any;

      // The companyMap should be a Map instance (not a plain object literal)
      expect(serviceAny.companyMap).toBeInstanceOf(Map);

      // It should have been populated by onModuleInit → refresh()
      expect(serviceAny.companyMap.size).toBeGreaterThan(0);

      // lastRefresh should be set (proving refresh() was called)
      expect(serviceAny.lastRefresh).toBeGreaterThan(0);
    });

    it('should update the map when refresh() is called with new data', async () => {
      const initialSize = service.getMapSize();

      mockPrisma.dataSource.findMany.mockResolvedValue([
        {
          sourceId: 'BRAND-10-K-2024',
          metadata: { ticker: 'BRAND', companyName: 'Brand New Corp' },
        },
      ]);

      await service.refresh();

      // Map should have grown with the new tenant ticker
      expect(service.getMapSize()).toBeGreaterThan(initialSize);
      expect(service.resolve('brand new corp')).toBe('BRAND');
    });
  });
});
