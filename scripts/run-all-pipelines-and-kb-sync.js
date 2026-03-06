#!/usr/bin/env node
/**
 * Run pipelines for all 10 tickers on production ECS, then trigger clean-slate KB sync.
 * 
 * Sequence:
 * 1. Run comprehensive SEC pipeline for each ticker (with skipExisting=false to re-fetch under-fetched filings)
 * 2. Wait for all pipelines to complete
 * 3. Run clean-slate KB sync (section-based export to S3 + Bedrock ingestion)
 */

const { CognitoIdentityProviderClient, InitiateAuthCommand } = require('@aws-sdk/client-cognito-identity-provider');
const crypto = require('crypto');

const ECS_BASE_URL = process.env.ECS_BASE_URL || 'https://fundlens-production-service.fundlens.ai';
// Fallback: use the ALB/NLB URL or direct task IP
const PROD_URL = process.env.PROD_URL || 'http://fundlens-produ-publi-xxx.us-east-1.elb.amazonaws.com';

// Cognito config
const COGNITO_POOL_ID = 'us-east-1_4OYqnpE18';
const COGNITO_CLIENT_ID = '4s4k1usimlqkr6sk55gbva183s';
const COGNITO_CLIENT_SECRET = 'f52bpc2kg5j6dqua46d14o9bj5o796bakn4mnguiu9b1qusn8nh';
const COGNITO_USERNAME = 'ajay.swamy@fundlens.ai';
const COGNITO_PASSWORD = 'FundLens2024!';

const PLATFORM_ADMIN_KEY = 'c449b7edf787723bfbc6c6a85373465081b91ed00de6515c6bfe6fbaeb4a1e06';

const TICKERS = ['AAPL', 'ABNB', 'AMGN', 'AMZN', 'ETSY', 'GOOGL', 'MSFT', 'NVDA', 'SHOP', 'TSLA'];

const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];
const FILING_TYPES = ['10-K', '10-Q', '8-K', 'DEF 14A', '4', 'S-1', '40-F', '6-K', 'F-1'];

async function getIdToken() {
  const client = new CognitoIdentityProviderClient({ region: 'us-east-1' });
  
  const secretHash = crypto
    .createHmac('sha256', COGNITO_CLIENT_SECRET)
    .update(COGNITO_USERNAME + COGNITO_CLIENT_ID)
    .digest('base64');

  const command = new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: {
      USERNAME: COGNITO_USERNAME,
      PASSWORD: COGNITO_PASSWORD,
      SECRET_HASH: secretHash,
    },
  });

  const response = await client.send(command);
  return response.AuthenticationResult.IdToken;
}

async function getBaseUrl() {
  // Try to find the ECS task's public IP or ALB endpoint
  // For now, we'll call the API directly via the platform admin key
  // The comprehensive-sec-pipeline endpoints don't require auth (they're internal)
  
  // Try the ECS service URL first
  const urls = [
    process.env.FUNDLENS_URL,
    'http://localhost:3000', // If running locally
  ].filter(Boolean);

  for (const url of urls) {
    try {
      const resp = await fetch(`${url}/comprehensive-sec-pipeline/status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        console.log(`✅ Connected to: ${url}`);
        return url;
      }
    } catch {
      // Try next
    }
  }

  throw new Error('Cannot connect to FundLens backend. Set FUNDLENS_URL env var.');
}

async function runPipeline(baseUrl, ticker, idToken) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔄 Starting pipeline for ${ticker}...`);
  console.log(`${'═'.repeat(60)}`);

  const startTime = Date.now();

  try {
    const response = await fetch(`${baseUrl}/comprehensive-sec-pipeline/execute-company/${ticker}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
        'x-platform-admin-key': PLATFORM_ADMIN_KEY,
      },
      body: JSON.stringify({
        years: YEARS,
        filingTypes: FILING_TYPES,
        skipExisting: false, // Re-fetch everything to pick up under-fetched filings
        syncToKnowledgeBase: false, // We'll do KB sync separately after all pipelines
      }),
      signal: AbortSignal.timeout(600000), // 10 minute timeout per ticker
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ ${ticker}: HTTP ${response.status} - ${text.substring(0, 200)}`);
      return { ticker, success: false, error: `HTTP ${response.status}` };
    }

    const result = await response.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (result.success) {
      console.log(`✅ ${ticker}: ${result.result.processedFilings} filings processed, ` +
        `${result.result.totalMetrics} metrics, ${result.result.totalNarratives} narratives (${elapsed}s)`);
    } else {
      console.log(`⚠️  ${ticker}: ${result.message} (${elapsed}s)`);
      if (result.result?.errors?.length > 0) {
        console.log(`   Errors: ${result.result.errors.slice(0, 3).join('; ')}`);
      }
    }

    return { ticker, success: result.success, result: result.result, elapsed };
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`❌ ${ticker}: ${error.message} (${elapsed}s)`);
    return { ticker, success: false, error: error.message, elapsed };
  }
}

