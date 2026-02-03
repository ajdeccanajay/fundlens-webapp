const { Client } = require('pg');
require('dotenv').config();

// Local database connection
const LOCAL_DB = {
  host: 'localhost',
  port: 5432,
  database: 'fundlens_db',
  user: 'fundlens_user',
  password: 'fundlens_password',
};

// RDS database connection  
const RDS_DB = {
  host: 'fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'fundlens_db',
  user: 'fundlens_admin',
  password: 'FundLens2025SecureDB',
  ssl: {
    rejectUnauthorized: false
  }
};

async function migrateTable(tableName, orderBy = 'created_at') {
  const localClient = new Client(LOCAL_DB);
  const rdsClient = new Client(RDS_DB);

  try {
    await localClient.connect();
    await rdsClient.connect();

    console.log(`\n📊 Migrating table: ${tableName}`);

    // Get row count from local
    const countResult = await localClient.query(`SELECT COUNT(*) FROM ${tableName}`);
    const totalRows = parseInt(countResult.rows[0].count);
    
    if (totalRows === 0) {
      console.log(`  ⏭️  Table ${tableName} is empty, skipping`);
      return;
    }

    console.log(`  📋 Total rows to migrate: ${totalRows}`);

    // Check if RDS table has data
    const rdsCountResult = await rdsClient.query(`SELECT COUNT(*) FROM ${tableName}`);
    const rdsRows = parseInt(rdsCountResult.rows[0].count);
    
    if (rdsRows > 0) {
      console.log(`  ⚠️  RDS table already has ${rdsRows} rows`);
      console.log(`  🔄 Clearing RDS table for fresh migration...`);
      await rdsClient.query(`TRUNCATE TABLE ${tableName} CASCADE`);
    }

    // Get all data from local
    const dataResult = await localClient.query(`SELECT * FROM ${tableName} ORDER BY ${orderBy}`);
    
    if (dataResult.rows.length === 0) {
      console.log(`  ✅ No data to migrate`);
      return;
    }

    // Get column names
    const columns = Object.keys(dataResult.rows[0]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const insertQuery = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

    // Insert data in batches
    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < dataResult.rows.length; i += batchSize) {
      const batch = dataResult.rows.slice(i, i + batchSize);
      
      for (const row of batch) {
        const values = columns.map(col => row[col]);
        await rdsClient.query(insertQuery, values);
        inserted++;
      }
      
      console.log(`  📈 Progress: ${inserted}/${totalRows} (${Math.round(inserted/totalRows*100)}%)`);
    }

    console.log(`  ✅ Successfully migrated ${inserted} rows`);

  } catch (error) {
    console.error(`  ❌ Error migrating ${tableName}:`, error.message);
    throw error;
  } finally {
    await localClient.end();
    await rdsClient.end();
  }
}

async function migrateAllData() {
  console.log('🚀 Starting data migration from localhost to AWS RDS');
  console.log('📍 Source: localhost:5432/fundlens_db');
  console.log('📍 Target: fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db');
  console.log('');

  // Define migration order (respecting foreign key constraints)
  const tables = [
    // Base tables first
    { name: 'tenants', orderBy: 'created_at' },
    { name: 'tenant_users', orderBy: 'created_at' },
    
    // Data sources and sync state
    { name: 'data_sources', orderBy: 'created_at' },
    { name: 's3_sync_state', orderBy: 'last_sync_at' },
    
    // Financial data
    { name: 'financial_metrics', orderBy: 'created_at' },
    { name: 'narrative_chunks', orderBy: 'created_at' },
    { name: 'filing_metadata', orderBy: 'created_at' },
    { name: 'metric_mappings', orderBy: 'created_at' },
    
    // Documents
    { name: 'documents', orderBy: 'created_at' },
    { name: 'document_chunks', orderBy: 'created_at' },
    { name: 'uploaded_documents', orderBy: 'uploaded_at' },
    
    // News and other data
    { name: 'news_articles', orderBy: 'created_at' },
    { name: 'subscriptions', orderBy: 'created_at' },
    { name: 'usage_logs', orderBy: 'timestamp' },
    { name: 'tenant_data_access', orderBy: 'granted_at' },
  ];

  let totalMigrated = 0;
  const startTime = Date.now();

  try {
    for (const table of tables) {
      await migrateTable(table.name, table.orderBy);
      totalMigrated++;
    }

    const duration = (Date.now() - startTime) / 1000;
    
    console.log('\n🎉 Migration completed successfully!');
    console.log(`📊 Tables migrated: ${totalMigrated}/${tables.length}`);
    console.log(`⏱️  Total time: ${duration.toFixed(2)} seconds`);
    
    // Verify migration
    console.log('\n🔍 Verifying migration...');
    await verifyMigration();
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

async function verifyMigration() {
  const localClient = new Client(LOCAL_DB);
  const rdsClient = new Client(RDS_DB);

  try {
    await localClient.connect();
    await rdsClient.connect();

    // Check key tables
    const keyTables = ['financial_metrics', 'data_sources', 's3_sync_state'];
    
    for (const table of keyTables) {
      const localCount = await localClient.query(`SELECT COUNT(*) FROM ${table}`);
      const rdsCount = await rdsClient.query(`SELECT COUNT(*) FROM ${table}`);
      
      const localRows = parseInt(localCount.rows[0].count);
      const rdsRows = parseInt(rdsCount.rows[0].count);
      
      if (localRows === rdsRows) {
        console.log(`  ✅ ${table}: ${localRows} rows (matches)`);
      } else {
        console.log(`  ❌ ${table}: Local=${localRows}, RDS=${rdsRows} (mismatch!)`);
      }
    }

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
  } finally {
    await localClient.end();
    await rdsClient.end();
  }
}

// Run migration
migrateAllData();