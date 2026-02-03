require('dotenv').config();
const { Client } = require('pg');

const dealId = '52be3858-e723-4c27-a7c4-a61122ce0ba7';

const url = new URL(process.env.DATABASE_URL);
const client = new Client({
  host: url.hostname,
  port: parseInt(url.port || '5432'),
  database: url.pathname.slice(1),
  user: url.username,
  password: url.password,
  ssl: { rejectUnauthorized: false }
});

async function checkData() {
  try {
    await client.connect();
    
    console.log('AMZN Deal Data Check');
    console.log('====================\n');
    
    // Get deal status
    const dealResult = await client.query(
      'SELECT id, ticker, name, status, processing_message, updated_at FROM deals WHERE id = $1',
      [dealId]
    );
    
    if (dealResult.rows.length === 0) {
      console.log('Deal not found');
      return;
    }
    
    const deal = dealResult.rows[0];
    console.log('Status:', deal.status);
    console.log('Message:', deal.processing_message);
    console.log('Updated:', deal.updated_at);
    
    // Get data counts
    console.log('\nData Counts:');
    console.log('============');
    
    const metrics = await client.query("SELECT COUNT(*)::int as count FROM financial_metrics WHERE ticker = 'AMZN'");
    const calculated = await client.query("SELECT COUNT(*)::int as count FROM calculated_metrics WHERE ticker = 'AMZN'");
    const narratives = await client.query("SELECT COUNT(*)::int as count FROM narrative_chunks WHERE ticker = 'AMZN'");
    const hierarchy = await client.query("SELECT COUNT(*)::int as count FROM metric_hierarchy WHERE ticker = 'AMZN'");
    const footnotes = await client.query("SELECT COUNT(*)::int as count FROM footnote_references WHERE ticker = 'AMZN'");
    
    console.log('Raw Metrics:', metrics.rows[0].count);
    console.log('Calculated Metrics:', calculated.rows[0].count);
    console.log('Narrative Chunks:', narratives.rows[0].count);
    console.log('Metric Hierarchy:', hierarchy.rows[0].count);
    console.log('Footnote References:', footnotes.rows[0].count);
    
    // Get hierarchy by period
    const hierarchyByPeriod = await client.query(
      "SELECT fiscal_period, COUNT(*)::int as count FROM metric_hierarchy WHERE ticker = 'AMZN' GROUP BY fiscal_period ORDER BY fiscal_period DESC"
    );
    
    if (hierarchyByPeriod.rows.length > 0) {
      console.log('\nHierarchy by Period:');
      hierarchyByPeriod.rows.forEach(p => {
        console.log(`  ${p.fiscal_period}: ${p.count} nodes`);
      });
    }
    
    // Sample hierarchy data
    const sampleHierarchy = await client.query(
      "SELECT normalized_name, label, value, level, fiscal_period FROM metric_hierarchy WHERE ticker = 'AMZN' ORDER BY fiscal_period DESC, level, display_order LIMIT 10"
    );
    
    if (sampleHierarchy.rows.length > 0) {
      console.log('\nSample Hierarchy Data:');
      console.table(sampleHierarchy.rows);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

checkData();
