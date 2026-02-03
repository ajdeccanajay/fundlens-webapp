import { Test, TestingModule } from '@nestjs/testing';
import { MetricHierarchyService } from '../../src/deals/metric-hierarchy.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('MetricHierarchyService', () => {
  let service: MetricHierarchyService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricHierarchyService,
        {
          provide: PrismaService,
          useValue: {
            metricHierarchy: {
              upsert: jest.fn(),
              findMany: jest.fn()
            }
          }
        }
      ]
    }).compile();

    service = module.get<MetricHierarchyService>(MetricHierarchyService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildHierarchy', () => {
    it('should build hierarchy from flat metrics', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0, display_order: 1 },
        { id: '2', normalized_metric: 'cost_of_revenue', value: 60, indent_level: 0, display_order: 2 },
        { id: '3', normalized_metric: 'gross_profit', value: 40, indent_level: 0, display_order: 3 }
      ];

      const nodes = service.buildHierarchy(metrics);

      expect(nodes.size).toBe(3);
      expect(nodes.get('1')?.normalizedName).toBe('revenue');
      expect(nodes.get('1')?.value).toBe(100);
    });

    it('should establish parent-child relationships', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'service_revenue', value: 30, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);

      const parent = nodes.get('1');
      expect(parent?.childrenIds).toEqual(['2', '3']);
      
      const child1 = nodes.get('2');
      expect(child1?.parentId).toBe('1');
      expect(child1?.siblingIds).toEqual(['3']);
    });

    it('should calculate levels correctly', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'iphone_revenue', value: 50, parent_metric: '2', indent_level: 2 }
      ];

      const nodes = service.buildHierarchy(metrics);

      expect(nodes.get('1')?.level).toBe(0);
      expect(nodes.get('2')?.level).toBe(1);
      expect(nodes.get('3')?.level).toBe(2);
    });

    it('should infer formulas for known metrics', () => {
      const metrics = [
        { id: '1', normalized_metric: 'gross_profit', value: 40, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);

      const node = nodes.get('1');
      expect(node?.calculationFormula).toBe('revenue - cost_of_revenue');
      expect(node?.rollupType).toBe('difference');
    });

    it('should calculate expected values from children', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'service_revenue', value: 30, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);

      const parent = nodes.get('1');
      expect(parent?.calculatedValue).toBe(100); // 70 + 30
      expect(parent?.variance).toBe(0);
    });

    it('should detect variance in rollups', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 105, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'service_revenue', value: 30, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);

      const parent = nodes.get('1');
      expect(parent?.calculatedValue).toBe(100); // 70 + 30
      expect(parent?.variance).toBe(5); // |105 - 100|
      expect(parent?.variancePercent).toBeCloseTo(4.76, 1); // (5/105) * 100
    });

    it('should handle empty metrics array', () => {
      const nodes = service.buildHierarchy([]);
      expect(nodes.size).toBe(0);
    });

    it('should handle metrics without parent', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'expenses', value: 60, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);

      expect(nodes.get('1')?.parentId).toBeUndefined();
      expect(nodes.get('2')?.parentId).toBeUndefined();
    });
  });

  describe('validateRollups', () => {
    it('should validate parent equals sum of children', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'service_revenue', value: 30, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const errors = service.validateRollups(nodes);

      expect(errors).toHaveLength(0);
    });

    it('should detect variance > 1%', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 105, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'service_revenue', value: 30, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const errors = service.validateRollups(nodes, 1.0);

      expect(errors).toHaveLength(1);
      expect(errors[0].metricName).toBe('revenue');
      expect(errors[0].expected).toBe(100);
      expect(errors[0].actual).toBe(105);
      expect(errors[0].variance).toBe(5);
    });

    it('should sort errors by variance percentage', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 105, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'service_revenue', value: 30, parent_metric: '1', indent_level: 1 },
        { id: '4', normalized_metric: 'expenses', value: 120, indent_level: 0 },
        { id: '5', normalized_metric: 'operating_expenses', value: 50, parent_metric: '4', indent_level: 1 },
        { id: '6', normalized_metric: 'other_expenses', value: 50, parent_metric: '4', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const errors = service.validateRollups(nodes, 1.0);

      expect(errors.length).toBeGreaterThan(0);
      // First error should have highest variance percentage
      if (errors.length > 1) {
        expect(errors[0].variancePercent).toBeGreaterThanOrEqual(errors[1].variancePercent);
      }
    });

    it('should use custom tolerance', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 102, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'service_revenue', value: 30, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      
      // With 1% tolerance, should have error
      const errors1 = service.validateRollups(nodes, 1.0);
      expect(errors1).toHaveLength(1);
      
      // With 5% tolerance, should have no error
      const errors5 = service.validateRollups(nodes, 5.0);
      expect(errors5).toHaveLength(0);
    });
  });

  describe('getDrillDownPath', () => {
    it('should get path from root to metric', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'iphone_revenue', value: 50, parent_metric: '2', indent_level: 2 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const path = service.getDrillDownPath('3', nodes);

      expect(path).toHaveLength(3);
      expect(path[0].metricId).toBe('1');
      expect(path[1].metricId).toBe('2');
      expect(path[2].metricId).toBe('3');
    });

    it('should return single node for root metric', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const path = service.getDrillDownPath('1', nodes);

      expect(path).toHaveLength(1);
      expect(path[0].metricId).toBe('1');
    });

    it('should return empty array for non-existent metric', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const path = service.getDrillDownPath('999', nodes);

      expect(path).toHaveLength(0);
    });
  });

  describe('getSubtree', () => {
    it('should get all descendants', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'service_revenue', value: 30, parent_metric: '1', indent_level: 1 },
        { id: '4', normalized_metric: 'iphone_revenue', value: 50, parent_metric: '2', indent_level: 2 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const subtree = service.getSubtree('1', nodes);

      expect(subtree).toHaveLength(4);
      expect(subtree.map(n => n.metricId)).toContain('1');
      expect(subtree.map(n => n.metricId)).toContain('2');
      expect(subtree.map(n => n.metricId)).toContain('3');
      expect(subtree.map(n => n.metricId)).toContain('4');
    });

    it('should return single node for leaf metric', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const subtree = service.getSubtree('2', nodes);

      expect(subtree).toHaveLength(1);
      expect(subtree[0].metricId).toBe('2');
    });

    it('should return empty array for non-existent metric', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const subtree = service.getSubtree('999', nodes);

      expect(subtree).toHaveLength(0);
    });
  });

  describe('getSiblings', () => {
    it('should get sibling metrics', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'service_revenue', value: 30, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const siblings = service.getSiblings('2', nodes);

      expect(siblings).toHaveLength(1);
      expect(siblings[0].metricId).toBe('3');
    });

    it('should return empty array for metric without siblings', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const siblings = service.getSiblings('2', nodes);

      expect(siblings).toHaveLength(0);
    });

    it('should return empty array for root metric', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const siblings = service.getSiblings('1', nodes);

      expect(siblings).toHaveLength(0);
    });
  });

  describe('getRootMetrics', () => {
    it('should get all root metrics', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0, display_order: 1 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'expenses', value: 60, indent_level: 0, display_order: 2 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const roots = service.getRootMetrics(nodes);

      expect(roots).toHaveLength(2);
      expect(roots[0].metricId).toBe('1');
      expect(roots[1].metricId).toBe('3');
    });

    it('should sort by display order', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0, display_order: 2 },
        { id: '2', normalized_metric: 'expenses', value: 60, indent_level: 0, display_order: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const roots = service.getRootMetrics(nodes);

      expect(roots[0].metricId).toBe('2'); // display_order: 1
      expect(roots[1].metricId).toBe('1'); // display_order: 2
    });
  });

  describe('getChildren', () => {
    it('should get children of a metric', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1, display_order: 1 },
        { id: '3', normalized_metric: 'service_revenue', value: 30, parent_metric: '1', indent_level: 1, display_order: 2 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const children = service.getChildren('1', nodes);

      expect(children).toHaveLength(2);
      expect(children[0].metricId).toBe('2');
      expect(children[1].metricId).toBe('3');
    });

    it('should return empty array for leaf metric', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const children = service.getChildren('2', nodes);

      expect(children).toHaveLength(0);
    });

    it('should sort children by display order', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1, display_order: 2 },
        { id: '3', normalized_metric: 'service_revenue', value: 30, parent_metric: '1', indent_level: 1, display_order: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const children = service.getChildren('1', nodes);

      expect(children[0].metricId).toBe('3'); // display_order: 1
      expect(children[1].metricId).toBe('2'); // display_order: 2
    });
  });

  describe('findKeyDrivers', () => {
    it('should find top N children by absolute value', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'service_revenue', value: 20, parent_metric: '1', indent_level: 1 },
        { id: '4', normalized_metric: 'other_revenue', value: 10, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const drivers = service.findKeyDrivers('1', nodes, 2);

      expect(drivers).toHaveLength(2);
      expect(drivers[0].metricId).toBe('2'); // 70
      expect(drivers[1].metricId).toBe('3'); // 20
    });

    it('should handle negative values', () => {
      const metrics = [
        { id: '1', normalized_metric: 'income', value: 50, indent_level: 0 },
        { id: '2', normalized_metric: 'revenue', value: 100, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'expenses', value: -50, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const drivers = service.findKeyDrivers('1', nodes, 2);

      expect(drivers).toHaveLength(2);
      expect(drivers[0].metricId).toBe('2'); // |100| = 100
      expect(drivers[1].metricId).toBe('3'); // |-50| = 50
    });

    it('should return all children if topN > children count', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const drivers = service.findKeyDrivers('1', nodes, 5);

      expect(drivers).toHaveLength(1);
    });
  });

  describe('calculateContribution', () => {
    it('should calculate percentage contribution', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const contribution = service.calculateContribution('2', '1', nodes);

      expect(contribution).toBe(70); // (70/100) * 100
    });

    it('should return 0 for parent with zero value', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 0, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const contribution = service.calculateContribution('2', '1', nodes);

      expect(contribution).toBe(0);
    });

    it('should return 0 for non-existent metrics', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const contribution = service.calculateContribution('999', '1', nodes);

      expect(contribution).toBe(0);
    });
  });

  describe('getMetricsByStatement', () => {
    it('should filter metrics by statement type', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, statement_type: 'income_statement', indent_level: 0 },
        { id: '2', normalized_metric: 'assets', value: 200, statement_type: 'balance_sheet', indent_level: 0 },
        { id: '3', normalized_metric: 'expenses', value: 60, statement_type: 'income_statement', indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const incomeMetrics = service.getMetricsByStatement(nodes, 'income_statement');

      expect(incomeMetrics).toHaveLength(2);
      expect(incomeMetrics.map(m => m.metricId)).toContain('1');
      expect(incomeMetrics.map(m => m.metricId)).toContain('3');
    });

    it('should return empty array for non-existent statement type', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, statement_type: 'income_statement', indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const metrics2 = service.getMetricsByStatement(nodes, 'cash_flow');

      expect(metrics2).toHaveLength(0);
    });
  });

  describe('getMetricsByLevel', () => {
    it('should filter metrics by level', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'iphone_revenue', value: 50, parent_metric: '2', indent_level: 2 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const level1Metrics = service.getMetricsByLevel(nodes, 1);

      expect(level1Metrics).toHaveLength(1);
      expect(level1Metrics[0].metricId).toBe('2');
    });

    it('should return empty array for non-existent level', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const level5Metrics = service.getMetricsByLevel(nodes, 5);

      expect(level5Metrics).toHaveLength(0);
    });
  });

  describe('hasChildren', () => {
    it('should return true for metric with children', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const result = service.hasChildren('1', nodes);

      expect(result).toBe(true);
    });

    it('should return false for leaf metric', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const result = service.hasChildren('2', nodes);

      expect(result).toBe(false);
    });

    it('should return false for non-existent metric', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const result = service.hasChildren('999', nodes);

      expect(result).toBe(false);
    });
  });

  describe('getMaxDepth', () => {
    it('should return maximum depth of hierarchy', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'iphone_revenue', value: 50, parent_metric: '2', indent_level: 2 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const maxDepth = service.getMaxDepth(nodes);

      expect(maxDepth).toBe(2);
    });

    it('should return 0 for flat hierarchy', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'expenses', value: 60, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const maxDepth = service.getMaxDepth(nodes);

      expect(maxDepth).toBe(0);
    });

    it('should return 0 for empty hierarchy', () => {
      const nodes = service.buildHierarchy([]);
      const maxDepth = service.getMaxDepth(nodes);

      expect(maxDepth).toBe(0);
    });
  });

  describe('detectCircularReferences', () => {
    it('should detect circular reference', () => {
      const metrics = [
        { id: '1', normalized_metric: 'a', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'b', value: 50, parent_metric: '1', indent_level: 1 },
        { id: '3', normalized_metric: 'c', value: 25, parent_metric: '2', indent_level: 2 }
      ];

      const nodes = service.buildHierarchy(metrics);
      
      // Manually create circular reference for testing
      nodes.get('3')!.childrenIds.push('1');
      
      const circular = service.detectCircularReferences(nodes);

      expect(circular.length).toBeGreaterThan(0);
    });

    it('should return empty array for valid hierarchy', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'product_revenue', value: 70, parent_metric: '1', indent_level: 1 }
      ];

      const nodes = service.buildHierarchy(metrics);
      const circular = service.detectCircularReferences(nodes);

      expect(circular).toHaveLength(0);
    });
  });

  describe('saveHierarchy', () => {
    it('should save hierarchy (when migration ready)', async () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);

      // Should not throw error even though database table doesn't exist yet
      await expect(service.saveHierarchy('deal-123', nodes)).resolves.not.toThrow();
    });
  });

  describe('getHierarchyForDeal', () => {
    it('should return empty map until migration ready', async () => {
      const nodes = await service.getHierarchyForDeal('deal-123');
      expect(nodes.size).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle metrics with null values', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: null, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);

      expect(nodes.get('1')?.value).toBe(0);
    });

    it('should handle metrics with undefined parent', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, parent_metric: undefined, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);

      expect(nodes.get('1')?.parentId).toBeUndefined();
    });

    it('should handle metrics with non-existent parent', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, parent_metric: '999', indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);

      expect(nodes.get('1')?.parentId).toBe('999');
      expect(nodes.get('1')?.childrenIds).toHaveLength(0);
    });

    it('should handle very deep hierarchy', () => {
      const metrics = [];
      for (let i = 0; i < 10; i++) {
        metrics.push({
          id: `${i}`,
          normalized_metric: `metric_${i}`,
          value: 100 - i * 10,
          parent_metric: i > 0 ? `${i - 1}` : undefined,
          indent_level: i
        });
      }

      const nodes = service.buildHierarchy(metrics);

      expect(nodes.size).toBe(10);
      expect(service.getMaxDepth(nodes)).toBe(9);
    });

    it('should handle metrics with same normalized name', () => {
      const metrics = [
        { id: '1', normalized_metric: 'revenue', value: 100, indent_level: 0 },
        { id: '2', normalized_metric: 'revenue', value: 90, indent_level: 0 }
      ];

      const nodes = service.buildHierarchy(metrics);

      expect(nodes.size).toBe(2);
      expect(nodes.get('1')?.normalizedName).toBe('revenue');
      expect(nodes.get('2')?.normalizedName).toBe('revenue');
    });
  });
});
