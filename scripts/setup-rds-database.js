const { Client } = require('pg');
require('dotenv').config();

const RDS_CONFIG = {
  host: 'fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'fundlens_db',
  user: 'fundlens_admin',
  password: 'FundLens2025SecureDB',
  ssl: {
    rejectUnauthorized: false
  }
};

async function setupRDSDatabase() {
  console.log('🚀 Setting up RDS PostgreSQL Database');
  console.log(`📍 Connecting to: ${RDS_CONFIG.host}:${RDS_CONFIG.port}`);
  
  const client = new Client(RDS_CONFIG);
  
  try {
    // Test connection
    console.log('🔌 Testing connection...');
    await client.connect();
    console.log('✅ Connected to RDS PostgreSQL successfully!');
    
    // Test basic query
    const result = await client.query('SELECT version()');
    console.log('📊 PostgreSQL Version:', result.rows[0].version);
    
    // Check if database is empty
    const tablesResult = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
    `);
    
    console.log(`📋 Current tables: ${tablesResult.rows.length}`);
    if (tablesResult.rows.length > 0) {
      console.log('   Tables:', tablesResult.rows.map(r => r.tablename).join(', '));
    } else {
      console.log('   Database is empty - ready for schema creation');
    }
    
    // Test write permissions
    try {
      await client.query('CREATE TABLE IF NOT EXISTS test_table (id SERIAL PRIMARY KEY, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('INSERT INTO test_table DEFAULT VALUES');
      const testResult = await client.query('SELECT COUNT(*) FROM test_table');
      console.log(`✅ Write test successful - ${testResult.rows[0].count} test records`);
      await client.query('DROP TABLE test_table');
      console.log('🧹 Cleaned up test table');
    } catch (error) {
      console.error('❌ Write test failed:', error.message);
    }
    
    console.log('');
    console.log('🎉 RDS Database is ready!');
    console.log('');
    console.log('📝 Connection string for .env:');
    console.log(`RDS_DATABASE_URL="postgresql://${RDS_CONFIG.user}:${RDS_CONFIG.password}@${RDS_CONFIG.host}:${RDS_CONFIG.port}/${RDS_CONFIG.database}?sslmode=require"`);
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 The RDS instance might still be starting up. Wait a few minutes and try again.');
    } else if (error.code === 'ENOTFOUND') {
      console.log('💡 Check the RDS endpoint hostname.');
    } else if (error.message.includes('password authentication failed')) {
      console.log('💡 Check the username and password.');
    } else if (error.message.includes('timeout')) {
      console.log('💡 Check security group settings - ensure port 5432 is open from your IP.');
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupRDSDatabase();