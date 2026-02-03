#!/usr/bin/env node
/**
 * Build metric hierarchy for COST ticker
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function buildHierarchy() {
  const ticker = 'COST';
  const dealId = 'e498fc20-7b34-48b0-a9e2-c3bf0bd54259';
  
  console.log(`\n🔍 Building metric hierarchy for ${ticker}...`);
  
  // Get financial metrics
  const metrics = await prisma.financialMetric.findMany({
    where: { ticker },
    orderBy: { filingDate: 'desc' }
  });
  
  console.log(`📊 Found ${metrics.length} financial metrics`);
  
  // Get unique fiscal periods
  const periods = [...new Set(metrics.map(m => m.fiscalPeriod).filter(Boolean))];
  console.log(`📅 Fiscal periods: ${periods.slice(0, 5).join(', ')}...`);
  
  // Define hierarchy structure
  const hierarchyDefinition = {
    'revenue': {
      displayName: 'Revenue',
      level: 0,
      isKeyDriver: true,
      children: ['membership_fees', 'merchandise_sales']
    },
    'gross_profit': {
      displayName: 'Gross Profit',
      level: 0,
      isKeyDriver: true,
      children: ['revenue', 'cost_of_goods_sold']
    },
    'operating_income': {
      displayName: 'Operating Income',
      level: 0,
      isKeyDriver: true,
      children: ['gross_profit', 'operating_expenses']
    },
    'net_income': {
      displayName: 'Net Income',
      level: 0,
      isKeyDriver: true,
      children: ['operating_income', 'interest_expense', 'income_tax_expense']
    },
    'total_assets': {
      displayName: 'Total Assets',
      level: 0,
      isKeyDriver: false,
      children: ['current_assets', 'non_current_assets']
    },
    'operating_cash_flow': {
      displayName: 'Operating Cash Flow',
      level: 0,
      isKeyDriver: true,
      children: ['net_income', 'depreciation', 'working_capital_changes']
    }
  };
  
  // Build hierarchy for each period
  for (const fiscalPeriod of periods.slice(0, 5)) {
    const periodMetrics = metrics.filter(m => m.fiscalPeriod === fiscalPeriod);
    console.log(`\n📊 Processing ${fiscalPeriod} (${periodMetrics.length} metrics)`);
    
    let savedCount = 0;
    
    for (const [metricName, def] of Object.entries(hierarchyDefinition)) {
      const metric = periodMetrics.find(m => 
        m.normalizedMetric === metricName || 
        m.metricName?.toLowerCase().includes(metricName.replace('_', ' '))
      );
      
      if (metric) {
        try {
          await prisma.$executeRaw`
            INSERT INTO metric_hierarchy (deal_id, fiscal_period, metric_name, display_name, parent_metric, children, level, is_key_driver, value, created_at, updated_at)
            VALUES (
              ${dealId}::uuid,
              ${fiscalPeriod},
              ${metricName},
              ${def.displayName},
              NULL,
              ${JSON.stringify(def.children)}::jsonb,
              ${def.level},
              ${def.isKeyDriver},
              ${parseFloat(metric.value.toString())},
              NOW(),
              NOW()
            )
            ON CONFLICT (deal_id, fiscal_period, metric_name) 
            DO UPDATE SET
              display_name = ${def.displayName},
              children = ${JSON.stringify(def.children)}::jsonb,
              level = ${def.level},
              is_key_driver = ${def.isKeyDriver},
              value = ${parseFloat(metric.value.toString())},
              updated_at = NOW()
          `;
          savedCount++;
        } catch (err) {
          // Ignore duplicates
        }
      }
    }
    
    console.log(`  💾 Saved ${savedCount} hierarchy nodes for ${fiscalPeriod}`);
  }
  
  console.log('\n✅ Metric hierarchy build complete!');
}

buildHierarchy()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
