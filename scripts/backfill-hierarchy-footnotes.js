#!/usr/bin/env node

/**
 * Backfill Hierarchy and Footnotes for Existing Deals
 * 
 * This script runs Steps G & H on deals that were processed before Phase 1 (Option 3).
 * It's safe to run multiple times - it will upsert data.
 * 
 * Usage:
 *   node scripts/backfill-hierarchy-footnotes.js AMZN
 *   node scripts/backfill-hierarchy-footnotes.js --all
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Build hierarchy from metrics (simplified version of MetricHierarchyService.buildHierarchy)
 */
function buildHierarchy(metrics) {
  const nodes = new Map();

  // Create nodes
  for (const metric of metrics) {
    const node = {
      metricId: metric.id,
      normalizedName: metric.normalizedMetric || metric.normalized_metric,
      label: metric.label || metric.rawLabel || metric.raw_label,
      value: parseFloat(metric.value) || 0,
      parentId: metric.parentMetric || metric.parent_metric,
      childrenIds: [],
      siblingIds: [],
      level: metric.indentLevel || metric.indent_level || 0,
      rollupType: 'sum',
      statementType: metric.statementType || metric.statement_type || 'unknown',
      fiscalPeriod: metric.fiscalPeriod || metric.fiscal_period || 'unknown',
      displayOrder: metric.displayOrder || metric.display_order || 0,
    };
    nodes.set(node.metricId, node);
  }

  // Build parent-child relationships
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      const parent = nodes.get(node.parentId);
      parent.childrenIds.push(node.metricId);
    }
  }

  // Build sibling relationships
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      const parent = nodes.get(node.parentId);
      node.siblingIds = parent.childrenIds.filter(id => id !== node.metricId);
    }
  }

  return nodes;
}

/**
 * Save hierarchy to database
 */
async function saveHierarchy(dealId, nodes) {
  for (const node of nodes.values()) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO metric_hierarchy (
        deal_id, metric_id, fiscal_period, parent_id, children_ids, sibling_ids,
        level, normalized_name, label, value, rollup_type,
        statement_type, display_order, ticker, metric_name, is_key_driver, created_at, updated_at
      )
      VALUES (
        $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid[], $6::uuid[],
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, NOW(), NOW()
      )
      ON CONFLICT (deal_id, fiscal_period, metric_id) DO UPDATE SET
        parent_id = EXCLUDED.parent_id,
        children_ids = EXCLUDED.children_ids,
        sibling_ids = EXCLUDED.sibling_ids,
        level = EXCLUDED.level,
        normalized_name = EXCLUDED.normalized_name,
        label = EXCLUDED.label,
        value = EXCLUDED.value,
        rollup_type = EXCLUDED.rollup_type,
        statement_type = EXCLUDED.statement_type,
        display_order = EXCLUDED.display_order,
        updated_at = NOW()
    `,
      dealId,
      node.metricId,
      node.fiscalPeriod,
      node.parentId || null,
      node.childrenIds || [],
      node.siblingIds || [],
      node.level,
      node.normalizedName,
      node.label,
      node.value,
      node.rollupType,
      node.statementType,
      node.displayOrder,
      'UNKNOWN', // ticker - will be updated if needed
      node.normalizedName || 'unknown', // metric_name
      false // is_key_driver
    );
  }
}

/**
 * Extract footnote references from metric label
 */
function extractFootnoteReferences(label) {
  if (!label) return [];
  const references = [];

  // Pattern 1: (1), (2), (3)
  const pattern1 = /\((\d+(?:,\s*\d+)*)\)/g;
  let match;
  while ((match = pattern1.exec(label)) !== null) {
    const nums = match[1].split(',').map(n => n.trim());
    references.push(...nums);
  }

  // Pattern 2: [1], [2], [3]
  const pattern2 = /\[(\d+(?:,\s*\d+)*)\]/g;
  while ((match = pattern2.exec(label)) !== null) {
    const nums = match[1].split(',').map(n => n.trim());
    references.push(...nums);
  }

  return [...new Set(references)];
}

/**
 * Find footnote text by number in HTML content
 */
function findFootnoteByNumber(htmlContent, footnoteNumber) {
  const patterns = [
    new RegExp(`Note\\s+${footnoteNumber}[\\s\\-:]+([^\\n]+)([\\s\\S]*?)(?=Note\\s+\\d+|$)`, 'i'),
    new RegExp(`\\(${footnoteNumber}\\)\\s+([^\\n]+)([\\s\\S]*?)(?=\\(\\d+\\)|$)`, 'i'),
    new RegExp(`^\\s*${footnoteNumber}\\.\\s+([^\\n]+)([\\s\\S]*?)(?=^\\s*\\d+\\.|$)`, 'im')
  ];

  for (const pattern of patterns) {
    const match = htmlContent.match(pattern);
    if (match) {
      return {
        section: match[1].trim(),
        text: match[2] ? match[2].trim().substring(0, 5000) : match[1].trim()
      };
    }
  }

  return null;
}

/**
 * Classify footnote type
 */
function classifyFootnote(footnoteText) {
  const lowerText = footnoteText.toLowerCase();

  if (lowerText.includes('accounting policy') || lowerText.includes('recognition') || 
      lowerText.includes('measurement') || lowerText.includes('basis of presentation')) {
    return 'accounting_policy';
  }

  if (lowerText.includes('segment') || lowerText.includes('geographic') || 
      lowerText.includes('by region') || lowerText.includes('by product')) {
    return 'segment_breakdown';
  }

  if (lowerText.includes('reconciliation') || lowerText.includes('adjusted') || 
      lowerText.includes('non-gaap')) {
    return 'reconciliation';
  }

  return 'other';
}

/**
 * Link footnotes to metrics
 */
async function linkFootnotesToMetrics(dealId, metrics, htmlContent) {
  const references = [];

  for (const metric of metrics) {
    const label = metric.label || metric.rawLabel || metric.raw_label || '';
    const footnoteRefs = extractFootnoteReferences(label);
    
    for (const refNum of footnoteRefs) {
      const footnote = findFootnoteByNumber(htmlContent, refNum);
      
      if (footnote) {
        references.push({
          dealId,
          metricId: metric.id,
          footnoteNumber: refNum,
          footnoteSection: footnote.section,
          footnoteText: footnote.text,
          contextType: classifyFootnote(footnote.text),
        });
      }
    }
  }

  return references;
}

/**
 * Save footnote references to database
 */
async function saveFootnoteReferences(references) {
  for (const ref of references) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO footnote_references (
        deal_id, metric_id, footnote_number, footnote_section,
        footnote_text, context_type, created_at, updated_at
      )
      VALUES (
        $1::uuid, $2::uuid, $3, $4,
        $5, $6, NOW(), NOW()
      )
      ON CONFLICT (deal_id, metric_id, footnote_number) DO UPDATE SET
        footnote_section = EXCLUDED.footnote_section,
        footnote_text = EXCLUDED.footnote_text,
        context_type = EXCLUDED.context_type,
        updated_at = NOW()
    `,
      ref.dealId,
      ref.metricId,
      ref.footnoteNumber,
      ref.footnoteSection || null,
      ref.footnoteText || null,
      ref.contextType
    );
  }
}

