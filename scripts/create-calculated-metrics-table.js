#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createCalculatedMetricsTable() {
  try {
    console.log('Creating calculated_metrics table...');
    
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS calculated_metrics (
        id SERIAL PRIMARY KEY,
        ticker VARCHAR(10) NOT NULL,
        metric_name VARCHAR(100) NOT NULL,
        value DECIMAL(20, 4) NOT NULL,
        period VARCHAR(20) NOT NULL,
        period_type VARCHAR(20) NOT NULL,
        calculation_method VARCHAR(100) NOT NULL,
        source_metrics JSONB NOT NULL,
        confidence_score DECIMAL(3, 2) NOT NULL DEFAULT 1.0,
        calculation_date TIMESTAMP NOT NULL DEFAULT NOW(),
        validation_status VARCHAR(20) NOT NULL DEFAULT 'calculated',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        
        UNIQUE(ticker, metric_name, period)
      )
    `;
    
    console.log('Creating indexes...');
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_calculated_metrics_ticker 
      ON calculated_metrics(ticker)
    `;
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_calculated_metrics_metric_name 
      ON calculated_metrics(metric_name)
    `;
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_calculated_metrics_period_type 
      ON calculated_metrics(period_type)
    `;
    
    console.log('✅ calculated_metrics table created successfully');
    
    // Test the table
    const count = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM calculated_metrics
    `;
    
    console.log(`Table has ${count[0].count} records`);
    
  } catch (error) {
    console.error('❌ Error creating table:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  createCalculatedMetricsTable()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { createCalculatedMetricsTable };