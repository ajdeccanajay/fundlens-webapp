#!/usr/bin/env node

/**
 * Add sample scratchpad items for testing
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addSampleItems() {
  try {
    console.log('📝 Adding sample scratchpad items...');
    
    const workspaceId = '00000000-0000-0000-0000-000000000001'; // Default workspace
    
    // Sample 1: Direct Answer
    const item1 = await prisma.$executeRaw`
      INSERT INTO scratchpad_items (workspace_id, type, content, sources, metadata)
      VALUES (
        ${workspaceId}::uuid,
        'direct_answer',
        '{"text": "Apple recognizes iPhone revenue at point of sale, while services like iCloud and Apple Music are recognized over time as the service is delivered.", "confidence": "high", "sourceCount": 3}'::jsonb,
        '[{"filingType": "10-K", "filingDate": "2023-11-03", "url": "https://sec.gov/example", "ticker": "AAPL"}]'::jsonb,
        '{"ticker": "AAPL", "tags": ["revenue", "recognition"]}'::jsonb
      )
    `;
    
    // Sample 2: Revenue Framework
    const item2 = await prisma.$executeRaw`
      INSERT INTO scratchpad_items (workspace_id, type, content, sources, metadata)
      VALUES (
        ${workspaceId}::uuid,
        'revenue_framework',
        '{"pointInTime": [{"name": "iPhone", "icon": "phone"}, {"name": "Mac", "icon": "laptop"}, {"name": "iPad", "icon": "tablet"}], "overTime": [{"name": "iCloud", "icon": "services"}, {"name": "Apple Music", "icon": "services"}, {"name": "AppleCare", "icon": "services"}]}'::jsonb,
        '[{"filingType": "10-K", "filingDate": "2023-11-03", "url": "https://sec.gov/example", "ticker": "AAPL"}]'::jsonb,
        '{"ticker": "AAPL", "tags": ["revenue", "products"]}'::jsonb
      )
    `;
    
    // Sample 3: Trend Analysis
    const item3 = await prisma.$executeRaw`
      INSERT INTO scratchpad_items (workspace_id, type, content, sources, metadata)
      VALUES (
        ${workspaceId}::uuid,
        'trend_analysis',
        '{"metric": "Total Revenue", "data": [{"year": 2021, "value": 365817, "yoyChange": 33.3}, {"year": 2022, "value": 394328, "yoyChange": 7.8}, {"year": 2023, "value": 383285, "yoyChange": -2.8}]}'::jsonb,
        '[{"filingType": "10-K", "filingDate": "2023-11-03", "url": "https://sec.gov/example", "ticker": "AAPL"}]'::jsonb,
        '{"ticker": "AAPL", "tags": ["revenue", "trends"]}'::jsonb
      )
    `;
    
    // Sample 4: Provocation
    const item4 = await prisma.$executeRaw`
      INSERT INTO scratchpad_items (workspace_id, type, content, sources, metadata)
      VALUES (
        ${workspaceId}::uuid,
        'provocation',
        '{"question": "How might Apple services revenue shift impact gross margins over the next 3-5 years?", "context": "Services typically have higher margins than hardware products"}'::jsonb,
        '[]'::jsonb,
        '{"ticker": "AAPL", "tags": ["margins", "strategy"]}'::jsonb
      )
    `;
    
    console.log('✅ Added 4 sample scratchpad items');
    
    // Verify
    const count = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM scratchpad_items WHERE workspace_id = ${workspaceId}::uuid
    `;
    
    console.log('✅ Total items in workspace:', count[0].count);
    
  } catch (error) {
    console.error('❌ Failed to add sample items:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

addSampleItems();
