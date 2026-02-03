#!/usr/bin/env node

/**
 * Verification Script: Enhanced YAML Metrics
 * 
 * Verifies the enhanced YAML file has correct structure and counts
 */

const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

const yamlPath = path.join(__dirname, '../python_parser/xbrl_parsing/metric_mapping_enhanced.yaml');
const enhancedYaml = yaml.load(fs.readFileSync(yamlPath, 'utf8'));

console.log('='.repeat(80));
console.log('ENHANCED YAML VERIFICATION REPORT');
console.log('='.repeat(80));
console.log();

// Total metrics
console.log(`📊 Total Metrics: ${enhancedYaml.metrics.length}`);
console.log();

// By statement type
const byStatementType = {};
enhancedYaml.metrics.forEach(m => {
  const type = m.statement_type || 'calculated';
  byStatementType[type] = (byStatementType[type] || 0) + 1;
});

console.log('📈 By Statement Type:');
Object.entries(byStatementType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
  console.log(`   ${type.padEnd(20)} ${count}`);
});
console.log();

// Metrics with synonyms
const withSynonyms = enhancedYaml.metrics.filter(m => {
  if (Array.isArray(m.synonyms)) return m.synonyms.length > 0;
  if (m.synonyms?.primary) return m.synonyms.primary.length > 0;
  return false;
}).length;

console.log(`🔤 Metrics with Synonyms: ${withSynonyms} (${Math.round(withSynonyms / enhancedYaml.metrics.length * 100)}%)`);
console.log();

// Metrics with taxonomy tags
const withTaxonomy = enhancedYaml.metrics.filter(m => m.taxonomy_tags).length;
console.log(`🏷️  Metrics with Taxonomy Tags: ${withTaxonomy} (${Math.round(withTaxonomy / enhancedYaml.metrics.length * 100)}%)`);
console.log();

// Metrics with company-specific tags
const withCompanyTags = enhancedYaml.metrics.filter(m => m.taxonomy_tags?.company_specific).length;
console.log(`🏢 Metrics with Company-Specific Tags: ${withCompanyTags}`);
console.log();

// Metrics with industry-specific synonyms
const withIndustrySynonyms = enhancedYaml.metrics.filter(m => m.synonyms?.industry_specific).length;
console.log(`🏭 Metrics with Industry-Specific Synonyms: ${withIndustrySynonyms}`);
console.log();

// Check for duplicates
const ids = enhancedYaml.metrics.map(m => m.id);
const uniqueIds = new Set(ids);
const hasDuplicates = ids.length !== uniqueIds.size;

console.log(`✅ No Duplicate IDs: ${!hasDuplicates ? 'PASS' : 'FAIL'}`);
console.log();

// Check for required fields
const missingFields = enhancedYaml.metrics.filter(m => {
  if (!['effective_tax_rate', 'arpu', 'combined_ratio', 'net_interest_margin'].includes(m.id)) {
    return !m.statement_type;
  }
  return false;
});

console.log(`✅ All Required Fields Present: ${missingFields.length === 0 ? 'PASS' : 'FAIL'}`);
if (missingFields.length > 0) {
  console.log(`   Missing statement_type: ${missingFields.map(m => m.id).join(', ')}`);
}
console.log();

// Sample metrics
console.log('📋 Sample Metrics:');
const samples = ['revenue', 'cost_of_revenue', 'net_income', 'cash', 'fcf', 'ebitda'];
samples.forEach(id => {
  const metric = enhancedYaml.metrics.find(m => m.id === id);
  if (metric) {
    const synonymCount = Array.isArray(metric.synonyms) 
      ? metric.synonyms.length 
      : (metric.synonyms?.primary?.length || 0);
    console.log(`   ${id.padEnd(20)} ${synonymCount} synonyms`);
  }
});
console.log();

console.log('='.repeat(80));
console.log('✅ VERIFICATION COMPLETE');
console.log('='.repeat(80));
