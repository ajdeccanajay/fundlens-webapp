import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Metric Node - Node in the metric hierarchy graph
 */
export interface MetricNode {
  metricId: string;
  normalizedName: string;
  label: string;
  value: number;
  
  // Hierarchy
  parentId?: string;
  childrenIds: string[];
  siblingIds: string[];
  level: number;
  
  // Relationships
  calculationFormula?: string;
  rollupType: 'sum' | 'difference' | 'product' | 'ratio';
  
  // Validation
  calculatedValue?: number;
  variance?: number;
  variancePercent?: number;
  
  // Metadata
  statementType: string;
  fiscalPeriod: string;
  displayOrder: number;
}

/**
 * Validation Error - Rollup validation error
 */
export interface ValidationError {
  metricId: string;
  metricName: string;
  expected: number;
  actual: number;
  variance: number;
  variancePercent: number;
  childrenIds: string[];
}

/**
 * MetricHierarchyService
 * 
 * Builds and manages hierarchical relationships between financial metrics
 * for interactive drill-down analysis.
 * 
 * Features:
 * - Build parent-child relationship graph from flat metrics
 * - Infer calculation formulas (Revenue - COGS = Gross Profit)
 * - Validate rollups (parent = sum of children)
 * - Navigate hierarchy (drill-down paths, subtrees)
 * - Detect key drivers and relationships
 */
@Injectable()
export class MetricHierarchyService {
  private readonly logger = new Logger(MetricHierarchyService.name);

  // Common metric formulas
  private readonly KNOWN_FORMULAS = {
    'gross_profit': { formula: 'revenue - cost_of_revenue', type: 'difference' as const },
    'operating_income': { formula: 'gross_profit - operating_expenses', type: 'difference' as const },
    'income_before_tax': { formula: 'operating_income + other_income - other_expenses', type: 'sum' as const },
    'net_income': { formula: 'income_before_tax - income_tax_expense', type: 'difference' as const },
    'ebitda': { formula: 'operating_income + depreciation + amortization', type: 'sum' as const },
    'free_cash_flow': { formula: 'operating_cash_flow - capital_expenditures', type: 'difference' as const }
  };

  constructor(private prisma: PrismaService) {}

  /**
   * Build hierarchy graph from flat metrics
   */
  buildHierarchy(metrics: any[]): Map<string, MetricNode> {
    this.logger.log(`Building hierarchy from ${metrics.length} metrics`);

    const nodes = new Map<string, MetricNode>();

    // Step 1: Create nodes
    for (const metric of metrics) {
      const node: MetricNode = {
        metricId: metric.id,
        normalizedName: metric.normalized_metric || metric.normalizedMetric,
        label: metric.label || metric.raw_label,
        value: parseFloat(metric.value) || 0,
        parentId: metric.parent_metric || metric.parentMetric,
        childrenIds: [],
        siblingIds: [],
        level: metric.indent_level || metric.indentLevel || 0,
        rollupType: 'sum',
        statementType: metric.statement_type || metric.statementType || 'unknown',
        fiscalPeriod: metric.fiscal_period || metric.fiscalPeriod || 'unknown',
        displayOrder: metric.display_order || metric.displayOrder || 0
      };

      nodes.set(node.metricId, node);
    }

    // Step 2: Build parent-child relationships
    for (const node of nodes.values()) {
      if (node.parentId && nodes.has(node.parentId)) {
        const parent = nodes.get(node.parentId)!;
        parent.childrenIds.push(node.metricId);
      }
    }

    // Step 3: Build sibling relationships
    for (const node of nodes.values()) {
      if (node.parentId && nodes.has(node.parentId)) {
        const parent = nodes.get(node.parentId)!;
        node.siblingIds = parent.childrenIds.filter(id => id !== node.metricId);
      }
    }

    // Step 4: Infer formulas
    for (const node of nodes.values()) {
      const formula = this.inferFormula(node, nodes);
      if (formula) {
        node.calculationFormula = formula.formula;
        node.rollupType = formula.type;
      }
    }

    // Step 5: Calculate expected values
    for (const node of nodes.values()) {
      if (node.childrenIds.length > 0) {
        const calculated = this.calculateExpectedValue(node, nodes);
        if (calculated !== null) {
          node.calculatedValue = calculated;
          node.variance = Math.abs(node.value - calculated);
          node.variancePercent = node.value !== 0 
            ? (node.variance / Math.abs(node.value)) * 100 
            : 0;
        }
      }
    }

    this.logger.log(`Built hierarchy with ${nodes.size} nodes`);
    return nodes;
  }

  /**
   * Infer calculation formula for a metric
   */
  private inferFormula(
    node: MetricNode,
    nodes: Map<string, MetricNode>
  ): { formula: string; type: MetricNode['rollupType'] } | null {
    // Check known formulas
    const known = this.KNOWN_FORMULAS[node.normalizedName];
    if (known) {
      return known;
    }

    // If has children, default to sum
    if (node.childrenIds.length > 0) {
      const childNames = node.childrenIds
        .map(id => nodes.get(id)?.normalizedName)
        .filter(Boolean)
        .join(' + ');
      
      return {
        formula: childNames || 'sum(children)',
        type: 'sum'
      };
    }

    return null;
  }

