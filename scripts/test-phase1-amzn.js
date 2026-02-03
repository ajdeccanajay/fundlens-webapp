#!/usr/bin/env node

/**
 * Test Phase 1 (Option 3) Implementation with AMZN
 * 
 * This script:
 * 1. Creates a new AMZN deal
 * 2. Triggers the pipeline
 * 3. Monitors progress
 * 4. Verifies Steps G & H execute
 * 5. Checks hierarchy and footnote data
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'fundlens-admin-key-2024';

const headers = {
  'x-admin-key': ADMIN_KEY,
  'Content-Type': 'application/json',
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createDeal() {
  console.log('\n📝 Creating new AMZN deal for Phase 1 testing...\n');
  
  try {
    const response = await axios.post(
      `${API_BASE}/deals`,
      {
        ticker: 'AMZN',
        name: 'Amazon.com Inc - Phase 1 Test',
        description: 'Testing Phase 1 (Option 3) with Steps G & H',
      },
      { headers }
    );

    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to create deal');
    }

    const deal = response.data.data;
    console.log(`✅ Deal created: ${deal.id}`);
    console.log(`   Name: ${deal.name}`);
    console.log(`   Ticker: ${deal.ticker}`);
    console.log(`   Status: ${deal.status}\n`);

    return deal.id;
  } catch (error) {
    console.error('❌ Failed to create deal:', error.response?.data || error.message);
    process.exit(1);
  }
}

async function startPipeline(dealId) {
  console.log('🚀 Starting pipeline...\n');
  
  try {
    const response = await axios.post(
      `${API_BASE}/deals/${dealId}/analyze`,
      { years: 5 },
      { headers }
    );

    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to start pipeline');
    }

    console.log('✅ Pipeline started successfully\n');
    return true;
  } catch (error) {
    console.error('❌ Failed to start pipeline:', error.response?.data || error.message);
    return false;
  }
}

async function monitorPipeline(dealId) {
  console.log('👀 Monitoring pipeline progress...\n');
  
  let lastStatus = '';
  let lastMessage = '';
  let stepGExecuted = false;
  let stepHExecuted = false;
  
  while (true) {
    try {
      const response = await axios.get(
        `${API_BASE}/deals/${dealId}/pipeline-status`,
        { headers }
      );

      if (!response.data.success) {
        throw new Error('Failed to get pipeline status');
      }

      const { deal, pipeline } = response.data.data;
      
      // Check for status changes
      if (deal.status !== lastStatus) {
        console.log(`📊 Status: ${deal.status}`);
        lastStatus = deal.status;
      }

      // Check for message changes
      if (deal.processingMessage && deal.processingMessage !== lastMessage) {
        console.log(`   ${deal.processingMessage}`);
        lastMessage = deal.processingMessage;
        
        // Check for Step G execution
        if (deal.processingMessage.includes('Building metric hierarchy')) {
          stepGExecuted = true;
          console.log('   ✅ Step G (Metric Hierarchy) is executing!');
        }
        
        // Check for Step H execution
        if (deal.processingMessage.includes('Linking footnotes')) {
          stepHExecuted = true;
          console.log('   ✅ Step H (Footnote Linking) is executing!');
        }
      }

      // Check if completed
      if (deal.status === 'ready') {
        console.log('\n✅ Pipeline completed successfully!\n');
        return { success: true, stepGExecuted, stepHExecuted };
      }

      // Check if failed
      if (deal.status === 'error') {
        console.log('\n❌ Pipeline failed\n');
        return { success: false, stepGExecuted, stepHExecuted };
      }

      // Wait before next poll
      await sleep(3000);

    } catch (error) {
      console.error('⚠️  Error monitoring pipeline:', error.message);
      await sleep(5000);
    }
  }
}

async function verifyData(dealId) {
  console.log('🔍 Verifying Phase 1 data...\n');
  
  try {
    // Get deal data
    const response = await axios.get(
      `${API_BASE}/deals/${dealId}`,
      { headers }
    );

    if (!response.data.success) {
      throw new Error('Failed to get deal data');
    }

    const deal = response.data.data;
    
    // Count metrics
    const metricsResponse = await axios.get(
      `${API_BASE}/admin/metrics?ticker=${deal.ticker}`,
      { headers }
    );
    const metricsCount = metricsResponse.data.data?.length || 0;

    // Count hierarchy nodes (using raw SQL via admin endpoint)
    const hierarchyResponse = await axios.get(
      `${API_BASE}/deals/${dealId}/insights/hierarchy`,
      { headers }
    );
    const hierarchyCount = hierarchyResponse.data.data?.totalNodes || 0;

    // Count footnotes
    const footnotesResponse = await axios.get(
      `${API_BASE}/deals/${dealId}/insights/footnotes`,
      { headers }
    );
    const footnotesCount = footnotesResponse.data.data?.length || 0;

    console.log('Data Counts:');
    console.log('============');
    console.log(`Raw Metrics: ${metricsCount}`);
    console.log(`Metric Hierarchy: ${hierarchyCount}`);
    console.log(`Footnote References: ${footnotesCount}\n`);

    // Verify Phase 1 success
    const phase1Success = hierarchyCount > 0 && footnotesCount > 0;
    
    if (phase1Success) {
      console.log('✅ Phase 1 (Option 3) VERIFIED!');
      console.log('   - Steps G & H executed successfully');
      console.log('   - Hierarchy data saved to database');
      console.log('   - Footnote data saved to database\n');
    } else {
      console.log('❌ Phase 1 (Option 3) FAILED!');
      if (hierarchyCount === 0) {
        console.log('   - Step G did not save hierarchy data');
      }
      if (footnotesCount === 0) {
        console.log('   - Step H did not save footnote data');
      }
      console.log('');
    }

    return {
      metricsCount,
      hierarchyCount,
      footnotesCount,
      phase1Success,
    };

  } catch (error) {
    console.error('❌ Failed to verify data:', error.response?.data || error.message);
    return {
      metricsCount: 0,
      hierarchyCount: 0,
      footnotesCount: 0,
      phase1Success: false,
    };
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Phase 1 (Option 3) Test - AMZN Pipeline                  ║');
  console.log('║  Testing Steps G & H: Hierarchy + Footnotes               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Step 1: Create deal
  const dealId = await createDeal();

  // Step 2: Start pipeline
  const started = await startPipeline(dealId);
  if (!started) {
    console.log('❌ Test failed: Could not start pipeline\n');
    process.exit(1);
  }

  // Step 3: Monitor pipeline
  const { success, stepGExecuted, stepHExecuted } = await monitorPipeline(dealId);
  
  if (!success) {
    console.log('❌ Test failed: Pipeline did not complete successfully\n');
    process.exit(1);
  }

  // Step 4: Verify data
  const verification = await verifyData(dealId);

  // Final summary
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Test Summary                                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Deal ID: ${dealId}`);
  console.log(`Pipeline Completed: ${success ? '✅' : '❌'}`);
  console.log(`Step G Executed: ${stepGExecuted ? '✅' : '❌'}`);
  console.log(`Step H Executed: ${stepHExecuted ? '✅' : '❌'}`);
  console.log(`Hierarchy Data Saved: ${verification.hierarchyCount > 0 ? '✅' : '❌'} (${verification.hierarchyCount} nodes)`);
  console.log(`Footnote Data Saved: ${verification.footnotesCount > 0 ? '✅' : '❌'} (${verification.footnotesCount} references)`);
  console.log(`\nPhase 1 Status: ${verification.phase1Success ? '✅ SUCCESS' : '❌ FAILED'}\n`);

  if (verification.phase1Success) {
    console.log('🎉 Phase 1 (Option 3) is working correctly!');
    console.log('   Next: Implement frontend integration\n');
    process.exit(0);
  } else {
    console.log('⚠️  Phase 1 (Option 3) needs debugging');
    console.log('   Check logs for Step G and Step H execution\n');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
