#!/usr/bin/env node

/**
 * Test RAG Query for AMZN
 * 
 * This script tests that Bedrock KB can retrieve AMZN narrative chunks
 * via RAG queries after KB sync is complete.
 */

const { 
  BedrockAgentRuntimeClient, 
  RetrieveCommand,
} = require('@aws-sdk/client-bedrock-agent-runtime');

const bedrockRuntime = new BedrockAgentRuntimeClient({ 
  region: process.env.AWS_REGION || 'us-east-1',
});

const KB_ID = process.env.BEDROCK_KB_ID || 'NB5XNMHBQT';

async function testRAGQuery(query, ticker = 'AMZN') {
  console.log(`\n🔍 Testing RAG query: "${query}"\n`);

  try {
    const command = new RetrieveCommand({
      knowledgeBaseId: KB_ID,
      retrievalQuery: {
        text: query,
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: 5,
          filter: {
            equals: {
              key: 'ticker',
              value: ticker,
            },
          },
        },
      },
    });

    const response = await bedrockRuntime.send(command);
    const results = response.retrievalResults || [];

    console.log(`Found ${results.length} results:\n`);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      console.log(`Result ${i + 1}:`);
      console.log(`  Score: ${result.score?.toFixed(4) || 'N/A'}`);
      console.log(`  Content: ${result.content?.text?.substring(0, 200)}...`);
      
      if (result.metadata) {
        console.log(`  Metadata:`);
        Object.entries(result.metadata).forEach(([key, value]) => {
          console.log(`    - ${key}: ${value}`);
        });
      }
      console.log('');
    }

    return results.length > 0;

  } catch (error) {
    console.error(`❌ RAG query failed: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  RAG Query Test for AMZN                                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const queries = [
    'What are Amazon\'s risk factors?',
    'Tell me about Amazon\'s financial results',
    'What are Amazon\'s recent events?',
  ];

  let successCount = 0;

  for (const query of queries) {
    const success = await testRAGQuery(query);
    if (success) successCount++;
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Test Summary                                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`Queries tested: ${queries.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${queries.length - successCount}\n`);

  if (successCount === queries.length) {
    console.log('✅ All RAG queries successful! KB sync is working.\n');
  } else if (successCount > 0) {
    console.log('⚠️  Some RAG queries failed. Check logs for details.\n');
  } else {
    console.log('❌ All RAG queries failed. KB sync may not be working.\n');
  }
}

main();
