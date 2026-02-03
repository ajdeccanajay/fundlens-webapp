/**
 * Script to load mini_MVP_metrics.xlsx into PostgreSQL
 * Run with: npx ts-node src/scripts/load-metric-mappings.ts
 */

import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

interface MetricRow {
  'Direct Metric': string;
  'Display Name'?: string;
  'Statement': string;
  'Synonyms': string;
  'Common_XBRL_Tags'?: string;
  'Calculation_Formula'?: string;
  'Description'?: string;
}

async function loadMetricMappings(excelPath: string) {
  console.log(`📖 Reading Excel file: ${excelPath}`);
  
  // Read Excel file
  const workbook = XLSX.readFile(excelPath);
  const sheetName = 'IS+BS+CF+SE-Condensed';
  
  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found in Excel file`);
  }
  
  const worksheet = workbook.Sheets[sheetName];
  const data: MetricRow[] = XLSX.utils.sheet_to_json(worksheet);
  
  console.log(`📊 Found ${data.length} metrics in Excel`);
  
  // Transform and load into database
  const mappings: any[] = [];
  
  for (const row of data) {
    const normalizedMetric = row['Direct Metric'];
    
    if (!normalizedMetric) {
      continue;
    }
    
    // Parse synonyms
    const synonymsStr = row['Synonyms'] || '';
    const synonyms = synonymsStr
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    // Parse XBRL tags
    const xbrlStr = row['Common_XBRL_Tags'] || '';
    const xbrlTags = xbrlStr
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    // Determine statement type
    const statement = row['Statement'] || '';
    let statementType = 'unknown';
    
    if (statement.toLowerCase().includes('balance')) {
      statementType = 'balance_sheet';
    } else if (statement.toLowerCase().includes('income') || statement.toLowerCase().includes('p&l')) {
      statementType = 'income_statement';
    } else if (statement.toLowerCase().includes('cash')) {
      statementType = 'cash_flow';
    } else if (statement.toLowerCase().includes('equity')) {
      statementType = 'shareholders_equity';
    }
    
    mappings.push({
      normalizedMetric,
      displayName: row['Display Name'] || normalizedMetric,
      statementType,
      synonyms,
      xbrlTags,
      calculationFormula: row['Calculation_Formula'] || null,
      description: row['Description'] || null,
    });
  }
  
  console.log(`💾 Saving ${mappings.length} mappings to database...`);
  
  // Use upsert to handle duplicates
  let successCount = 0;
  for (const mapping of mappings) {
    try {
      await prisma.metricMapping.upsert({
        where: { normalizedMetric: mapping.normalizedMetric },
        update: mapping,
        create: mapping,
      });
      successCount++;
    } catch (error) {
      console.error(`Error saving ${mapping.normalizedMetric}:`, error);
    }
  }
  
  console.log(`✅ Successfully loaded ${successCount} metric mappings`);
  
  // Print some stats
  const stats = await prisma.metricMapping.groupBy({
    by: ['statementType'],
    _count: true,
  });
  
  console.log('\n📈 Metrics by statement type:');
  stats.forEach(stat => {
    console.log(`  ${stat.statementType}: ${stat._count}`);
  });
}

async function main() {
  const excelPath = process.argv[2] || path.join(__dirname, '../../rebuild-specs/mini MVP metrics.xlsx');
  
  try {
    await loadMetricMappings(excelPath);
  } catch (error) {
    console.error('❌ Error loading metric mappings:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
