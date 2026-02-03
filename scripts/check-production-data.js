#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const DATABASE_URL = "postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db?sslmode=no-verify";

async function checkData() {
  const prisma = new PrismaClient({
    datasources: { db: { url: DATABASE_URL } }
  });

  try {
    console.log('📊 Production Database State\n');

    const [tenants, tenantUsers, deals, filings, metrics, chunks] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenantUser.count(),
      prisma.deal.count(),
      prisma.filingMetadata.count(),
      prisma.financialMetric.count(),
      prisma.narrativeChunk.count(),
    ]);

    console.log(`Tenants:           ${tenants}`);
    console.log(`Tenant Users:      ${tenantUsers}`);
    console.log(`Deals:             ${deals}`);
    console.log(`SEC Filings:       ${filings}`);
    console.log(`Financial Metrics: ${metrics}`);
    console.log(`Narrative Chunks:  ${chunks}`);
    console.log('');

    if (deals > 0) {
      console.log('\n📋 Sample Deals:');
      const sampleDeals = await prisma.deal.findMany({ take: 5, include: { tenant: true } });
      sampleDeals.forEach(d => {
        console.log(`  - ${d.name} (${d.ticker || 'N/A'}) - ${d.tenant?.name || 'No tenant'}`);
      });
    } else {
      console.log('\n⚠️  No deals found in database');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkData();
