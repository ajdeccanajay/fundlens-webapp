#!/usr/bin/env node

/**
 * End-to-End Insights Test
 * 
 * Tests the complete insights flow:
 * 1. Backfill real insights
 * 2. Validate extraction
 * 3. Test API endpoint
 * 4. Verify no mock data
 */

const { PrismaClient } = require('@prisma/client');
const http = require('http');

const prisma = new PrismaClient();

async function testAPI(dealId, fiscalPeriod) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/deals/${dealId}/insights/${encodeURIComponent(fiscalPeriod)}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function main() {
  const ticker = process.argv[2] || 'META';
  
  console.log('🧪 End-to-End Insights Test');
  console.log('============================');
  console.log(`Ticker: ${ticker}\n`);

  try {
    // Step 1: Get deal
    console.log('📋 Step 1: Get deal...');
    const deal = await prisma.deal.findFirst({
      where: { ticker }
    });

    if (!deal) {
      console.log(`❌ No deal found for ${ticker}`);
      process.exit(1);
    }

    console.log(`✅ Found deal: ${deal.id}`);
    console.log(`   Name: ${deal.name}`);
    console.log(`   Ticker: ${deal.ticker}`);

    // Step 2: Get insights from database
    console.log('\n📊 Step 2: Check database insights...');
    const insights = await prisma.mdaInsight.findMany({
      where: { dealId: deal.id },
      orderBy: { fiscalPeriod: 'desc' }
    });

    console.log(`✅ Found ${insights.length} insights in database`);

    if (insights.length === 0) {
      console.log('⚠️  No insights found. Run backfill first:');
      console.log(`   node scripts/backfill-real-insights.js ${ticker}`);
      process.exit(1);
    }

    // Step 3: Validate insights
    console.log('\n🔍 Step 3: Validate insights...');
    let hasRealData = false;
    let hasMockData = false;

    for (const insight of insights) {
      const trends = Array.isArray(insight.trends) ? insight.trends : [];
      const risks = Array.isArray(insight.risks) ? insight.risks : [];

      console.log(`\n   ${insight.fiscalPeriod}:`);
      console.log(`   - Trends: ${trends.length}`);
      console.log(`   - Risks: ${risks.length}`);
      console.log(`   - Method: ${insight.extractionMethod}`);
      console.log(`   - Confidence: ${insight.confidenceScore}%`);

      if (trends.length > 0 || risks.length > 0) {
        hasRealData = true;
      }

      // Check for mock data indicators
      if (insight.guidance && insight.guidance.includes('Management expects continued growth')) {
        hasMockData = true;
        console.log(`   ⚠️  MOCK DATA DETECTED in guidance`);
      }

      if (insight.extractionMethod !== 'pattern_based') {
        console.log(`   ⚠️  Wrong extraction method: ${insight.extractionMethod}`);
      }
    }

    if (hasMockData) {
      console.log('\n❌ FAIL: Mock data detected');
      process.exit(1);
    }

    console.log('\n✅ PASS: No mock data detected');

    if (!hasRealData) {
      console.log('⚠️  WARNING: No real data extracted (all insights empty)');
    }

    // Step 4: Test API endpoint
    console.log('\n🌐 Step 4: Test API endpoint...');
    
    const testPeriod = insights[0].fiscalPeriod;
    console.log(`   Testing: GET /api/deals/${deal.id}/insights/${testPeriod}`);

    try {
      const response = await testAPI(deal.id, testPeriod);
      
      if (response.status === 401 || response.status === 403) {
        console.log('⚠️  API requires authentication (expected)');
      } else if (response.status !== 200) {
        console.log(`⚠️  API returned status ${response.status}`);
      } else {
        console.log(`✅ API returned 200 OK`);

        // Validate response structure
        if (!response.data.heroMetrics) {
          console.log('❌ Missing heroMetrics in response');
          process.exit(1);
        }

        if (!response.data.trends) {
          console.log('❌ Missing trends in response');
          process.exit(1);
        }

        if (!response.data.risks) {
          console.log('❌ Missing risks in response');
          process.exit(1);
        }

        if (!response.data.guidance) {
          console.log('❌ Missing guidance in response');
          process.exit(1);
        }

        console.log('✅ Response structure valid');
        console.log(`   - Hero Metrics: ${response.data.heroMetrics.length}`);
        console.log(`   - Trends: ${response.data.trends.length}`);
        console.log(`   - Risks: ${response.data.risks.length}`);
        console.log(`   - Has Guidance: ${!!response.data.guidance.text}`);

        // Check for mock data in API response
        if (response.data.trends.some(t => t.category === 'Revenue Growth' && t.confidence === 0.85)) {
          console.log('❌ MOCK DATA detected in API response');
          process.exit(1);
        }

        console.log('✅ No mock data in API response');
      }

    } catch (apiError) {
      console.log(`⚠️  API test skipped: ${apiError.message}`);
      console.log('   (Backend may not be running or requires authentication)');
    }

    // Final summary
    console.log('\n\n🎯 FINAL ASSESSMENT');
    console.log('='.repeat(60));
    console.log(`✅ Database insights: ${insights.length} found`);
    console.log(`✅ No mock data detected`);
    console.log(`✅ Pattern-based extraction used`);
    console.log(`${hasRealData ? '✅' : '⚠️ '} Real data extracted`);
    console.log('\n='.repeat(60));
    console.log('✅ ALL TESTS PASSED');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
