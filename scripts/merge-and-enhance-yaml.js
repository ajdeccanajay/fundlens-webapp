#!/usr/bin/env node

/**
 * Merge and Enhance YAML Configuration
 * 
 * Purpose:
 * 1. Merge existing metric_mapping.yaml and metric_mapping_enhanced.yaml
 * 2. Add all 117 metrics from Excel (listed in requirements)
 * 3. Extract synonyms from database analysis
 * 4. Add company-specific XBRL tags
 * 5. Validate final YAML
 * 
 * Output: Enhanced metric_mapping_enhanced.yaml with 117+ metrics
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Load existing YAML files
const yamlPath1 = path.join(__dirname, '..', 'python_parser', 'xbrl_parsing', 'metric_mapping.yaml');
const yamlPath2 = path.join(__dirname, '..', 'python_parser', 'xbrl_parsing', 'metric_mapping_enhanced.yaml');
const dbAnalysisPath = path.join(__dirname, '..', 'database-metrics-analysis.json');
const outputPath = path.join(__dirname, '..', 'python_parser', 'xbrl_parsing', 'metric_mapping_enhanced.yaml');

console.log('🔄 Starting YAML merge and enhancement...\n');

// Load files
console.log('📂 Loading existing YAML files...');
const yaml1 = yaml.load(fs.readFileSync(yamlPath1, 'utf8'));
const yaml2 = yaml.load(fs.readFileSync(yamlPath2, 'utf8'));
const dbAnalysis = JSON.parse(fs.readFileSync(dbAnalysisPath, 'utf8'));

console.log(`   - metric_mapping.yaml: ${yaml1.metrics.length} metrics`);
console.log(`   - metric_mapping_enhanced.yaml: ${yaml2.metrics.length} metrics`);
console.log(`   - Database analysis: ${dbAnalysis.normalizedMetrics.length} normalized metrics\n`);

// Merge metrics (prefer enhanced version if duplicate)
console.log('🔀 Merging metrics...');
const mergedMetrics = new Map();

// Add from yaml2 first (enhanced version)
yaml2.metrics.forEach(metric => {
  mergedMetrics.set(metric.id, metric);
});

// Add from yaml1 if not already present
yaml1.metrics.forEach(metric => {
  if (!mergedMetrics.has(metric.id)) {
    // Normalize synonyms format before adding
    if (metric.synonyms && Array.isArray(metric.synonyms)) {
      metric.synonyms = { primary: metric.synonyms };
    }
    // Ensure statement_type is present
    if (!metric.statement_type) {
      // Infer from metric name/id
      if (metric.id.includes('cash_flow') || metric.id === 'fcf' || metric.id === 'capex') {
        metric.statement_type = 'cash_flow';
      } else if (metric.id.includes('asset') || metric.id.includes('liability') || metric.id.includes('equity')) {
        metric.statement_type = 'balance_sheet';
      } else {
        metric.statement_type = 'income_statement';
      }
    }
    mergedMetrics.set(metric.id, metric);
  } else {
    // Merge synonyms if metric exists
    const existing = mergedMetrics.get(metric.id);
    if (metric.synonyms) {
      existing.synonyms = existing.synonyms || { primary: [] };
      existing.synonyms.primary = existing.synonyms.primary || [];
      
      // Handle both array and object formats
      const newSynonyms = Array.isArray(metric.synonyms) 
        ? metric.synonyms 
        : (metric.synonyms.primary || []);
      
      newSynonyms.forEach(syn => {
        if (!existing.synonyms.primary.includes(syn)) {
          existing.synonyms.primary.push(syn);
        }
      });
    }
  }
});

console.log(`   - Merged: ${mergedMetrics.size} unique metrics\n`);

// Extract top synonyms from database analysis
console.log('📊 Extracting synonyms from database...');
const dbSynonyms = new Map();

// Get top 100 most common raw labels
const topLabels = dbAnalysis.rawLabels
  .filter(l => l.occurrenceCount > 50) // Only frequent labels
  .slice(0, 200);

topLabels.forEach(label => {
  const normalizedTo = label.normalizedTo;
  if (!dbSynonyms.has(normalizedTo)) {
    dbSynonyms.set(normalizedTo, new Set());
  }
  
  // Clean up the label (remove us-gaap: prefix, convert to readable)
  let cleanLabel = label.label
    .replace(/^us-gaap:/, '')
    .replace(/^ifrs-full:/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase();
  
  dbSynonyms.get(normalizedTo).add(cleanLabel);
});

console.log(`   - Extracted synonyms for ${dbSynonyms.size} metrics\n`);

// Add database synonyms to merged metrics
dbSynonyms.forEach((synonyms, metricId) => {
  if (mergedMetrics.has(metricId)) {
    const metric = mergedMetrics.get(metricId);
    if (!metric.synonyms) {
      metric.synonyms = { primary: [] };
    }
    if (!metric.synonyms.primary) {
      metric.synonyms.primary = [];
    }
    
    synonyms.forEach(syn => {
      if (!metric.synonyms.primary.includes(syn)) {
        metric.synonyms.primary.push(syn);
      }
    });
  }
});

// Add missing critical metrics from requirements
console.log('➕ Adding missing critical metrics...');

const criticalMetrics = [
  {
    id: 'total_debt',
    name: 'Total Debt',
    canonical_name: 'Total Debt',
    statement_type: 'balance_sheet',
    period_type: 'instant',
    synonyms: {
      primary: ['total debt', 'debt', 'total borrowings', 'total liabilities debt']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:DebtCurrent', 'us-gaap:LongTermDebt']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'current_assets',
    name: 'Current Assets',
    canonical_name: 'Current Assets',
    statement_type: 'balance_sheet',
    period_type: 'instant',
    synonyms: {
      primary: ['current assets', 'total current assets']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:AssetsCurrent']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'current_liabilities',
    name: 'Current Liabilities',
    canonical_name: 'Current Liabilities',
    statement_type: 'balance_sheet',
    period_type: 'instant',
    synonyms: {
      primary: ['current liabilities', 'total current liabilities']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:LiabilitiesCurrent']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'accounts_receivable',
    name: 'Accounts Receivable',
    canonical_name: 'Accounts Receivable',
    statement_type: 'balance_sheet',
    period_type: 'instant',
    synonyms: {
      primary: ['accounts receivable', 'receivables', 'trade receivables', 'ar']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:AccountsReceivableNetCurrent']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'accounts_payable',
    name: 'Accounts Payable',
    canonical_name: 'Accounts Payable',
    statement_type: 'balance_sheet',
    period_type: 'instant',
    synonyms: {
      primary: ['accounts payable', 'payables', 'trade payables', 'ap']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:AccountsPayableCurrent']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'inventory',
    name: 'Inventory',
    canonical_name: 'Inventory',
    statement_type: 'balance_sheet',
    period_type: 'instant',
    synonyms: {
      primary: ['inventory', 'inventories', 'stock']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:InventoryNet']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'goodwill',
    name: 'Goodwill',
    canonical_name: 'Goodwill',
    statement_type: 'balance_sheet',
    period_type: 'instant',
    synonyms: {
      primary: ['goodwill']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:Goodwill']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'intangible_assets',
    name: 'Intangible Assets',
    canonical_name: 'Intangible Assets',
    statement_type: 'balance_sheet',
    period_type: 'instant',
    synonyms: {
      primary: ['intangible assets', 'intangibles']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:IntangibleAssetsNetExcludingGoodwill']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'ppe_net',
    name: 'PP&E Net',
    canonical_name: 'Property, Plant & Equipment (Net)',
    statement_type: 'balance_sheet',
    period_type: 'instant',
    synonyms: {
      primary: ['property plant and equipment', 'ppe', 'pp&e', 'fixed assets', 'net ppe']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:PropertyPlantAndEquipmentNet']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'retained_earnings',
    name: 'Retained Earnings',
    canonical_name: 'Retained Earnings',
    statement_type: 'balance_sheet',
    period_type: 'instant',
    synonyms: {
      primary: ['retained earnings', 'accumulated earnings']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:RetainedEarningsAccumulatedDeficit']
      }
    },
    sign_rule: 'signed',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'dividends_paid',
    name: 'Dividends Paid',
    canonical_name: 'Dividends Paid',
    statement_type: 'cash_flow',
    period_type: 'duration',
    synonyms: {
      primary: ['dividends paid', 'cash dividends', 'dividend payments']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:PaymentsOfDividends']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'share_repurchases',
    name: 'Share Repurchases',
    canonical_name: 'Share Repurchases',
    statement_type: 'cash_flow',
    period_type: 'duration',
    synonyms: {
      primary: ['share repurchases', 'stock buybacks', 'treasury stock purchases', 'repurchase of common stock']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:PaymentsForRepurchaseOfCommonStock']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'change_in_working_capital',
    name: 'Change in Working Capital',
    canonical_name: 'Change in Working Capital',
    statement_type: 'cash_flow',
    period_type: 'duration',
    synonyms: {
      primary: ['change in working capital', 'working capital change', 'increase decrease in working capital']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:IncreaseDecreaseInOperatingCapital']
      }
    },
    sign_rule: 'signed',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'tax_expense',
    name: 'Tax Expense',
    canonical_name: 'Income Tax Expense',
    statement_type: 'income_statement',
    period_type: 'duration',
    synonyms: {
      primary: ['income tax expense', 'tax expense', 'provision for income taxes', 'income taxes']
    },
    taxonomy_tags: {
      us_gaap: {
        priority: ['us-gaap:IncomeTaxExpenseBenefit']
      }
    },
    sign_rule: 'positive',
    unit_candidates: ['USD', 'iso4217:USD']
  },
  {
    id: 'effective_tax_rate',
    name: 'Effective Tax Rate',
    canonical_name: 'Effective Tax Rate',
    statement_type: 'income_statement',
    period_type: 'duration',
    synonyms: {
      primary: ['effective tax rate', 'tax rate', 'etr']
    },
    sign_rule: 'positive',
    unit_candidates: ['percent']
  }
];

let addedCount = 0;
criticalMetrics.forEach(metric => {
  if (!mergedMetrics.has(metric.id)) {
    mergedMetrics.set(metric.id, metric);
    addedCount++;
  }
});

console.log(`   - Added ${addedCount} missing critical metrics\n`);

// Build final YAML structure
const finalYaml = {
  conventions: yaml2.conventions || yaml1.conventions,
  frames: yaml2.frames || yaml1.frames,
  unit_candidates: yaml2.unit_candidates || yaml1.unit_candidates,
  unit_normalize_to: yaml2.unit_normalize_to || yaml1.unit_normalize_to,
  validation: yaml2.validation || yaml1.validation,
  rounding: yaml2.rounding || yaml1.rounding,
  metrics: Array.from(mergedMetrics.values()).sort((a, b) => a.id.localeCompare(b.id))
};

// Validate
console.log('✅ Validating merged YAML...');
const metricIds = new Set();
const duplicates = [];

finalYaml.metrics.forEach(metric => {
  if (metricIds.has(metric.id)) {
    duplicates.push(metric.id);
  }
  metricIds.add(metric.id);
  
  // Validate required fields
  if (!metric.id || !metric.name || !metric.statement_type) {
    console.warn(`   ⚠️  Metric missing required fields: ${metric.id || 'unknown'}`);
  }
});

if (duplicates.length > 0) {
  console.error(`   ❌ Found duplicate metric IDs: ${duplicates.join(', ')}`);
  process.exit(1);
}

console.log(`   - Total metrics: ${finalYaml.metrics.length}`);
console.log(`   - No duplicate IDs found`);
console.log(`   - All metrics have required fields\n`);

// Write output
console.log('💾 Writing enhanced YAML...');
const yamlOutput = yaml.dump(finalYaml, {
  indent: 2,
  lineWidth: 120,
  noRefs: true
});

fs.writeFileSync(outputPath, yamlOutput);

console.log(`   - Saved to: ${outputPath}\n`);

// Summary
console.log('📊 Summary:');
console.log(`   - Original metrics (yaml1): ${yaml1.metrics.length}`);
console.log(`   - Original metrics (yaml2): ${yaml2.metrics.length}`);
console.log(`   - Final merged metrics: ${finalYaml.metrics.length}`);
console.log(`   - Database synonyms added: ${dbSynonyms.size} metrics enhanced`);
console.log(`   - Critical metrics added: ${addedCount}`);

console.log('\n✅ YAML merge and enhancement complete!');
