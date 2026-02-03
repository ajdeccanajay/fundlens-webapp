#!/usr/bin/env node

/**
 * Backfill reporting_unit column for existing financial_metrics
 * 
 * This script uses the Python ReportingUnitExtractor for accurate unit detection:
 * 1. Fetches original SEC filing content from S3
 * 2. Calls Python API to extract reporting units from filing headers
 * 3. Updates metrics with correct reporting_unit values
 * 
 * Usage:
 *   node scripts/backfill-reporting-units.js [--dry-run] [--ticker AAPL] [--use-heuristics]
 * 
 * Options:
 *   --dry-run         Show what would be updated without making changes
 *   --ticker          Process only a specific ticker
 *   --use-heuristics  Fall back to heuristic-based detection (no Python API)
 */

const { PrismaClient } = require('@prisma/client');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const prisma = new PrismaClient();

// Python parser API URL (local or ECS)
const PYTHON_API_URL = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';

// Metrics that are always in actual units (not scaled)
const UNIT_METRICS = [
  'eps_basic', 'eps_diluted', 'earnings_per_share_basic', 'earnings_per_share_diluted',
  'earnings_per_share', 'diluted_earnings_per_share', 'basic_earnings_per_share',
  'dividends_per_share', 'book_value_per_share', 'dividend_per_share',
  'shares_outstanding', 'weighted_avg_shares_basic', 'weighted_avg_shares_diluted',
  'weighted_average_shares_basic', 'weighted_average_shares_diluted',
  'common_shares_outstanding', 'diluted_shares', 'basic_shares',
  'current_ratio', 'quick_ratio', 'debt_to_equity', 'debt_to_assets',
  'gross_margin', 'operating_margin', 'net_margin', 'ebitda_margin',
  'effective_tax_rate', 'free_cash_flow_margin', 'fcf_margin',
  'cash_conversion_ratio', 'capex_to_revenue', 'capex_to_depreciation',
  'return_on_equity', 'return_on_assets', 'return_on_invested_capital',
  'roe', 'roa', 'roic', 'pe_ratio', 'price_to_earnings',
];

// Share-related metrics (may have different unit than default)
const SHARE_METRICS = [
  'shares_outstanding', 'weighted_avg_shares_basic', 'weighted_avg_shares_diluted',
  'weighted_average_shares_basic', 'weighted_average_shares_diluted',
  'common_shares_outstanding', 'diluted_shares', 'basic_shares',
  'share_count', 'number_of_shares', 'treasury_shares',
];

// Known company reporting scales (fallback when Python API unavailable)
const KNOWN_SCALES = {
  'AAPL': 'millions', 'MSFT': 'millions', 'GOOGL': 'millions', 'AMZN': 'millions',
  'META': 'millions', 'NVDA': 'millions', 'TSLA': 'millions', 'JPM': 'millions',
  'V': 'millions', 'JNJ': 'millions', 'WMT': 'millions', 'PG': 'millions',
  'MA': 'millions', 'HD': 'millions', 'CVX': 'millions', 'MRK': 'millions',
  'ABBV': 'millions', 'PFE': 'millions', 'KO': 'millions', 'PEP': 'millions',
  'COST': 'millions', 'TMO': 'millions', 'AVGO': 'millions', 'MCD': 'millions',
  'CSCO': 'millions', 'ACN': 'millions', 'ABT': 'millions', 'DHR': 'millions',
  'LIN': 'millions', 'CMCSA': 'millions', 'VZ': 'millions', 'ADBE': 'millions',
  'NKE': 'millions', 'TXN': 'millions', 'CRM': 'millions', 'NEE': 'millions',
  'PM': 'millions', 'RTX': 'millions', 'QCOM': 'millions', 'T': 'millions',
  'INTC': 'millions', 'IBM': 'millions', 'GE': 'millions', 'BA': 'millions',
  'CAT': 'millions', 'GS': 'millions', 'MS': 'millions', 'AXP': 'millions',
  'SPGI': 'millions', 'BLK': 'millions', 'SCHW': 'millions', 'C': 'millions',
  'BAC': 'millions', 'WFC': 'millions', 'DIS': 'millions', 'NFLX': 'millions',
};

/**
 * Initialize S3 client
 */
function getS3Client() {
  const isLocal = process.env.USE_LOCALSTACK === 'true' || !process.env.AWS_REGION;
  
  if (isLocal) {
    return new S3Client({
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });
  }
  
  return new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
  });
}

/**
 * Fetch filing content from S3
 */