  /**
   * Calculate expected value based on children
   */
  private calculateExpectedValue(
    node: MetricNode,
    nodes: Map<string, MetricNode>
  ): number | null {
    if (node.childrenIds.length === 0) {
      return null;
    }

    const children = node.childrenIds
      .map(id => nodes.get(id))
      .filter(Boolean) as MetricNode[];

    if (children.length === 0) {
      return null;
    }

    // Default: sum of children
    return children.reduce((sum, child) => sum + child.value, 0);
  }

  /**
   * Validate rollups (parent = sum of children)
   */
  validateRollups(
    nodes: Map<string, MetricNode>,
    tolerancePercent: number = 1.0
  ): ValidationError[] {
    this.logger.log(`Validating rollups with ${tolerancePercent}% tolerance`);

    const errors: ValidationError[] = [];

    for (const node of nodes.values()) {
      if (node.childrenIds.length > 0 && node.calculatedValue !== undefined) {
        if (node.variancePercent! > tolerancePercent) {
          errors.push({
            metricId: node.metricId,
            metricName: node.normalizedName,
            expected: node.calculatedValue,
            actual: node.value,
            variance: node.variance!,
            variancePercent: node.variancePercent!,
            childrenIds: node.childrenIds
          });
        }
      }
    }

    this.logger.log(`Found ${errors.length} validation errors`);
    return errors.sort((a, b) => b.variancePercent - a.variancePercent);
  }

  /**
   * Get drill-down path from root to metric
   */
  getDrillDownPath(
    metricId: string,
    nodes: Map<string, MetricNode>
  ): MetricNode[] {
    const path: MetricNode[] = [];
    let current = nodes.get(metricId);

    while (current) {
      path.unshift(current);
      current = current.parentId ? nodes.get(current.parentId) : undefined;
    }

    return path;
  }

  /**
   * Get subtree (all descendants) of a metric
   */
  getSubtree(
    metricId: string,
    nodes: Map<string, MetricNode>
  ): MetricNode[] {
    const node = nodes.get(metricId);
    if (!node) {
      return [];
    }

    const subtree: MetricNode[] = [node];

    for (const childId of node.childrenIds) {
      subtree.push(...this.getSubtree(childId, nodes));
    }

    return subtree;
  }

  /**
   * Get siblings of a metric
   */
  getSiblings(
    metricId: string,
    nodes: Map<string, MetricNode>
  ): MetricNode[] {
    const node = nodes.get(metricId);
    if (!node) {
      return [];
    }

    return node.siblingIds
      .map(id => nodes.get(id))
      .filter(Boolean) as MetricNode[];
  }

  /**
   * Get root metrics (top-level, no parent)
   */
  getRootMetrics(nodes: Map<string, MetricNode>): MetricNode[] {
    return Array.from(nodes.values())
      .filter(node => !node.parentId)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  /**
   * Get children of a metric
   */
  getChildren(
    metricId: string,
    nodes: Map<string, MetricNode>
  ): MetricNode[] {
    const node = nodes.get(metricId);
    if (!node) {
      return [];
    }

    return node.childrenIds
      .map(id => nodes.get(id))
      .filter(Boolean)
      .sort((a, b) => a!.displayOrder - b!.displayOrder) as MetricNode[];
  }

  /**
   * Find key drivers (children with largest contribution)
   */
  findKeyDrivers(
    metricId: string,
    nodes: Map<string, MetricNode>,
    topN: number = 3
  ): MetricNode[] {
    const children = this.getChildren(metricId, nodes);
    
    return children
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, topN);
  }

  /**
   * Calculate contribution percentage of child to parent
   */
  calculateContribution(
    childId: string,
    parentId: string,
    nodes: Map<string, MetricNode>
  ): number {
    const child = nodes.get(childId);
    const parent = nodes.get(parentId);

    if (!child || !parent || parent.value === 0) {
      return 0;
    }

    return (child.value / parent.value) * 100;
  }

