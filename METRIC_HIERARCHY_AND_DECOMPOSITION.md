# Metric Hierarchy and Decomposition Guide

**Your Question**: *"What if subscription revenue is part of a parent revenue tag? So revenue is composed of 'subscription revenue + retail store revenue'?"*

**Short Answer**: The system handles this through **metric relationships** and **aggregation logic** - both parent and child metrics are stored separately with their relationships tracked.

---

## 🎯 The Problem

### Real-World Example: Intuit (INTU)

```
Revenue (Parent)                    = $16.3B
├── Subscription Revenue (Child)    = $14.8B
└── Other Revenue (Child)           = $1.5B
```

**Challenges**:
1. Should "subscription revenue" map to `revenue` or `subscription_revenue`?
2. How do we avoid double-counting when aggregating?
3. How do we answer both "What is revenue?" and "What is subscription revenue?"
4. How do we validate that children sum to parent?

---

## ✅ Solution: Hierarchical Metric Storage

### Database Schema Enhancement

```sql
-- Current schema (simplified)
CREATE TABLE financial_metrics (
  ticker VARCHAR,
  normalized_metric VARCHAR,
  raw_label VARCHAR,
  value DECIMAL,
  fiscal_period VARCHAR,
  -- NEW FIELDS for hierarchy
  parent_metric VARCHAR,        -- Points to parent metric
  metric_level VARCHAR,         -- 'parent', 'child', 'grandchild'
  aggregation_rule VARCHAR,     -- 'sum', 'average', 'none'
  display_order INTEGER         -- For consistent ordering
);
```

### Storage Strategy: Store BOTH Parent and Children

```sql
-- INTU FY2024 Revenue Breakdown
INSERT INTO financial_metrics VALUES
-- Parent metric
('INTU', 'revenue', 'Total Revenue', 16300000000, 'FY2024', NULL, 'parent', 'sum', 1),

-- Child metrics
('INTU', 'subscription_revenue', 'Subscription Revenue', 14800000000, 'FY2024', 'revenue', 'child', 'none', 2),
('INTU', 'other_revenue', 'Other Revenue', 1500000000, 'FY2024', 'revenue', 'child', 'none', 3);
```

**Benefits**:
- ✅ Can query for total revenue
- ✅ Can query for subscription revenue specifically
- ✅ Can validate parent = sum(children)
- ✅ Can show breakdown in UI
- ✅ No double-counting

---

## 📊 Enhanced YAML Configuration

### Add Metric Relationships

```yaml
metrics:
  # Parent metric
  - id: revenue
    name: Revenue
    canonical_name: Revenue
    metric_level: parent
    aggregation_rule: sum
    children:
      - subscription_revenue
      - product_revenue
      - service_revenue
      - other_revenue
    synonyms:
      primary:
        - revenue
        - total revenue
        - net revenue
    xbrl_tags:
      - us-gaap:Revenues
      - us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax

  # Child metrics
  - id: subscription_revenue
    name: Subscription Revenue
    canonical_name: Subscription Revenue
    metric_level: child
    parent: revenue
    aggregation_rule: none
    synonyms:
      primary:
        - subscription revenue
        - recurring revenue
        - saas revenue
    xbrl_tags:
      - intu:SubscriptionRevenue
      - msft:SubscriptionRevenue
    
  - id: product_revenue
    name: Product Revenue
    canonical_name: Product Revenue
    metric_level: child
    parent: revenue
    aggregation_rule: none
    synonyms:
      primary:
        - product revenue
        - products revenue
        - hardware revenue
    xbrl_tags:
      - aapl:ProductsRevenue
      
  - id: service_revenue
    name: Service Revenue
    canonical_name: Service Revenue
    metric_level: child
    parent: revenue
    aggregation_rule: none
    synonyms:
      primary:
        - service revenue
        - services revenue
    xbrl_tags:
      - aapl:ServicesRevenue
```

---

## 🔧 Python Parser Enhancement


### Parser Logic for Hierarchical Metrics

