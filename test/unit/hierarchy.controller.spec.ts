import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HierarchyController } from '../../src/deals/hierarchy.controller';
import { MetricHierarchyService } from '../../src/deals/metric-hierarchy.service';
import { TenantGuard } from '../../src/tenant/tenant.guard';

describe('HierarchyController', () => {
  let controller: HierarchyController;
  let service: MetricHierarchyService;

  const mockMetricHierarchyService = {
    getMetricHierarchy: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HierarchyController],
      providers: [
        {
          provide: MetricHierarchyService,
          useValue: mockMetricHierarchyService,
        },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<HierarchyController>(HierarchyController);
    service = module.get<MetricHierarchyService>(MetricHierarchyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHierarchy', () => {
    it('should return hierarchical structure', async () => {
      const mockHierarchy = [
        {
          metricId: 'metric-1',
          metricName: 'Revenue',
          parentId: null,
          level: 0,
          isKeyDriver: true,
          formula: null,
          contribution: null,
          statementType: 'income_statement',
        },
        {
          metricId: 'metric-2',
          metricName: 'Product Revenue',
          parentId: 'metric-1',
          level: 1,
          isKeyDriver: false,
          formula: null,
          contribution: 75.5,
          statementType: 'income_statement',
        },
      ];

      mockMetricHierarchyService.getMetricHierarchy.mockResolvedValue(mockHierarchy);

      const result = await controller.getHierarchy('deal-123', 'FY2024');

      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy.length).toBe(1); // Only root node
      expect(result.hierarchy[0].name).toBe('Revenue');
      expect(result.hierarchy[0].children.length).toBe(1);
      expect(result.hierarchy[0].children[0].name).toBe('Product Revenue');
      expect(result.metadata.totalMetrics).toBe(2);
      expect(result.metadata.rootMetrics).toBe(1);
    });

    it('should throw 404 when hierarchy not found', async () => {
      mockMetricHierarchyService.getMetricHierarchy.mockResolvedValue([]);

      await expect(controller.getHierarchy('deal-123', 'FY2024')).rejects.toThrow(
        new HttpException(
          'Hierarchy not found for this deal and period',
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('should throw 500 on service error', async () => {
      mockMetricHierarchyService.getMetricHierarchy.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(controller.getHierarchy('deal-123', 'FY2024')).rejects.toThrow(
        new HttpException('Failed to load hierarchy', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe('getChildren', () => {
    it('should return children for a metric', async () => {
      const mockHierarchy = [
        {
          metricId: 'metric-1',
          metricName: 'Revenue',
          parentId: null,
          level: 0,
          isKeyDriver: true,
          formula: null,
          contribution: null,
        },
        {
          metricId: 'metric-2',
          metricName: 'Product Revenue',
          parentId: 'metric-1',
          level: 1,
          isKeyDriver: false,
          formula: null,
          contribution: 75.5,
        },
        {
          metricId: 'metric-3',
          metricName: 'Services Revenue',
          parentId: 'metric-1',
          level: 1,
          isKeyDriver: false,
          formula: null,
          contribution: 24.5,
        },
      ];

      mockMetricHierarchyService.getMetricHierarchy.mockResolvedValue(mockHierarchy);

      const result = await controller.getChildren('deal-123', 'FY2024', 'metric-1');

      expect(result.children.length).toBe(2);
      expect(result.children[0].name).toBe('Product Revenue');
      expect(result.children[1].name).toBe('Services Revenue');
      expect(result.metadata.parentId).toBe('metric-1');
      expect(result.metadata.childCount).toBe(2);
    });

    it('should return empty array for leaf nodes', async () => {
      const mockHierarchy = [
        {
          metricId: 'metric-1',
          metricName: 'Revenue',
          parentId: null,
          level: 0,
          isKeyDriver: true,
          formula: null,
          contribution: null,
        },
      ];

      mockMetricHierarchyService.getMetricHierarchy.mockResolvedValue(mockHierarchy);

      const result = await controller.getChildren('deal-123', 'FY2024', 'metric-1');

      expect(result.children.length).toBe(0);
    });

    it('should throw 500 on service error', async () => {
      mockMetricHierarchyService.getMetricHierarchy.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        controller.getChildren('deal-123', 'FY2024', 'metric-1'),
      ).rejects.toThrow(
        new HttpException('Failed to load children', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe('getPath', () => {
    it('should return path from root to metric', async () => {
      const mockHierarchy = [
        {
          metricId: 'metric-1',
          metricName: 'Revenue',
          parentId: null,
          level: 0,
        },
        {
          metricId: 'metric-2',
          metricName: 'Product Revenue',
          parentId: 'metric-1',
          level: 1,
        },
        {
          metricId: 'metric-3',
          metricName: 'iPhone Revenue',
          parentId: 'metric-2',
          level: 2,
        },
      ];

      mockMetricHierarchyService.getMetricHierarchy.mockResolvedValue(mockHierarchy);

      const result = await controller.getPath('deal-123', 'FY2024', 'metric-3');

      expect(result.path.length).toBe(3);
      expect(result.path[0].name).toBe('Revenue');
      expect(result.path[1].name).toBe('Product Revenue');
      expect(result.path[2].name).toBe('iPhone Revenue');
      expect(result.metadata.depth).toBe(3);
    });

    it('should throw 404 when metric not found', async () => {
      mockMetricHierarchyService.getMetricHierarchy.mockResolvedValue([]);

      await expect(
        controller.getPath('deal-123', 'FY2024', 'metric-999'),
      ).rejects.toThrow(new HttpException('Metric not found', HttpStatus.NOT_FOUND));
    });

    it('should throw 500 on service error', async () => {
      mockMetricHierarchyService.getMetricHierarchy.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        controller.getPath('deal-123', 'FY2024', 'metric-1'),
      ).rejects.toThrow(
        new HttpException('Failed to load path', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });
});