async function main() {
  console.log('🚀 FundLens Pipeline Runner — All 10 Tickers + KB Sync');
  console.log(`   Tickers: ${TICKERS.join(', ')}`);
  console.log(`   Years: ${YEARS.join(', ')}`);
  console.log(`   Filing Types: ${FILING_TYPES.join(', ')}`);
  console.log(`   skipExisting: false (re-fetch under-fetched filings)`);
  console.log('');

  // Get auth token
  console.log('🔑 Authenticating...');
  let idToken;
  try {
    idToken = await getIdToken();
    console.log('✅ Got IdToken');
  } catch (error) {
    console.error(`❌ Auth failed: ${error.message}`);
    console.log('Continuing without auth (pipeline endpoints may not require it)');
    idToken = null;
  }

  // Find backend URL
  let baseUrl;
  try {
    baseUrl = await getBaseUrl();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  // Run pipelines sequentially
  const results = [];
  const overallStart = Date.now();

  for (const ticker of TICKERS) {
    const result = await runPipeline(baseUrl, ticker, idToken);
    results.push(result);

    // Rate limit between tickers (SEC EDGAR rate limit)
    if (TICKERS.indexOf(ticker) < TICKERS.length - 1) {
      console.log('⏳ Waiting 5s between tickers (SEC rate limit)...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Summary
  const overallElapsed = ((Date.now() - overallStart) / 60000).toFixed(1);
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 PIPELINE SUMMARY');
  console.log(`${'═'.repeat(60)}`);
  
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`Total: ${results.length} tickers in ${overallElapsed} minutes`);
  console.log(`Succeeded: ${succeeded.length}`);
  console.log(`Failed: ${failed.length}`);
  
  if (failed.length > 0) {
    console.log(`\nFailed tickers:`);
    for (const f of failed) {
      console.log(`  ❌ ${f.ticker}: ${f.error}`);
    }
  }

  let totalFilings = 0, totalMetrics = 0, totalNarratives = 0;
  for (const r of succeeded) {
    if (r.result) {
      totalFilings += r.result.processedFilings || 0;
      totalMetrics += r.result.totalMetrics || 0;
      totalNarratives += r.result.totalNarratives || 0;
    }
  }
  console.log(`\nTotals: ${totalFilings} filings, ${totalMetrics} metrics, ${totalNarratives} narratives`);

  // Step 2: Run clean-slate KB sync
  if (succeeded.length > 0) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log('🔄 STEP 2: Clean-Slate KB Sync (Section-Based)');
    console.log(`${'═'.repeat(60)}`);
    console.log('Running clean-slate-kb-sync.js...\n');
    
    // We'll exec the clean-slate KB sync script
    const { execSync } = require('child_process');
    try {
      execSync('node scripts/clean-slate-kb-sync.js', { 
        stdio: 'inherit',
        timeout: 600000, // 10 minutes
      });
      console.log('\n✅ KB sync complete!');
    } catch (error) {
      console.error(`\n❌ KB sync failed: ${error.message}`);
      console.log('You can re-run manually: node scripts/clean-slate-kb-sync.js');
    }
  }

  console.log('\n🏁 Done!');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
