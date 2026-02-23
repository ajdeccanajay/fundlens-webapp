import { Test, TestingModule } from '@nestjs/testing';
import { MetricAdminController } from '../../src/admin/metric-admin.controller';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { PlatformAdminGuard } from '../../src/admin/platform-admin.guard';
import { IndexBuildResult } from '../../src/rag/metric-resolution/types';

describe('MetricAdminController', () => {
  let controller: MetricAdminController;
  let registryService: { rebuildIndex: jest.Mock };

  beforeEach(async () => {
    registryService = {
      rebuildIndex: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricAdminController],
      providers: [
        { provide: MetricRegistryService, useValue: registryService },
      ],
    })
      .overrideGuard(PlatformAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MetricAdminController>(MetricAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /api/admin/metrics/rebuild-index', () => {
    it('should call rebuildIndex and return IndexBuildResult', async () => {
      const mockResult: IndexBuildResult = {
        metricsLoaded: 252,
        synonymsIndexed: 1209,
        collisions: 3,
        loadTimeMs: 1200,
      };
      registryService.rebuildIndex.mockResolvedValue(mockResult);

      const response = await controller.rebuildIndex();

      expect(registryService.rebuildIndex).toHaveBeenCalledTimes(1);
      expect(response).toEqual({
        success: true,
        result: mockResult,
      });
    });

    it('should return correct structure with zero collisions', async () => {
      const mockResult: IndexBuildResult = {
        metricsLoaded: 100,
        synonymsIndexed: 500,
        collisions: 0,
        loadTimeMs: 800,
      };
      registryService.rebuildIndex.mockResolvedValue(mockResult);

      const response = await controller.rebuildIndex();

      expect(response.success).toBe(true);
      expect(response.result.metricsLoaded).toBe(100);
      expect(response.result.synonymsIndexed).toBe(500);
      expect(response.result.collisions).toBe(0);
      expect(response.result.loadTimeMs).toBe(800);
    });

    it('should propagate errors from rebuildIndex', async () => {
      registryService.rebuildIndex.mockRejectedValue(
        new Error('S3 connection failed'),
      );

      await expect(controller.rebuildIndex()).rejects.toThrow(
        'S3 connection failed',
      );
    });
  });
});
