#!/usr/bin/env node
/**
 * Create Default Tenant for Development
 * 
 * This script creates the default tenant in the database for local development.
 * Run this once before using the workspace on localhost.
 * 
 * Usage: node scripts/create-demo-tenant.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Creating default tenant for development...\n');

  const tenantId = 'default-tenant';
  const tenantSlug = 'default';

  try {
    // Check if tenant already exists
    const existing = await prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    if (existing) {
      console.log('✅ Default tenant already exists:');
      console.log(`   ID: ${existing.id}`);
      console.log(`   Slug: ${existing.slug}`);
      console.log(`   Name: ${existing.name}`);
      console.log(`   Status: ${existing.status}`);
      console.log(`   Tier: ${existing.tier}`);
      return;
    }

    // Create default tenant
    const tenant = await prisma.tenant.create({
      data: {
        id: tenantId,
        slug: tenantSlug,
        name: 'Default Organization',
        status: 'active',
        tier: 'enterprise',
        settings: {
          maxUsers: 100,
          maxDeals: 1000,
          features: ['research_assistant', 'export', 'qualitative_analysis']
        }
      }
    });

    console.log('✅ Default tenant created successfully:');
    console.log(`   ID: ${tenant.id}`);
    console.log(`   Slug: ${tenant.slug}`);
    console.log(`   Name: ${tenant.name}`);
    console.log(`   Status: ${tenant.status}`);
    console.log(`   Tier: ${tenant.tier}`);

    console.log('\n📝 The workspace will now auto-inject a mock JWT token on localhost.');

  } catch (error) {
    if (error.code === 'P2002') {
      console.log('⚠️  Default tenant already exists (unique constraint)');
    } else {
      console.error('❌ Error creating default tenant:', error.message);
      throw error;
    }
  }
}

main()
  .catch((e) => {
    console.error('❌ Script failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
