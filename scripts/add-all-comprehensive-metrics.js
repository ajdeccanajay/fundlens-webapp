#!/usr/bin/env node

/**
 * Add All Comprehensive Metrics
 * 
 * Adds all 117+ metrics from requirements including:
 * - All industry-specific metrics (Banking, Insurance, Telecom, etc.)
 * - All ratio and calculated metrics
 * - All per-share metrics
 * - All segment and geographic metrics
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const yamlPath = path.join(__dirname, '..', 'python_parser', 'xbrl_parsing', 'metric_mapping_enhanced.yaml');

console.log('📊 Adding all comprehensive metrics...\n');

// Load existing YAML
const existingYaml = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
const existingIds = new Set(existingYaml.metrics.map(m => m.id));

console.log(`   Current metrics: ${existingIds.size}\n`);

// Define all comprehensive metrics (117+ total)
const comprehensiveMetrics = [
  // ============ INCOME STATEMENT - Additional Metrics ============
  {
    id: 'other_income_expense',
    name: 'Other Income/Expense',
    canonical_name: 'Other Income (Expense)',
    statement_type: 'income_statement',
    period_type: 'duration',
    synonyms: {
      primary: ['other income', 'other expense', 'other income expense', 'non-operating income']
    },
    taxonomy_tags: {
      us_gaap: { priority: ['us-gaap:OtherNonoperatingIncomeExpense'] }
    },
    sign_rule: 'signed',
    unit_candidates: ['USD', 'iso4217:USD']
  },