```python
# File: python_parser/hierarchical_metric_parser.py

class HierarchicalMetricParser:
    def __init__(self):
        self.config = self.load_yaml_config()
        self.metric_hierarchy = self.build_hierarchy()
    
    def parse_filing(self, ticker: str, xbrl_data: dict) -> list:
        """
        Parse filing and extract both parent and child metrics
        """
        metrics = []
        parent_metrics = {}  # Track parent values for validation
        
        # Step 1: Extract all metrics from XBRL
        for tag, value in xbrl_data.items():
            metric_info = self.normalize_metric(tag)
            
            if not metric_info:
                continue
            
            metric = {
                'ticker': ticker,
                'normalized_metric': metric_info['id'],
                'raw_label': self.get_label(tag),
                'value': value,
                'parent_metric': metric_info.get('parent'),
                'metric_level': metric_info.get('metric_level', 'parent'),
                'aggregation_rule': metric_info.get('aggregation_rule', 'none'),
            }
            
            metrics.append(metric)
            
            # Track parent metrics for validation
            if metric['metric_level'] == 'parent':
                parent_metrics[metric['normalized_metric']] = metric
        
        # Step 2: Validate parent-child relationships
        self.validate_hierarchy(metrics, parent_metrics)
        
        return metrics
    
    def validate_hierarchy(self, metrics: list, parent_metrics: dict):
        """
        Validate that children sum to parent (within tolerance)
        """
        for parent_id, parent_metric in parent_metrics.items():
            # Get all children
            children = [m for m in metrics 
                       if m.get('parent_metric') == parent_id]
            
            if not children:
                continue
            
            # Calculate sum of children
            children_sum = sum(c['value'] for c in children)
            parent_value = parent_metric['value']
            
            # Check if they match (within 1% tolerance for rounding)
            tolerance = abs(parent_value * 0.01)
            diff = abs(parent_value - children_sum)
            
            if diff > tolerance:
                logger.warning(
                    f"Hierarchy mismatch for {parent_id}: "
                    f"Parent={parent_value}, Children Sum={children_sum}, "
                    f"Diff={diff}"
                )
                
                # Add validation metadata
                parent_metric['validation_status'] = 'mismatch'
                parent_metric['validation_diff'] = diff
            else:
                parent_metric['validation_status'] = 'valid'
                parent_metric['validation_diff'] = 0

# Example usage
parser = HierarchicalMetricParser()
metrics = parser.parse_filing('INTU', xbrl_data)

# Result:
# [
#   {
#     'ticker': 'INTU',
#     'normalized_metric': 'revenue',
#     'raw_label': 'Total Revenue',
#     'value': 16300000000,
#     'parent_metric': None,
#     'metric_level': 'parent',
#     'aggregation_rule': 'sum',
#     'validation_status': 'valid'
#   },
#   {
#     'ticker': 'INTU',
#     'normalized_metric': 'subscription_revenue',
#     'raw_label': 'Subscription Revenue',
#     'value': 14800000000,
#     'parent_metric': 'revenue',
#     'metric_level': 'child',
#     'aggregation_rule': 'none'
#   },
#   {
#     'ticker': 'INTU',
#     'normalized_metric': 'other_revenue',
#     'raw_label': 'Other Revenue',
#     'value': 1500000000,
#     'parent_metric': 'revenue',
#     'metric_level': 'child',
#     'aggregation_rule': 'none'
#   }
# ]
```

---

## 🔍 Query-Time Handling

### TypeScript Service Enhancement

