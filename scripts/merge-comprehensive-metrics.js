#!/usr/bin/env node
/**
 * Merge Comprehensive Metrics
 * Combines existing 59 metrics with 69 new comprehensive metrics
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const yamlPath = path.join(__dirname, '..', 'python_parser', 'xbrl_parsing', 'metric_mapping_enhanced.yaml');
const jsonPath = path.join(__dirname, '..', 'python_parser', 'xbrl_parsing', 'comprehensive_metrics_list.json');

console.log('🔄 Merging comprehensive metrics...\n');

// Load existing YAML
const existingYaml = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
const existingIds = new Set(existingYaml.metrics.map(m => m.id));

// Load new metrics from JSON
const newMetricsData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

console.log(`   Existing metrics: ${existingIds.size}`);
console.log(`   New metrics to add: ${newMetricsData.metrics.length}\n`);

let addedCount = 0;

// Add new metrics
newMetricsData.metrics.forEach(metric => {
  if (!existingIds.has(metric.id)) {
    // Convert to full YAML format
    const fullMetric = {
      id: metric.id,
      name: metric.name,
      canonical_name: metric.name,
      statement_type: metric.statement_type,
      period_type: metric.statement_type === 'balance_sheet' ? 'instant' : 'duration',
      synonyms: {
        primary: metric.synonyms
      },
      sign_rule: 'positive',
      unit_candidates: ['USD', 'iso4217:USD']
    };
    
    existingYaml.metrics.push(fullMetric);
    addedCount++;
    console.log(`  + Added: ${metric.id}`);
  }
});

// Sort by ID
existingYaml.metrics.sort((a, b) => a.id.localeCompare(b.id));

console.log(`\n✅ Added ${addedCount} new metrics`);
console.log(`📊 Total metrics: ${existingYaml.metrics.length}\n`);

// Write back
const yamlOutput = yaml.dump(existingYaml, {
  indent: 2,
  lineWidth: 120,
  noRefs: true
});

fs.writeFileSync(yamlPath, yamlOutput);
console.log(`💾 Saved to: ${yamlPath}`);
