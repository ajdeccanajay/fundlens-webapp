#!/usr/bin/env node

/**
 * Production Diagnostic Script
 * Checks the actual state of the production deployment
 */

const { PrismaClient } = require('@prisma/client');

const DATABASE_URL = "postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db?sslmode=no-verify";

async function diagnose() {
  console.log('🔍 FundLens Production Diagnostic\n');
  
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: DATABASE_URL
      }
    }
  });

  try {
    // 1. Check database connection
    console.log('1️⃣  Checking database connection...');
    await prisma.$connect();
    console.log('   ✅ Database connected\n');

    // 2. Check tenants
    console.log('2️⃣  Checking tenants...');
    const tenants = await prisma.tenant.findMany();
    console.log(`   Found ${tenants.length} tenants:`);
    tenants.forEach(t => {
      console.log(`   - ${t.name} (${t.id}) - Status: ${t.status}`);
    });
    console.log('');

    // 3. Check users
    console.log('3️⃣  Checking users...');
    const users = await prisma.user.findMany({
      include: { tenant: true }
    });
    console.log(`   Found ${users.length} users:`);
    users.forEach(u => {
      console.log(`   - ${u.email} (${u.role}) - Tenant: ${u.tenant?.name || 'N/A'}`);
    });
    console.log('');

    // 4. Check deals
    console.log('4️⃣  Checking deals...');
    const deals = await prisma.deal.findMany({
      include: { tenant: true }
    });
    console.log(`   Found ${deals.length} deals:`);
    deals.slice(0, 5).forEach(d => {
      console.log(`   - ${d.name} (${d.ticker || 'N/A'}) - Tenant: ${d.tenant?.name || 'N/A'}`);
    });
    if (deals.length > 5) {
      console.log(`   ... and ${deals.length - 5} more`);
    }
    console.log('');

    // 5. Check companies
    console.log('5️⃣  Checking companies...');
    const companies = await prisma.company.count();
    console.log(`   Found ${companies} companies\n`);

    // 6. Check SEC filings
    console.log('6️⃣  Checking SEC filings...');
    const filings = await prisma.sECFiling.count();
    console.log(`   Found ${filings} SEC filings\n`);

    // 7. Check metrics
    console.log('7️⃣  Checking metrics...');
    const metrics = await prisma.metric.count();
    console.log(`   Found ${metrics} metrics\n`);

    console.log('✅ Diagnostic complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

diagnose();