```typescript
// File: src/rag/structured-retriever.service.ts

@Injectable()
export class StructuredRetrieverService {
  async retrieveMetrics(
    ticker: string,
    query: string,
    options?: { includeChildren?: boolean; includeParent?: boolean }
  ): Promise<MetricResult> {
    // Step 1: Normalize the query
    const normalized = await this.metricMapping.resolve(query);
    
    if (!normalized) {
      return { metrics: [], breakdown: null };
    }

    // Step 2: Get the metric configuration
    const metricConfig = await this.metricMapping.getMetricConfig(
      normalized.metricId
    );

    // Step 3: Determine what to retrieve
    const metricsToRetrieve = [normalized.metricId];
    
    // If this is a parent metric and user wants breakdown
    if (metricConfig.metric_level === 'parent' && options?.includeChildren) {
      metricsToRetrieve.push(...metricConfig.children);
    }
    
    // If this is a child metric and user wants context
    if (metricConfig.metric_level === 'child' && options?.includeParent) {
      metricsToRetrieve.push(metricConfig.parent);
    }

    // Step 4: Query database
    const metrics = await this.prisma.financialMetric.findMany({
      where: {
        ticker,
        normalized_metric: { in: metricsToRetrieve },
      },
      orderBy: [
        { metric_level: 'asc' },  // Parent first
        { display_order: 'asc' },
      ],
    });

    // Step 5: Structure the response
    return this.structureHierarchicalResponse(metrics, metricConfig);
  }

  private structureHierarchicalResponse(
    metrics: any[],
    metricConfig: any
  ): MetricResult {
    const parent = metrics.find(m => m.metric_level === 'parent');
    const children = metrics.filter(m => m.metric_level === 'child');

    return {
      metrics,
      breakdown: parent ? {
        parent: {
          metric: parent.normalized_metric,
          label: parent.raw_label,
          value: parent.value,
        },
        children: children.map(c => ({
          metric: c.normalized_metric,
          label: c.raw_label,
          value: c.value,
          percentage: (c.value / parent.value) * 100,
        })),
        validation: {
          parent_value: parent.value,
          children_sum: children.reduce((sum, c) => sum + c.value, 0),
          matches: this.validateSum(parent.value, children),
        },
      } : null,
    };
  }
}
```

---

## 💬 Query Examples

### Example 1: User asks for "subscription revenue"

```typescript
// User query: "What is INTU's subscription revenue?"

// Step 1: Normalize query
const normalized = await metricMapping.resolve('subscription revenue');
// Result: { metricId: 'subscription_revenue', ... }

// Step 2: Check if it's a child metric
const config = await metricMapping.getMetricConfig('subscription_revenue');
// Result: { metric_level: 'child', parent: 'revenue', ... }

// Step 3: Retrieve with context
const result = await retriever.retrieveMetrics('INTU', 'subscription revenue', {
  includeParent: true  // Include parent for context
});

// Step 4: LLM Response
// "Intuit's subscription revenue for FY2024 was $14.8B, 
//  which represents 91% of total revenue ($16.3B)"
```

### Example 2: User asks for "revenue"

```typescript
// User query: "What is INTU's revenue?"

// Step 1: Normalize query
const normalized = await metricMapping.resolve('revenue');
// Result: { metricId: 'revenue', ... }

// Step 2: Check if it's a parent metric
const config = await metricMapping.getMetricConfig('revenue');
// Result: { metric_level: 'parent', children: ['subscription_revenue', ...], ... }

// Step 3: Retrieve with breakdown
const result = await retriever.retrieveMetrics('INTU', 'revenue', {
  includeChildren: true  // Include children for breakdown
});

// Step 4: LLM Response
// "Intuit's total revenue for FY2024 was $16.3B, composed of:
//  - Subscription revenue: $14.8B (91%)
//  - Other revenue: $1.5B (9%)"
```

### Example 3: User asks for "revenue breakdown"

```typescript
// User query: "Show me INTU's revenue breakdown"

// Intent detector recognizes "breakdown" keyword
// Automatically sets includeChildren: true

const result = await retriever.retrieveMetrics('INTU', 'revenue', {
  includeChildren: true
});

// LLM Response with full breakdown
```

---

## 📊 Database Query Patterns

### Pattern 1: Get Parent Only

```sql
SELECT * FROM financial_metrics
WHERE ticker = 'INTU'
  AND normalized_metric = 'revenue'
  AND metric_level = 'parent';
```

### Pattern 2: Get Parent + Children

```sql
-- Get parent
SELECT * FROM financial_metrics
WHERE ticker = 'INTU'
  AND normalized_metric = 'revenue'
  AND metric_level = 'parent'

UNION ALL

-- Get children
SELECT * FROM financial_metrics
WHERE ticker = 'INTU'
  AND parent_metric = 'revenue'
  AND metric_level = 'child'
ORDER BY display_order;
```

### Pattern 3: Get Child + Parent (for context)

```sql
-- Get child
SELECT * FROM financial_metrics
WHERE ticker = 'INTU'
  AND normalized_metric = 'subscription_revenue'

UNION ALL

-- Get parent
SELECT * FROM financial_metrics
WHERE ticker = 'INTU'
  AND normalized_metric = (
    SELECT parent_metric FROM financial_metrics
    WHERE ticker = 'INTU' AND normalized_metric = 'subscription_revenue'
  );
```