async function fetchFilingFromS3(s3Client, ticker, accessionNumber) {
  const bucket = process.env.S3_BUCKET || 'fundlens-documents-dev';
  const key = `sec-filings/${ticker}/${accessionNumber}/filing.html`;
  
  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3Client.send(command);
    const content = await response.Body.transformToString();
    return content;
  } catch (error) {
    // Try alternative key patterns
    const altKeys = [
      `sec-filings/${ticker}/${accessionNumber}/primary_doc.htm`,
      `sec-filings/${ticker}/${accessionNumber}/index.html`,
    ];
    
    for (const altKey of altKeys) {
      try {
        const command = new GetObjectCommand({ Bucket: bucket, Key: altKey });
        const response = await s3Client.send(command);
        return await response.Body.transformToString();
      } catch {
        continue;
      }
    }
    
    return null;
  }
}

/**
 * Call Python API to extract reporting unit from filing content
 */
async function extractReportingUnitFromPython(content, ticker) {
  try {
    const response = await fetch(`${PYTHON_API_URL}/extract-reporting-unit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, ticker }),
    });
    
    if (!response.ok) {
      throw new Error(`Python API returned ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      return {
        default_unit: result.default_unit,
        share_unit: result.share_unit,
        per_share_unit: result.per_share_unit,
        source: result.source,
      };
    }
    
    return null;
  } catch (error) {
    console.warn(`  Python API error: ${error.message}`);
    return null;
  }
}

/**
 * Check if a metric should always be in actual units (not scaled)
 */
function isUnitMetric(normalizedMetric) {
  if (UNIT_METRICS.includes(normalizedMetric)) {
    return true;
  }

  // Check patterns
  if (normalizedMetric.includes('eps') || 
      normalizedMetric.includes('per_share') ||
      normalizedMetric.includes('ratio') ||
      normalizedMetric.includes('margin') ||
      normalizedMetric.includes('rate') ||
      normalizedMetric.includes('return_on')) {
    return true;
  }

  return false;
}

/**
 * Check if a metric is share-related
 */
function isShareMetric(normalizedMetric) {
  if (SHARE_METRICS.includes(normalizedMetric)) {
    return true;
  }
  
  if (normalizedMetric.includes('shares') && !normalizedMetric.includes('per_share')) {
    return true;
  }
  
  return false;
}

/**
 * Infer the reporting unit using heuristics (fallback)
 */
function inferReportingUnitHeuristic(ticker, metrics) {
  // First check if we have a known scale for this ticker
  if (KNOWN_SCALES[ticker]) {
    return { default_unit: KNOWN_SCALES[ticker], share_unit: KNOWN_SCALES[ticker], source: 'known_scale' };
  }

  // Analyze revenue values to infer scale
  const revenueMetrics = metrics.filter(m => 
    m.normalized_metric?.toLowerCase().includes('revenue') &&
    m.value !== null
  );

  if (revenueMetrics.length > 0) {
    const maxRevenue = Math.max(...revenueMetrics.map(m => Math.abs(Number(m.value))));

    if (maxRevenue >= 1e9) {
      return { default_unit: 'millions', share_unit: 'millions', source: 'magnitude_inference' };
    } else if (maxRevenue >= 1e6) {
      return { default_unit: 'thousands', share_unit: 'thousands', source: 'magnitude_inference' };
    }
  }

  // Default to millions (most common for public companies)
  return { default_unit: 'millions', share_unit: 'millions', source: 'default' };
}

/**
 * Get the appropriate unit for a metric
 */
