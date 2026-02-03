#!/usr/bin/env node
/**
 * Create Sample Deals
 * Creates deal records for testing the Insights page
 */

const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

const SAMPLE_DEALS = [
  { ticker: 'AAPL', companyName: 'Apple Inc.', dealType: 'public' },
  { ticker: 'MSFT', companyName: 'Microsoft Corporation', dealType: 'public' },
  { ticker: 'GOOGL', companyName: 'Alphabet Inc.', dealType: 'public' },
  { ticker: 'AMZN', companyName: 'Amazon.com Inc.', dealType: 'public' },
  { ticker: 'TSLA', companyName: 'Tesla Inc.', dealType: 'public' },
  { ticker: 'AMGN', companyName: 'Amgen Inc.', dealType: 'public' },
];

async function createSampleDeals() {
  console.log('🚀 Creating Sample Deals...');
  
  let created = 0;
  let existing = 0;

  for (const dealData of SAMPLE_DEALS) {
    try {
      // Check if deal already exists
      const existingDeal = await prisma.deal.findFirst({
        where: { ticker: dealData.ticker },
      });

      if (existingDeal) {
        console.log(`⏭️  ${dealData.ticker}: Already exists`);
        existing++;
        continue;
      }

      // Create new deal
      const deal = await prisma.deal.create({
        data: {
          id: uuidv4(),
          name: dealData.companyName, // Required field
          ticker: dealData.ticker,
          companyName: dealData.companyName,
          dealType: dealData.dealType,
          status: 'ready', // Must be one of: draft, processing, ready, error, in-progress, review, closed
          tenantId: '00000000-0000-0000-0000-000000000000', // Default tenant
        },
      });

      console.log(`✅ ${dealData.ticker}: ${dealData.companyName}`);
      created++;
    } catch (error) {
      console.error(`❌ Error creating ${dealData.ticker}:`, error.message);
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Existing: ${existing}`);
  console.log(`   Total: ${created + existing}`);
  console.log(`\n✅ Sample deals created successfully!`);
}

createSampleDeals()
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