async function backfillDeal(dealId, ticker) {
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║  Backfilling Hierarchy & Footnotes for ${ticker.padEnd(20)} ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);

  // Step G: Build Metric Hierarchy
  console.log('📊 Step G: Building metric hierarchy...\n');
  
  try {
    // Get all fiscal periods with metrics
    const periods = await prisma.financialMetric.findMany({
      where: { ticker },
      select: { fiscalPeriod: true },
      distinct: ['fiscalPeriod'],
      orderBy: { fiscalPeriod: 'desc' },
    });

    if (periods.length === 0) {
      console.log('⚠️  No metrics found for this ticker\n');
      return { hierarchyNodes: 0, footnoteReferences: 0 };
    }

    console.log(`Found ${periods.length} fiscal periods with metrics\n`);

    let totalHierarchyNodes = 0;
    
    for (const { fiscalPeriod } of periods) {
      console.log(`  Processing ${fiscalPeriod}...`);
      
      const metrics = await prisma.financialMetric.findMany({
        where: { ticker, fiscalPeriod },
      });

      console.log(`    - Found ${metrics.length} metrics`);

      // Build hierarchy
      const hierarchyMap = buildHierarchy(metrics);
      console.log(`    - Built hierarchy: ${hierarchyMap.size} nodes`);

      // Save hierarchy to database
      await saveHierarchy(dealId, hierarchyMap);
      console.log(`    - ✅ Saved to database`);
      
      totalHierarchyNodes += hierarchyMap.size;
    }

    console.log(`\n✅ Step G Complete: ${totalHierarchyNodes} hierarchy nodes saved\n`);

    // Step H: Link Footnotes
    console.log('📝 Step H: Linking footnotes...\n');

    let totalFootnoteReferences = 0;

    for (const { fiscalPeriod } of periods) {
      console.log(`  Processing ${fiscalPeriod}...`);
      
      const metrics = await prisma.financialMetric.findMany({
        where: { ticker, fiscalPeriod },
      });

      // Get narrative chunks for this period
      const fiscalYear = fiscalPeriod.match(/\d{4}/)?.[0];
      if (!fiscalYear) {
        console.log(`    - ⚠️  Could not parse fiscal year from ${fiscalPeriod}`);
        continue;
      }

      const chunks = await prisma.narrativeChunk.findMany({
        where: { 
          ticker,
          filingDate: {
            gte: new Date(`${fiscalYear}-01-01`),
            lt: new Date(`${parseInt(fiscalYear) + 1}-01-01`)
          }
        },
        orderBy: { filingDate: 'desc' },
      });

      console.log(`    - Found ${chunks.length} narrative chunks`);

      if (chunks.length > 0) {
        // Combine all chunk content as HTML
        const htmlContent = chunks.map(c => c.content).join('\n\n');
        
        const references = await linkFootnotesToMetrics(
          dealId,
          metrics,
          htmlContent,
        );

        if (references.length > 0) {
          await saveFootnoteReferences(references);
          console.log(`    - ✅ Linked ${references.length} footnotes`);
          totalFootnoteReferences += references.length;
        } else {
          console.log(`    - No footnote references found`);
        }
      } else {
        console.log(`    - ⚠️  No narrative chunks found`);
      }
    }

    console.log(`\n✅ Step H Complete: ${totalFootnoteReferences} footnote references saved\n`);

    return {
      hierarchyNodes: totalHierarchyNodes,
      footnoteReferences: totalFootnoteReferences,
    };

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    console.error(error.stack);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node scripts/backfill-hierarchy-footnotes.js <TICKER>');
    console.log('  node scripts/backfill-hierarchy-footnotes.js --all');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/backfill-hierarchy-footnotes.js AMZN');
    console.log('  node scripts/backfill-hierarchy-footnotes.js META');
    console.log('  node scripts/backfill-hierarchy-footnotes.js --all');
    process.exit(1);
  }

  try {
    if (args[0] === '--all') {
      // Backfill all deals with status 'ready'
      const deals = await prisma.deal.findMany({
        where: { status: 'ready' },
        orderBy: { createdAt: 'desc' },
      });

      console.log(`\nFound ${deals.length} deals to backfill\n`);

      let totalHierarchyNodes = 0;
      let totalFootnoteReferences = 0;

      for (const deal of deals) {
        const result = await backfillDeal(deal.id, deal.ticker);
        totalHierarchyNodes += result.hierarchyNodes;
        totalFootnoteReferences += result.footnoteReferences;
      }

      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║  Backfill Complete - All Deals                             ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');
      console.log(`Total Hierarchy Nodes: ${totalHierarchyNodes}`);
      console.log(`Total Footnote References: ${totalFootnoteReferences}\n`);

    } else {
      // Backfill specific ticker
      const ticker = args[0].toUpperCase();
      
      const deal = await prisma.deal.findFirst({
        where: { ticker, status: 'ready' },
        orderBy: { createdAt: 'desc' },
      });

      if (!deal) {
        console.error(`\n❌ No ready deal found for ticker: ${ticker}\n`);
        process.exit(1);
      }

      console.log(`Deal ID: ${deal.id}`);
      console.log(`Deal Name: ${deal.name}`);
      console.log(`Status: ${deal.status}\n`);

      const result = await backfillDeal(deal.id, ticker);

      console.log('╔════════════════════════════════════════════════════════════╗');
      console.log('║  Backfill Complete                                         ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');
      console.log(`Hierarchy Nodes: ${result.hierarchyNodes}`);
      console.log(`Footnote References: ${result.footnoteReferences}\n`);

      // Verify data
      console.log('🔍 Verifying data...\n');
      
      const hierarchyCount = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int as count FROM metric_hierarchy WHERE deal_id = $1::uuid
      `, deal.id);
      
      const footnoteCount = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int as count FROM footnote_references WHERE deal_id = $1::uuid
      `, deal.id);

      console.log(`Database verification:`);
      console.log(`  Hierarchy nodes in DB: ${hierarchyCount[0].count}`);
      console.log(`  Footnote references in DB: ${footnoteCount[0].count}\n`);

      if (hierarchyCount[0].count > 0 && footnoteCount[0].count > 0) {
        console.log('✅ Phase 1 (Option 3) data successfully backfilled!\n');
      } else {
        console.log('⚠️  Warning: Some data may not have been saved\n');
      }
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