function getUnitForMetric(normalizedMetric, unitInfo) {
  // Per-share metrics are always in actual units
  if (isUnitMetric(normalizedMetric)) {
    return 'units';
  }
  
  // Share metrics may have different unit
  if (isShareMetric(normalizedMetric)) {
    return unitInfo.share_unit || unitInfo.default_unit;
  }
  
  // Default unit for everything else
  return unitInfo.default_unit;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const useHeuristics = args.includes('--use-heuristics');
  const tickerIndex = args.indexOf('--ticker');
  const specificTicker = tickerIndex !== -1 ? args[tickerIndex + 1] : null;

  console.log('='.repeat(60));
  console.log('Reporting Units Backfill Script (Enhanced)');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  console.log(`Method: ${useHeuristics ? 'Heuristics only' : 'Python API + Heuristics fallback'}`);
  if (specificTicker) {
    console.log(`Ticker: ${specificTicker}`);
  }
  console.log('');

  const s3Client = getS3Client();
  let pythonApiAvailable = false;

  // Check Python API availability
  if (!useHeuristics) {
    try {
      const healthCheck = await fetch(`${PYTHON_API_URL}/health`);
      pythonApiAvailable = healthCheck.ok;
      console.log(`Python API: ${pythonApiAvailable ? 'Available' : 'Not available'}`);
    } catch {
      console.log('Python API: Not available (will use heuristics)');
    }
  }

  try {
    // Get all unique tickers
    let tickers;
    if (specificTicker) {
      tickers = [{ ticker: specificTicker.toUpperCase() }];
    } else {
      tickers = await prisma.$queryRaw`
        SELECT DISTINCT ticker FROM financial_metrics ORDER BY ticker
      `;
    }

    console.log(`\nFound ${tickers.length} ticker(s) to process\n`);

    let totalUpdated = 0;
    let totalSkipped = 0;
    const unitsByTicker = {};

    for (const { ticker } of tickers) {
      console.log(`\nProcessing ${ticker}...`);

      // Get metrics for this ticker that need updating
      const metrics = await prisma.$queryRaw`
        SELECT id, normalized_metric, value, fiscal_period, statement_type, accession_number
        FROM financial_metrics
        WHERE ticker = ${ticker}
          AND (reporting_unit IS NULL OR reporting_unit = 'units')
        ORDER BY fiscal_period DESC
      `;

      if (metrics.length === 0) {
        console.log(`  No metrics to update for ${ticker}`);
        continue;
      }

      console.log(`  Found ${metrics.length} metrics to analyze`);

      // Try to get reporting unit from Python API
      let unitInfo = null;
      
      if (pythonApiAvailable && !useHeuristics) {
        // Get a recent accession number to fetch filing
        const accessionNumbers = [...new Set(metrics.map(m => m.accession_number).filter(Boolean))];
        
        for (const accessionNumber of accessionNumbers.slice(0, 3)) {
          const content = await fetchFilingFromS3(s3Client, ticker, accessionNumber);
          
          if (content) {
            unitInfo = await extractReportingUnitFromPython(content, ticker);
            if (unitInfo && unitInfo.source !== 'default') {
              console.log(`  Extracted from filing: ${unitInfo.default_unit} (source: ${unitInfo.source})`);
              break;
            }
          }
        }
      }

      // Fall back to heuristics if Python API didn't work
      if (!unitInfo || unitInfo.source === 'default') {
        unitInfo = inferReportingUnitHeuristic(ticker, metrics);
        console.log(`  Inferred via heuristics: ${unitInfo.default_unit} (source: ${unitInfo.source})`);
      }

      unitsByTicker[ticker] = unitInfo;

      // Group metrics by their target unit
      const updateGroups = {};

      for (const metric of metrics) {
        const normalizedMetric = metric.normalized_metric?.toLowerCase() || '';
        const targetUnit = getUnitForMetric(normalizedMetric, unitInfo);
        
        if (!updateGroups[targetUnit]) {
          updateGroups[targetUnit] = [];
        }
        updateGroups[targetUnit].push(metric);
      }

      // Log grouping
      for (const [unit, group] of Object.entries(updateGroups)) {
        console.log(`  ${unit}: ${group.length} metrics`);
      }

      if (!dryRun) {
        // Update metrics in batches by unit
        for (const [unit, group] of Object.entries(updateGroups)) {
          const batchSize = 500;
          for (let i = 0; i < group.length; i += batchSize) {
            const batch = group.slice(i, i + batchSize);
            const ids = batch.map(m => `'${m.id}'`).join(',');
            await prisma.$executeRawUnsafe(`
              UPDATE financial_metrics
              SET reporting_unit = '${unit}'
              WHERE id IN (${ids})
            `);
          }
        }
        totalUpdated += metrics.length;
      } else {
        totalUpdated += metrics.length;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Summary');
    console.log('='.repeat(60));
    console.log(`Total metrics ${dryRun ? 'would be' : ''} updated: ${totalUpdated}`);
    console.log(`Total metrics skipped: ${totalSkipped}`);
    
    console.log('\nReporting units by ticker:');
    for (const [ticker, info] of Object.entries(unitsByTicker)) {
      console.log(`  ${ticker}: ${info.default_unit} (${info.source})`);
    }

    if (dryRun) {
      console.log('\nThis was a dry run. No changes were made.');
      console.log('Run without --dry-run to apply changes.');
    }

  } catch (error) {
    console.error('Error during backfill:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