  /**
   * Get metrics by statement type
   */
  getMetricsByStatement(
    nodes: Map<string, MetricNode>,
    statementType: string
  ): MetricNode[] {
    return Array.from(nodes.values())
      .filter(node => node.statementType === statementType)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  /**
   * Get metrics by level
   */
  getMetricsByLevel(
    nodes: Map<string, MetricNode>,
    level: number
  ): MetricNode[] {
    return Array.from(nodes.values())
      .filter(node => node.level === level)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  /**
   * Check if metric has children
   */
  hasChildren(metricId: string, nodes: Map<string, MetricNode>): boolean {
    const node = nodes.get(metricId);
    return node ? node.childrenIds.length > 0 : false;
  }

  /**
   * Get maximum depth of hierarchy
   */
  getMaxDepth(nodes: Map<string, MetricNode>): number {
    let maxDepth = 0;
    
    for (const node of nodes.values()) {
      maxDepth = Math.max(maxDepth, node.level);
    }
    
    return maxDepth;
  }

  /**
   * Detect circular references
   */
  detectCircularReferences(nodes: Map<string, MetricNode>): string[][] {
    const circular: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string, path: string[]): void => {
      if (recursionStack.has(nodeId)) {
        // Found circular reference
        const cycleStart = path.indexOf(nodeId);
        circular.push(path.slice(cycleStart).concat(nodeId));
        return;
      }

      if (visited.has(nodeId)) {
        return;
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const node = nodes.get(nodeId);
      if (node) {
        for (const childId of node.childrenIds) {
          dfs(childId, [...path]);
        }
      }

      recursionStack.delete(nodeId);
    };

    for (const node of nodes.values()) {
      if (!visited.has(node.metricId)) {
        dfs(node.metricId, []);
      }
    }

    return circular;
  }

  /**
   * Save hierarchy to database
   */
  async saveHierarchy(
    dealId: string,
    nodes: Map<string, MetricNode>
  ): Promise<void> {
    this.logger.log(`Saving hierarchy for deal ${dealId} (${nodes.size} nodes)`);

    try {
      for (const node of nodes.values()) {
        // Upsert using raw SQL (Prisma doesn't have the schema for this table)
        await this.prisma.$executeRawUnsafe(`
          INSERT INTO metric_hierarchy (
            deal_id, metric_id, parent_id, children_ids, sibling_ids,
            level, normalized_name, label, value, calculation_formula,
            rollup_type, calculated_value, variance, variance_percent,
            statement_type, fiscal_period, display_order, created_at, updated_at
          )
          VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid[], $5::uuid[],
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17, NOW(), NOW()
          )
          ON CONFLICT (deal_id, metric_id) DO UPDATE SET
            parent_id = EXCLUDED.parent_id,
            children_ids = EXCLUDED.children_ids,
            sibling_ids = EXCLUDED.sibling_ids,
            level = EXCLUDED.level,
            normalized_name = EXCLUDED.normalized_name,
            label = EXCLUDED.label,
            value = EXCLUDED.value,
            calculation_formula = EXCLUDED.calculation_formula,
            rollup_type = EXCLUDED.rollup_type,
            calculated_value = EXCLUDED.calculated_value,
            variance = EXCLUDED.variance,
            variance_percent = EXCLUDED.variance_percent,
            statement_type = EXCLUDED.statement_type,
            fiscal_period = EXCLUDED.fiscal_period,
            display_order = EXCLUDED.display_order,
            updated_at = NOW()
        `,
          dealId,
          node.metricId,
          node.parentId || null,
          node.childrenIds || [],
          node.siblingIds || [],
          node.level,
          node.normalizedName,
          node.label,
          node.value,
          node.calculationFormula || null,
          node.rollupType,
          node.calculatedValue || null,
          node.variance || null,
          node.variancePercent || null,
          node.statementType,
          node.fiscalPeriod,
          node.displayOrder
        );
      }

      this.logger.log(`✅ Hierarchy saved successfully: ${nodes.size} nodes`);
    } catch (error) {
      this.logger.error(`Failed to save hierarchy: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get hierarchy for a deal
   */
  async getHierarchyForDeal(dealId: string): Promise<Map<string, MetricNode>> {
    try {
      const records = await this.prisma.$queryRawUnsafe(`
        SELECT 
          id, deal_id as "dealId", metric_id as "metricId",
          parent_id as "parentId", children_ids as "childrenIds", sibling_ids as "siblingIds",
          level, normalized_name as "normalizedName", label, value,
          calculation_formula as "calculationFormula", rollup_type as "rollupType",
          calculated_value as "calculatedValue", variance, variance_percent as "variancePercent",
          statement_type as "statementType", fiscal_period as "fiscalPeriod", display_order as "displayOrder"
        FROM metric_hierarchy
        WHERE deal_id = $1::uuid
        ORDER BY fiscal_period DESC, display_order ASC
      `, dealId) as any[];

      const nodes = new Map<string, MetricNode>();
      for (const record of records) {
        nodes.set(record.metricId, {
          metricId: record.metricId,
          normalizedName: record.normalizedName,
          label: record.label,
          value: parseFloat(record.value) || 0,
          parentId: record.parentId,
          childrenIds: record.childrenIds || [],
          siblingIds: record.siblingIds || [],
          level: record.level,
          calculationFormula: record.calculationFormula,
          rollupType: record.rollupType,
          calculatedValue: record.calculatedValue ? parseFloat(record.calculatedValue) : undefined,
          variance: record.variance ? parseFloat(record.variance) : undefined,
          variancePercent: record.variancePercent ? parseFloat(record.variancePercent) : undefined,
          statementType: record.statementType,
          fiscalPeriod: record.fiscalPeriod,
          displayOrder: record.displayOrder
        });
      }

      this.logger.log(`Retrieved hierarchy for deal ${dealId}: ${nodes.size} nodes`);
      return nodes;
    } catch (error) {
      this.logger.error(`Failed to get hierarchy: ${error.message}`);
      return new Map();
    }
  }
}