---

## 🎨 UI/UX Considerations

### Display Options

**Option 1: Flat Display (Default)**
```
Revenue: $16.3B
```

**Option 2: Hierarchical Display (When breakdown available)**
```
Revenue: $16.3B
├── Subscription Revenue: $14.8B (91%)
└── Other Revenue: $1.5B (9%)
```

**Option 3: Interactive Drill-Down**
```
Revenue: $16.3B [▼ Show breakdown]
  ↓ (user clicks)
Revenue: $16.3B [▲ Hide breakdown]
├── Subscription Revenue: $14.8B (91%)
└── Other Revenue: $1.5B (9%)
```

---

## ⚠️ Edge Cases and Handling

### Edge Case 1: Missing Parent

```
Scenario: XBRL has subscription_revenue but not total revenue

Solution:
- Store subscription_revenue with parent_metric = 'revenue'
- Mark parent as 'inferred' or 'missing'
- Calculate parent by summing children if all children present
```

### Edge Case 2: Mismatched Sums

```
Scenario: Children don't sum to parent (rounding, other items)

Solution:
- Store validation_status = 'mismatch'
- Store validation_diff = abs(parent - sum(children))
- If diff > 1%, flag for review
- Create "Other/Reconciliation" child metric for difference
```

### Edge Case 3: Multiple Levels (Grandchildren)

```
Revenue (Parent)
├── Product Revenue (Child)
│   ├── iPhone Revenue (Grandchild)
│   └── Mac Revenue (Grandchild)
└── Service Revenue (Child)

Solution:
- Support metric_level: 'grandchild'
- Track parent_metric at each level
- Recursive aggregation validation
```

---

## 🔄 Complete Flow Example

### INTU Pipeline with Hierarchical Metrics

```
1. SEC Filing Downloaded
   XBRL contains:
   - us-gaap:Revenues = $16.3B
   - intu:SubscriptionRevenue = $14.8B
   - intu:OtherRevenue = $1.5B

2. Python Parser
   ↓
   Normalizes to:
   - revenue (parent) = $16.3B
   - subscription_revenue (child, parent=revenue) = $14.8B
   - other_revenue (child, parent=revenue) = $1.5B
   
   Validates: $14.8B + $1.5B = $16.3B ✓

3. Database Storage
   ↓
   Stores all 3 metrics with relationships

4. User Query: "What is INTU's subscription revenue?"
   ↓
   MetricMappingService: "subscription revenue" → "subscription_revenue"
   ↓
   Structured Retriever: Retrieves child + parent for context
   ↓
   LLM: "Intuit's subscription revenue for FY2024 was $14.8B (91% of total revenue)"

5. User Query: "What is INTU's revenue?"
   ↓
   MetricMappingService: "revenue" → "revenue"
   ↓
   Structured Retriever: Retrieves parent + children for breakdown
   ↓
   LLM: "Intuit's total revenue for FY2024 was $16.3B, composed of:
         - Subscription revenue: $14.8B (91%)
         - Other revenue: $1.5B (9%)"
```

---

## ✅ Summary

### Your Question: "What if subscription revenue is part of a parent revenue tag?"

**Answer**: Store BOTH parent and child metrics separately with relationships tracked.

**Benefits**:
- ✅ Can query for total revenue
- ✅ Can query for subscription revenue specifically
- ✅ Can show breakdown when requested
- ✅ Can validate parent = sum(children)
- ✅ No double-counting
- ✅ Flexible querying (with/without breakdown)

**Implementation**:
1. **Database**: Add parent_metric, metric_level, aggregation_rule fields
2. **YAML Config**: Define parent-child relationships
3. **Python Parser**: Extract and validate hierarchies
4. **TypeScript Service**: Smart retrieval based on metric level
5. **LLM**: Context-aware responses with breakdowns

**Result**: Enterprise-grade hierarchical metric handling that supports both aggregate and detailed queries.

---

**Status**: Design Complete  
**Next**: Implement database schema changes and parser enhancements  
**Priority**: Medium (current system works, this adds advanced capabilities)

