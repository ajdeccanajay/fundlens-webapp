#!/usr/bin/env node

/**
 * Research Assistant Diagnostic Script
 * 
 * Checks all components needed for Research Assistant to work:
 * - Database connection
 * - AAPL data availability
 * - API endpoints
 * - Authentication
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function diagnose() {
  console.log('🔍 Research Assistant Diagnostic Tool\n');
  console.log('=' .repeat(60));
  
  let allGood = true;

  // 1. Check Database Connection
  console.log('\n1️⃣  Checking Database Connection...');
  try {
    await prisma.$connect();
    console.log('   ✅ Database connected');
  } catch (error) {
    console.log('   ❌ Database connection failed:', error.message);
    allGood = false;
  }

  // 2. Check AAPL Data
  console.log('\n2️⃣  Checking AAPL Data Availability...');
  try {
    const narrativeCount = await prisma.narrativeChunk.count({
      where: { ticker: 'AAPL' }
    });
    
    const financialCount = await prisma.financialMetric.count({
      where: { ticker: 'AAPL' }
    });
    
    if (narrativeCount > 0) {
      console.log(`   ✅ Narrative chunks: ${narrativeCount}`);
    } else {
      console.log('   ⚠️  No narrative chunks found for AAPL');
      console.log('      Run: node scripts/end-to-end-pipeline.js AAPL');
      allGood = false;
    }
    
    if (financialCount > 0) {
      console.log(`   ✅ Financial metrics: ${financialCount}`);
    } else {
      console.log('   ⚠️  No financial metrics found for AAPL');
      allGood = false;
    }
    
    // Check latest filing
    const latestChunk = await prisma.narrativeChunk.findFirst({
      where: { ticker: 'AAPL' },
      orderBy: { filingDate: 'desc' },
      select: { filingDate: true, section: true }
    });
    
    if (latestChunk) {
      console.log(`   ℹ️  Latest filing: ${latestChunk.filingDate?.toISOString().split('T')[0] || 'Unknown'}`);
      console.log(`   ℹ️  Sample section: ${latestChunk.section}`);
    }
    
  } catch (error) {
    console.log('   ❌ Error checking AAPL data:', error.message);
    allGood = false;
  }

  // 3. Check Research Tables
  console.log('\n3️⃣  Checking Research Assistant Tables...');
  try {
    const conversationCount = await prisma.conversation.count();
    const notebookCount = await prisma.notebook.count();
    
    console.log(`   ✅ Conversations table exists (${conversationCount} records)`);
    console.log(`   ✅ Notebooks table exists (${notebookCount} records)`);
  } catch (error) {
    console.log('   ❌ Research tables missing or error:', error.message);
    console.log('      Run: npm run prisma:migrate');
    allGood = false;
  }

  // 4. Check Tenant Setup
  console.log('\n4️⃣  Checking Tenant Setup...');
  try {
    const tenantCount = await prisma.tenant.count();
    const userCount = await prisma.user.count();
    
    if (tenantCount > 0) {
      console.log(`   ✅ Tenants: ${tenantCount}`);
    } else {
      console.log('   ⚠️  No tenants found');
      console.log('      Create tenant via signup or admin panel');
      allGood = false;
    }
    
    if (userCount > 0) {
      console.log(`   ✅ Users: ${userCount}`);
    } else {
      console.log('   ⚠️  No users found');
      console.log('      Create user via signup');
      allGood = false;
    }
  } catch (error) {
    console.log('   ❌ Error checking tenants:', error.message);
    allGood = false;
  }

  // 5. Check Environment Variables
  console.log('\n5️⃣  Checking Environment Variables...');
  const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'AWS_REGION',
    'BEDROCK_KB_ID'
  ];
  
  for (const envVar of requiredEnvVars) {
    if (process.env[envVar]) {
      console.log(`   ✅ ${envVar} is set`);
    } else {
      console.log(`   ⚠️  ${envVar} is not set`);
      if (envVar === 'BEDROCK_KB_ID') {
        console.log('      (Optional for local development)');
      } else {
        allGood = false;
      }
    }
  }

  // 6. Sample Queries
  console.log('\n6️⃣  Sample Data for AAPL...');
  try {
    const sampleChunks = await prisma.narrativeChunk.findMany({
      where: { ticker: 'AAPL' },
      take: 3,
      select: {
        section: true,
        content: true,
        filingDate: true
      }
    });
    
    if (sampleChunks.length > 0) {
      console.log('   ✅ Sample narrative chunks:');
      sampleChunks.forEach((chunk, i) => {
        console.log(`      ${i + 1}. ${chunk.section} (${chunk.filingDate?.toISOString().split('T')[0] || 'Unknown'})`);
        console.log(`         "${chunk.content.substring(0, 80)}..."`);
      });
    }
    
    const sampleMetrics = await prisma.financialMetric.findMany({
      where: { ticker: 'AAPL' },
      take: 3,
      select: {
        metricName: true,
        value: true,
        period: true
      }
    });
    
    if (sampleMetrics.length > 0) {
      console.log('   ✅ Sample financial metrics:');
      sampleMetrics.forEach((metric, i) => {
        console.log(`      ${i + 1}. ${metric.metricName}: ${metric.value} (${metric.period})`);
      });
    }
  } catch (error) {
    console.log('   ⚠️  Could not fetch sample data:', error.message);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  if (allGood) {
    console.log('✅ All checks passed! Research Assistant should work.');
    console.log('\nNext steps:');
    console.log('1. Start backend: npm run start:dev');
    console.log('2. Open browser: http://localhost:3000/app/deals/workspace.html?ticker=AAPL');
    console.log('3. Login if needed');
    console.log('4. Click "Research Assistant" and ask: "What are the key risks?"');
  } else {
    console.log('⚠️  Some issues found. Please fix the items marked with ❌ above.');
    console.log('\nCommon fixes:');
    console.log('- Missing data: node scripts/end-to-end-pipeline.js AAPL');
    console.log('- Missing tables: npm run prisma:migrate');
    console.log('- No users: Sign up at /login.html');
  }
  
  console.log('\n');

  await prisma.$disconnect();
}

diagnose().catch(console.error);
