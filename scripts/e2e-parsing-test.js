#!/usr/bin/env node
/**
 * End-to-End Parsing Test Script
 * 
 * Tests the complete financial statement parsing flow on localhost:
 * 1. Database migration check
 * 2. SEC filing ingestion
 * 3. Metrics extraction with reporting units
 * 4. Data validation
 * 5. HITL review queue population
 * 6. Excel export generation
 * 
 * Usage: node scripts/e2e-parsing-test.js [ticker]
 * Example: node scripts/e2e-parsing-test.js AAPL
 */

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;
const path = require('path');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const PYTHON_PARSER_URL = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';
const TEST_TICKER = process.argv[2] || 'AAPL';

const prisma = new PrismaClient();

class E2EParsingTest {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      ticker: TEST_TICKER,
      steps: {},
      errors: [],
      warnings: [],
    };
  }

  log(message, type = 'info') {
    const prefix = {
      info: '📋',
      success: '✅',
      error: '❌',
      warning: '⚠️',
      step: '🔹',
    }[type] || '•';
    console.log(`${prefix} ${message}`);
  }

  async run() {
    console.log('═'.repeat(60));
    console.log('🚀 E2E Financial Statement Parsing Test');
    console.log(`   Ticker: ${TEST_TICKER}`);
    console.log(`   API: ${API_BASE}`);
    console.log(`   Python Parser: ${PYTHON_PARSER_URL}`);
    console.log('═'.repeat(60));

    try {
      // Pre-flight checks
      await this.step0_preflight();
      
      // Step 1: Check database schema
      await this.step1_checkDatabase();
      
      // Step 2: Check services health
      await this.step2_checkServices();
      
      // Step 3: Ingest SEC filing
      await this.step3_ingestFiling();
      
      // Step 4: Verify metrics extraction
      await this.step4_verifyMetrics();
      
      // Step 5: Verify reporting units
      await this.step5_verifyReportingUnits();
      
      // Step 6: Run data validation
      await this.step6_runValidation();
      
      // Step 7: Check HITL queues
      await this.step7_checkHITLQueues();
      
      // Step 8: Test Excel export
      await this.step8_testExcelExport();
      
      // Step 9: Generate report
      await this.step9_generateReport();

      console.log('\n' + '═'.repeat(60));
      this.log('E2E Parsing Test Complete!', 'success');
      console.log('═'.repeat(60));

    } catch (error) {
      this.log(`Test failed: ${error.message}`, 'error');
      this.results.errors.push({ step: 'main', error: error.message });
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }

  async step0_preflight() {
    console.log('\n📋 Pre-flight Checks');
    console.log('-'.repeat(40));

    // Check if ticker is valid
    if (!TEST_TICKER || TEST_TICKER.length < 1 || TEST_TICKER.length > 5) {
      throw new Error(`Invalid ticker: ${TEST_TICKER}`);
    }
    this.log(`Ticker ${TEST_TICKER} is valid`, 'success');
  }

  async step1_checkDatabase() {
    console.log('\n📋 Step 1: Database Schema Check');
    console.log('-'.repeat(40));

    const requiredTables = [
      'financial_metrics',
      'narrative_chunks',
      'filing_metadata',
      'unmapped_xbrl_tags',
      'xbrl_tag_mappings',
      'validation_failures',
      'reprocessing_queue',
      'audit_log',
    ];

    const missingTables = [];
    
    for (const table of requiredTables) {
      try {
        await prisma.$queryRawUnsafe(`SELECT 1 FROM ${table} LIMIT 1`);
        this.log(`Table ${table} exists`, 'step');
      } catch (error) {
        missingTables.push(table);
        this.log(`Table ${table} MISSING`, 'error');
      }
    }

    if (missingTables.length > 0) {
      this.results.errors.push({
        step: 'database',
        error: `Missing tables: ${missingTables.join(', ')}`,
        fix: 'Run: npx prisma db push OR apply migrations manually',
      });
      throw new Error(`Missing database tables: ${missingTables.join(', ')}`);
    }

    // Check reporting_unit column
    try {
      const result = await prisma.$queryRaw`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'financial_metrics' AND column_name = 'reporting_unit'
      `;
      if (result.length === 0) {
        throw new Error('reporting_unit column missing');
      }
      this.log('reporting_unit column exists', 'step');
    } catch (error) {
      this.results.errors.push({
        step: 'database',
        error: 'reporting_unit column missing from financial_metrics',
        fix: 'Run: node scripts/apply-reporting-unit-migration.js',
      });
    }

    this.results.steps.database = { status: 'passed', tables: requiredTables };
    this.log('Database schema verified', 'success');
  }

  async step2_checkServices() {
    console.log('\n📋 Step 2: Service Health Check');
    console.log('-'.repeat(40));

    // Check NestJS backend
    try {
      const response = await axios.get(`${API_BASE}/api/health`, { timeout: 5000 });
      this.log(`NestJS backend: ${response.data.status || 'OK'}`, 'step');
    } catch (error) {
      this.results.errors.push({
        step: 'services',
        error: 'NestJS backend not responding',
        fix: 'Run: npm run start:dev',
      });
      throw new Error('NestJS backend not responding. Run: npm run start:dev');
    }

    // Check Python parser
    try {
      const response = await axios.get(`${PYTHON_PARSER_URL}/health`, { timeout: 5000 });
      this.log(`Python parser: ${response.data.status || 'OK'}`, 'step');
    } catch (error) {
      this.results.warnings.push({
        step: 'services',
        warning: 'Python parser not responding',
        fix: 'Run: cd python_parser && python api_server.py',
      });
      this.log('Python parser not responding (will use fallback)', 'warning');
    }

    this.results.steps.services = { status: 'passed' };
    this.log('Services health check complete', 'success');
  }

  async step3_ingestFiling() {
    console.log('\n📋 Step 3: SEC Filing Ingestion');
    console.log('-'.repeat(40));

    try {
      // Check if we already have data for this ticker
      const existingMetrics = await prisma.financialMetric.count({
        where: { ticker: TEST_TICKER },
      });

      if (existingMetrics > 0) {
        this.log(`Found ${existingMetrics} existing metrics for ${TEST_TICKER}`, 'step');
        this.results.steps.ingestion = { 
          status: 'skipped', 
          reason: 'Data already exists',
          existingMetrics,
        };
        return;
      }

      // Trigger sync and process
      this.log(`Syncing ${TEST_TICKER} filings...`, 'step');
      const response = await axios.post(
        `${API_BASE}/api/simple/sync/${TEST_TICKER}`,
        { years: 1 },
        { timeout: 300000 }
      );

      this.log(`Sync result: ${JSON.stringify(response.data)}`, 'step');
      this.results.steps.ingestion = { status: 'passed', result: response.data };

    } catch (error) {
      this.results.errors.push({
        step: 'ingestion',
        error: error.message,
        response: error.response?.data,
      });
      this.log(`Ingestion failed: ${error.message}`, 'error');
      // Don't throw - continue with existing data if available
    }

    this.log('Filing ingestion complete', 'success');
  }

  async step4_verifyMetrics() {
    console.log('\n📋 Step 4: Verify Metrics Extraction');
    console.log('-'.repeat(40));

    // Count metrics by statement type
    const metricsByType = await prisma.financialMetric.groupBy({
      by: ['statementType'],
      where: { ticker: TEST_TICKER },
      _count: true,
    });

    if (metricsByType.length === 0) {
      this.results.errors.push({
        step: 'metrics',
        error: `No metrics found for ${TEST_TICKER}`,
        fix: 'Run ingestion first or check SEC API connectivity',
      });
      throw new Error(`No metrics found for ${TEST_TICKER}`);
    }

    const summary = {};
    for (const item of metricsByType) {
      summary[item.statementType] = item._count;
      this.log(`${item.statementType}: ${item._count} metrics`, 'step');
    }

    // Check for key metrics
    const keyMetrics = [
      'total_revenue',
      'net_income',
      'total_assets',
      'total_liabilities',
      'operating_cash_flow',
    ];

    const foundKeyMetrics = await prisma.financialMetric.findMany({
      where: {
        ticker: TEST_TICKER,
        normalizedMetric: { in: keyMetrics },
      },
      select: { normalizedMetric: true },
      distinct: ['normalizedMetric'],
    });

    const foundNames = foundKeyMetrics.map(m => m.normalizedMetric);
    const missingKeyMetrics = keyMetrics.filter(k => !foundNames.includes(k));

    if (missingKeyMetrics.length > 0) {
      this.results.warnings.push({
        step: 'metrics',
        warning: `Missing key metrics: ${missingKeyMetrics.join(', ')}`,
      });
      this.log(`Missing key metrics: ${missingKeyMetrics.join(', ')}`, 'warning');
    }

    this.results.steps.metrics = {
      status: 'passed',
      summary,
      keyMetricsFound: foundNames,
      keyMetricsMissing: missingKeyMetrics,
    };

    this.log('Metrics verification complete', 'success');
  }

  async step5_verifyReportingUnits() {
    console.log('\n📋 Step 5: Verify Reporting Units');
    console.log('-'.repeat(40));

    // Check reporting unit distribution
    const unitDistribution = await prisma.financialMetric.groupBy({
      by: ['reportingUnit'],
      where: { ticker: TEST_TICKER },
      _count: true,
    });

    const summary = {};
    for (const item of unitDistribution) {
      summary[item.reportingUnit || 'null'] = item._count;
      this.log(`${item.reportingUnit || 'null'}: ${item._count} metrics`, 'step');
    }

    // Check if all metrics have default 'units' (might indicate backfill needed)
    const totalMetrics = Object.values(summary).reduce((a, b) => a + b, 0);
    const unitsCount = summary['units'] || 0;
    
    if (unitsCount === totalMetrics && totalMetrics > 0) {
      this.results.warnings.push({
        step: 'reportingUnits',
        warning: 'All metrics have default "units" - backfill may be needed',
        fix: 'Run: node scripts/backfill-reporting-units.js',
      });
      this.log('All metrics have default "units" - backfill may be needed', 'warning');
    }

    this.results.steps.reportingUnits = {
      status: 'passed',
      distribution: summary,
    };

    this.log('Reporting units verification complete', 'success');
  }

  async step6_runValidation() {
    console.log('\n📋 Step 6: Data Validation');
    console.log('-'.repeat(40));

    // Get latest fiscal period
    const latestMetric = await prisma.financialMetric.findFirst({
      where: { ticker: TEST_TICKER },
      orderBy: { fiscalPeriod: 'desc' },
      select: { fiscalPeriod: true },
    });

    if (!latestMetric) {
      this.log('No metrics to validate', 'warning');
      this.results.steps.validation = { status: 'skipped', reason: 'No metrics' };
      return;
    }

    const fiscalPeriod = latestMetric.fiscalPeriod;
    this.log(`Validating ${fiscalPeriod}...`, 'step');

    // Run basic validation checks
    const validationResults = [];

    // Check 1: Total Assets = Current Assets + Non-Current Assets
    const assetMetrics = await prisma.financialMetric.findMany({
      where: {
        ticker: TEST_TICKER,
        fiscalPeriod,
        normalizedMetric: {
          in: ['total_assets', 'total_current_assets', 'total_non_current_assets'],
        },
      },
    });

    if (assetMetrics.length === 3) {
      const total = assetMetrics.find(m => m.normalizedMetric === 'total_assets');
      const current = assetMetrics.find(m => m.normalizedMetric === 'total_current_assets');
      const nonCurrent = assetMetrics.find(m => m.normalizedMetric === 'total_non_current_assets');

      if (total && current && nonCurrent) {
        const expected = Number(current.value) + Number(nonCurrent.value);
        const actual = Number(total.value);
        const diff = Math.abs(expected - actual);
        const diffPct = (diff / actual) * 100;

        validationResults.push({
          check: 'Total Assets = Current + Non-Current',
          expected,
          actual,
          diffPct: diffPct.toFixed(2),
          passed: diffPct < 1, // Allow 1% tolerance
        });

        if (diffPct >= 1) {
          this.log(`Asset validation failed: ${diffPct.toFixed(2)}% difference`, 'warning');
        }
      }
    }

    // Log validation results
    for (const result of validationResults) {
      const status = result.passed ? 'step' : 'warning';
      this.log(`${result.check}: ${result.passed ? 'PASS' : 'FAIL'} (${result.diffPct}% diff)`, status);
    }

    this.results.steps.validation = {
      status: 'passed',
      fiscalPeriod,
      checks: validationResults,
    };

    this.log('Data validation complete', 'success');
  }

  async step7_checkHITLQueues() {
    console.log('\n📋 Step 7: HITL Review Queues');
    console.log('-'.repeat(40));

    try {
      // Check unmapped tags queue
      const unmappedTags = await prisma.unmappedXbrlTag.count({
        where: { status: 'pending' },
      });
      this.log(`Unmapped tags pending: ${unmappedTags}`, 'step');

      // Check validation failures queue
      const validationFailures = await prisma.validationFailure.count({
        where: { status: 'pending' },
      });
      this.log(`Validation failures pending: ${validationFailures}`, 'step');

      // Check reprocessing queue
      const reprocessingPending = await prisma.reprocessingQueue.count({
        where: { status: 'pending' },
      });
      this.log(`Reprocessing queue pending: ${reprocessingPending}`, 'step');

      // Test HITL API endpoints
      try {
        const statsResponse = await axios.get(
          `${API_BASE}/api/v1/internal/ops/parsing/stats`,
          {
            headers: { 'x-platform-admin-key': process.env.PLATFORM_ADMIN_KEY },
            timeout: 10000,
          }
        );
        this.log(`HITL API stats: ${JSON.stringify(statsResponse.data)}`, 'step');
      } catch (apiError) {
        this.results.warnings.push({
          step: 'hitl',
          warning: `HITL API not accessible: ${apiError.message}`,
        });
        this.log(`HITL API not accessible: ${apiError.message}`, 'warning');
      }

      this.results.steps.hitl = {
        status: 'passed',
        unmappedTags,
        validationFailures,
        reprocessingPending,
      };

    } catch (error) {
      this.results.warnings.push({
        step: 'hitl',
        warning: `HITL queue check failed: ${error.message}`,
      });
      this.log(`HITL queue check failed: ${error.message}`, 'warning');
      this.results.steps.hitl = { status: 'warning', error: error.message };
    }

    this.log('HITL queue check complete', 'success');
  }

  async step8_testExcelExport() {
    console.log('\n📋 Step 8: Excel Export Test');
    console.log('-'.repeat(40));

    try {
      // Test export endpoint
      const response = await axios.get(
        `${API_BASE}/api/deals/export/financial-statements/${TEST_TICKER}`,
        {
          responseType: 'arraybuffer',
          timeout: 60000,
        }
      );

      const contentType = response.headers['content-type'];
      const contentLength = response.headers['content-length'];

      this.log(`Export content-type: ${contentType}`, 'step');
      this.log(`Export size: ${contentLength} bytes`, 'step');

      // Save the file for manual inspection
      const outputPath = path.join(__dirname, '..', `test-export-${TEST_TICKER}.xlsx`);
      await fs.writeFile(outputPath, response.data);
      this.log(`Export saved to: ${outputPath}`, 'step');

      this.results.steps.export = {
        status: 'passed',
        contentType,
        size: contentLength,
        outputPath,
      };

    } catch (error) {
      this.results.errors.push({
        step: 'export',
        error: error.message,
        response: error.response?.status,
      });
      this.log(`Export failed: ${error.message}`, 'error');
      this.results.steps.export = { status: 'failed', error: error.message };
    }

    this.log('Excel export test complete', 'success');
  }

  async step9_generateReport() {
    console.log('\n📋 Step 9: Generate Report');
    console.log('-'.repeat(40));

    // Calculate summary
    const passedSteps = Object.values(this.results.steps).filter(s => s.status === 'passed').length;
    const totalSteps = Object.keys(this.results.steps).length;
    const errorCount = this.results.errors.length;
    const warningCount = this.results.warnings.length;

    this.results.summary = {
      passedSteps,
      totalSteps,
      errorCount,
      warningCount,
      overallStatus: errorCount === 0 ? 'PASSED' : 'FAILED',
    };

    // Save report
    const reportPath = path.join(__dirname, '..', `e2e-parsing-report-${TEST_TICKER}.json`);
    await fs.writeFile(reportPath, JSON.stringify(this.results, null, 2));

    console.log('\n' + '═'.repeat(60));
    console.log('📊 Test Summary');
    console.log('═'.repeat(60));
    console.log(`  Ticker: ${TEST_TICKER}`);
    console.log(`  Steps Passed: ${passedSteps}/${totalSteps}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Warnings: ${warningCount}`);
    console.log(`  Overall: ${this.results.summary.overallStatus}`);
    console.log(`  Report: ${reportPath}`);

    if (this.results.errors.length > 0) {
      console.log('\n❌ Errors:');
      for (const error of this.results.errors) {
        console.log(`  - [${error.step}] ${error.error}`);
        if (error.fix) console.log(`    Fix: ${error.fix}`);
      }
    }

    if (this.results.warnings.length > 0) {
      console.log('\n⚠️ Warnings:');
      for (const warning of this.results.warnings) {
        console.log(`  - [${warning.step}] ${warning.warning}`);
        if (warning.fix) console.log(`    Fix: ${warning.fix}`);
      }
    }
  }
}

// Run the test
async function main() {
  const test = new E2EParsingTest();
  await test.run();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = { E2EParsingTest };
