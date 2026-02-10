/**
 * Test script for filing_notifications table migration
 * 
 * This script validates that the filing_notifications table migration
 * was applied successfully on staging/production database.
 * 
 * Tests:
 * 1. Table exists
 * 2. All columns exist with correct types
 * 3. Primary key is set correctly
 * 4. Indexes are created (tenant_id, ticker, created_at)
 * 5. Foreign key to tenants table works
 * 6. Default values work correctly
 * 7. CRUD operations work
 * 8. Tenant isolation is enforced
 * 9. Cascade delete works
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ ${message}`, 'cyan');
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

async function testTableExists() {
  log('\n=== Test 1: Table Exists ===', 'blue');
  
  try {
    const result = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'filing_notifications'
      ) as exists;
    `;
    
    if (result[0].exists) {
      logSuccess('filing_notifications table exists');
      return true;
    } else {
      logError('filing_notifications table does not exist');
      return false;
    }
  } catch (error) {
    logError(`Error checking table existence: ${error.message}`);
    return false;
  }
}

async function testColumns() {
  log('\n=== Test 2: Column Structure ===', 'blue');
  
  const expectedColumns = {
    id: { type: 'uuid', nullable: false },
    tenant_id: { type: 'character varying', nullable: false, maxLength: 255 },
    ticker: { type: 'character varying', nullable: false, maxLength: 20 },
    filing_type: { type: 'character varying', nullable: false, maxLength: 10 },
    filing_date: { type: 'date', nullable: false },
    report_date: { type: 'date', nullable: true },
    accession_number: { type: 'character varying', nullable: false, maxLength: 50 },
    dismissed: { type: 'boolean', nullable: false },
    dismissed_at: { type: 'timestamp without time zone', nullable: true },
    created_at: { type: 'timestamp without time zone', nullable: false },
    updated_at: { type: 'timestamp without time zone', nullable: false },
  };
  
  try {
    const columns = await prisma.$queryRaw`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        character_maximum_length,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'filing_notifications'
      ORDER BY ordinal_position;
    `;
    
    let allColumnsValid = true;
    
    for (const [columnName, expected] of Object.entries(expectedColumns)) {
      const column = columns.find(c => c.column_name === columnName);
      
      if (!column) {
        logError(`Column '${columnName}' is missing`);
        allColumnsValid = false;
        continue;
      }
      
      // Check data type
      if (column.data_type !== expected.type) {
        logError(`Column '${columnName}' has wrong type: ${column.data_type} (expected ${expected.type})`);
        allColumnsValid = false;
      }
      
      // Check nullable
      const isNullable = column.is_nullable === 'YES';
      if (isNullable !== expected.nullable) {
        logError(`Column '${columnName}' nullable mismatch: ${isNullable} (expected ${expected.nullable})`);
        allColumnsValid = false;
      }
      
      // Check max length for varchar
      if (expected.maxLength && column.character_maximum_length !== expected.maxLength) {
        logError(`Column '${columnName}' max length: ${column.character_maximum_length} (expected ${expected.maxLength})`);
        allColumnsValid = false;
      }
      
      logSuccess(`Column '${columnName}' is valid`);
    }
    
    return allColumnsValid;
  } catch (error) {
    logError(`Error checking columns: ${error.message}`);
    return false;
  }
}

async function testPrimaryKey() {
  log('\n=== Test 3: Primary Key ===', 'blue');
  
  try {
    const result = await prisma.$queryRaw`
      SELECT 
        tc.constraint_name,
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = 'filing_notifications';
    `;
    
    if (result.length === 0) {
      logError('No primary key found');
      return false;
    }
    
    if (result[0].column_name === 'id') {
      logSuccess('Primary key is set on id column');
      return true;
    } else {
      logError(`Primary key is on wrong column: ${result[0].column_name}`);
      return false;
    }
  } catch (error) {
    logError(`Error checking primary key: ${error.message}`);
    return false;
  }
}

async function testIndexes() {
  log('\n=== Test 4: Indexes ===', 'blue');
  
  try {
    const indexes = await prisma.$queryRaw`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'filing_notifications';
    `;
    
    logInfo(`Found ${indexes.length} indexes`);
    
    const expectedIndexes = [
      'idx_filing_notifs_tenant',
      'idx_filing_notifs_ticker',
      'idx_filing_notifs_created',
    ];
    
    let allIndexesValid = true;
    
    for (const expectedIndex of expectedIndexes) {
      const index = indexes.find(idx => idx.indexname === expectedIndex);
      
      if (index) {
        logSuccess(`Index ${expectedIndex} exists`);
        logInfo(`  Definition: ${index.indexdef}`);
      } else {
        logError(`Index ${expectedIndex} not found`);
        allIndexesValid = false;
      }
    }
    
    if (!allIndexesValid) {
      logInfo('Available indexes:');
      indexes.forEach(idx => logInfo(`  - ${idx.indexname}`));
    }
    
    return allIndexesValid;
  } catch (error) {
    logError(`Error checking indexes: ${error.message}`);
    return false;
  }
}

async function testForeignKey() {
  log('\n=== Test 5: Foreign Key to Tenants ===', 'blue');
  
  try {
    const result = await prisma.$queryRaw`
      SELECT 
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = 'filing_notifications';
    `;
    
    if (result.length === 0) {
      logError('No foreign key found');
      return false;
    }
    
    const fk = result[0];
    
    if (fk.column_name === 'tenant_id' && fk.foreign_table_name === 'tenants') {
      logSuccess('Foreign key to tenants table exists');
      logInfo(`  Column: ${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`);
      
      if (fk.delete_rule === 'CASCADE') {
        logSuccess('Foreign key has ON DELETE CASCADE');
      } else {
        logWarning(`Foreign key delete rule is ${fk.delete_rule} (expected CASCADE)`);
      }
      
      return true;
    } else {
      logError(`Foreign key configuration incorrect: ${fk.column_name} -> ${fk.foreign_table_name}`);
      return false;
    }
  } catch (error) {
    logError(`Error checking foreign key: ${error.message}`);
    return false;
  }
}

async function testDefaultValues() {
  log('\n=== Test 6: Default Values ===', 'blue');
  
  let testTenantId = null;
  
  try {
    // Create a test tenant first
    const testTenant = await prisma.tenant.create({
      data: {
        name: `Test Tenant ${Date.now()}`,
        slug: `test-tenant-${Date.now()}`,
      },
    });
    testTenantId = testTenant.id;
    logInfo(`Created test tenant: ${testTenantId}`);
    
    // Insert a minimal record to test defaults
    const created = await prisma.filingNotification.create({
      data: {
        tenantId: testTenantId,
        ticker: 'AAPL',
        filingType: '10-K',
        filingDate: new Date('2024-11-01'),
        accessionNumber: '0000320193-24-000123',
      },
    });
    
    // Check defaults
    let allDefaultsValid = true;
    
    if (created.dismissed !== false) {
      logError(`dismissed default is ${created.dismissed}, expected false`);
      allDefaultsValid = false;
    } else {
      logSuccess('dismissed defaults to false');
    }
    
    if (!created.createdAt) {
      logError('created_at is not set');
      allDefaultsValid = false;
    } else {
      logSuccess('created_at is set automatically');
    }
    
    if (!created.updatedAt) {
      logError('updated_at is not set');
      allDefaultsValid = false;
    } else {
      logSuccess('updated_at is set automatically');
    }
    
    if (!created.id) {
      logError('id (UUID) is not generated');
      allDefaultsValid = false;
    } else {
      logSuccess('id (UUID) is generated automatically');
    }
    
    // Clean up
    await prisma.filingNotification.delete({
      where: { id: created.id },
    });
    
    await prisma.tenant.delete({
      where: { id: testTenantId },
    });
    
    logInfo('Test records cleaned up');
    
    return allDefaultsValid;
  } catch (error) {
    logError(`Error testing default values: ${error.message}`);
    
    // Clean up on error
    if (testTenantId) {
      try {
        await prisma.tenant.delete({
          where: { id: testTenantId },
        });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
    
    return false;
  }
}

async function testCRUDOperations() {
  log('\n=== Test 7: CRUD Operations ===', 'blue');
  
  let testTenantId = null;
  let testNotificationId = null;
  
  try {
    // Create a test tenant
    const testTenant = await prisma.tenant.create({
      data: {
        name: `CRUD Test Tenant ${Date.now()}`,
        slug: `crud-test-${Date.now()}`,
      },
    });
    testTenantId = testTenant.id;
    logInfo(`Created test tenant: ${testTenantId}`);
    
    // CREATE
    logInfo('Testing CREATE...');
    const created = await prisma.filingNotification.create({
      data: {
        tenantId: testTenantId,
        ticker: 'MSFT',
        filingType: '10-Q',
        filingDate: new Date('2024-10-31'),
        reportDate: new Date('2024-09-30'),
        accessionNumber: '0001564590-24-000456',
        dismissed: false,
      },
    });
    testNotificationId = created.id;
    
    if (created.ticker === 'MSFT' && created.filingType === '10-Q') {
      logSuccess('CREATE operation successful');
    } else {
      logError('CREATE operation failed');
      return false;
    }
    
    // READ
    logInfo('Testing READ...');
    const read = await prisma.filingNotification.findUnique({
      where: { id: testNotificationId },
    });
    
    if (read && read.ticker === 'MSFT' && read.tenantId === testTenantId) {
      logSuccess('READ operation successful');
    } else {
      logError('READ operation failed');
      return false;
    }
    
    // UPDATE
    logInfo('Testing UPDATE...');
    const updated = await prisma.filingNotification.update({
      where: { id: testNotificationId },
      data: {
        dismissed: true,
        dismissedAt: new Date(),
      },
    });
    
    if (updated.dismissed === true && updated.dismissedAt) {
      logSuccess('UPDATE operation successful');
    } else {
      logError('UPDATE operation failed');
      return false;
    }
    
    // Verify updatedAt changed
    if (updated.updatedAt > created.updatedAt) {
      logSuccess('updatedAt timestamp updated correctly');
    } else {
      logWarning('updatedAt timestamp may not be updating');
    }
    
    // DELETE
    logInfo('Testing DELETE...');
    await prisma.filingNotification.delete({
      where: { id: testNotificationId },
    });
    
    const deleted = await prisma.filingNotification.findUnique({
      where: { id: testNotificationId },
    });
    
    if (!deleted) {
      logSuccess('DELETE operation successful');
    } else {
      logError('DELETE operation failed');
      return false;
    }
    
    // Clean up tenant
    await prisma.tenant.delete({
      where: { id: testTenantId },
    });
    
    logInfo('Test records cleaned up');
    
    return true;
  } catch (error) {
    logError(`Error testing CRUD operations: ${error.message}`);
    
    // Clean up on error
    try {
      if (testNotificationId) {
        await prisma.filingNotification.delete({
          where: { id: testNotificationId },
        });
      }
      if (testTenantId) {
        await prisma.tenant.delete({
          where: { id: testTenantId },
        });
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    return false;
  }
}

async function testTenantIsolation() {
  log('\n=== Test 8: Tenant Isolation ===', 'blue');
  
  let tenant1Id = null;
  let tenant2Id = null;
  let notification1Id = null;
  let notification2Id = null;
  
  try {
    // Create two test tenants
    const tenant1 = await prisma.tenant.create({
      data: {
        name: `Tenant 1 ${Date.now()}`,
        slug: `tenant-1-${Date.now()}`,
      },
    });
    tenant1Id = tenant1.id;
    
    const tenant2 = await prisma.tenant.create({
      data: {
        name: `Tenant 2 ${Date.now()}`,
        slug: `tenant-2-${Date.now()}`,
      },
    });
    tenant2Id = tenant2.id;
    
    logInfo(`Created test tenants: ${tenant1Id}, ${tenant2Id}`);
    
    // Create notifications for both tenants for the same ticker
    const notification1 = await prisma.filingNotification.create({
      data: {
        tenantId: tenant1Id,
        ticker: 'AAPL',
        filingType: '10-K',
        filingDate: new Date('2024-11-01'),
        accessionNumber: '0000320193-24-000123',
      },
    });
    notification1Id = notification1.id;
    
    const notification2 = await prisma.filingNotification.create({
      data: {
        tenantId: tenant2Id,
        ticker: 'AAPL',
        filingType: '10-K',
        filingDate: new Date('2024-11-01'),
        accessionNumber: '0000320193-24-000123',
      },
    });
    notification2Id = notification2.id;
    
    logInfo('Created notifications for both tenants');
    
    // Verify tenant 1 can only see their notification
    const tenant1Notifications = await prisma.filingNotification.findMany({
      where: { tenantId: tenant1Id },
    });
    
    if (tenant1Notifications.length === 1 && tenant1Notifications[0].id === notification1Id) {
      logSuccess('Tenant 1 can only see their own notification');
    } else {
      logError(`Tenant 1 sees ${tenant1Notifications.length} notifications (expected 1)`);
      return false;
    }
    
    // Verify tenant 2 can only see their notification
    const tenant2Notifications = await prisma.filingNotification.findMany({
      where: { tenantId: tenant2Id },
    });
    
    if (tenant2Notifications.length === 1 && tenant2Notifications[0].id === notification2Id) {
      logSuccess('Tenant 2 can only see their own notification');
    } else {
      logError(`Tenant 2 sees ${tenant2Notifications.length} notifications (expected 1)`);
      return false;
    }
    
    // Verify both notifications are for the same filing (shared data principle)
    if (notification1.ticker === notification2.ticker &&
        notification1.filingType === notification2.filingType &&
        notification1.accessionNumber === notification2.accessionNumber) {
      logSuccess('Both tenants have notifications for the same filing (shared data)');
    } else {
      logError('Notifications do not match expected shared data pattern');
      return false;
    }
    
    // Clean up
    await prisma.filingNotification.deleteMany({
      where: { id: { in: [notification1Id, notification2Id] } },
    });
    
    await prisma.tenant.deleteMany({
      where: { id: { in: [tenant1Id, tenant2Id] } },
    });
    
    logInfo('Test records cleaned up');
    
    return true;
  } catch (error) {
    logError(`Error testing tenant isolation: ${error.message}`);
    
    // Clean up on error
    try {
      if (notification1Id || notification2Id) {
        await prisma.filingNotification.deleteMany({
          where: { id: { in: [notification1Id, notification2Id].filter(Boolean) } },
        });
      }
      if (tenant1Id || tenant2Id) {
        await prisma.tenant.deleteMany({
          where: { id: { in: [tenant1Id, tenant2Id].filter(Boolean) } },
        });
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    return false;
  }
}

async function testCascadeDelete() {
  log('\n=== Test 9: Cascade Delete ===', 'blue');
  
  let testTenantId = null;
  
  try {
    // Create a test tenant
    const testTenant = await prisma.tenant.create({
      data: {
        name: `Cascade Test Tenant ${Date.now()}`,
        slug: `cascade-test-${Date.now()}`,
      },
    });
    testTenantId = testTenant.id;
    logInfo(`Created test tenant: ${testTenantId}`);
    
    // Create multiple notifications for this tenant
    await prisma.filingNotification.createMany({
      data: [
        {
          tenantId: testTenantId,
          ticker: 'AAPL',
          filingType: '10-K',
          filingDate: new Date('2024-11-01'),
          accessionNumber: '0000320193-24-000123',
        },
        {
          tenantId: testTenantId,
          ticker: 'MSFT',
          filingType: '10-Q',
          filingDate: new Date('2024-10-31'),
          accessionNumber: '0001564590-24-000456',
        },
      ],
    });
    
    logInfo('Created 2 notifications for tenant');
    
    // Verify notifications exist
    const beforeDelete = await prisma.filingNotification.findMany({
      where: { tenantId: testTenantId },
    });
    
    if (beforeDelete.length === 2) {
      logSuccess('2 notifications exist before tenant deletion');
    } else {
      logError(`Expected 2 notifications, found ${beforeDelete.length}`);
      return false;
    }
    
    // Delete the tenant
    await prisma.tenant.delete({
      where: { id: testTenantId },
    });
    
    logInfo('Deleted tenant');
    
    // Verify notifications were cascade deleted
    const afterDelete = await prisma.filingNotification.findMany({
      where: { tenantId: testTenantId },
    });
    
    if (afterDelete.length === 0) {
      logSuccess('All notifications were cascade deleted with tenant');
      return true;
    } else {
      logError(`Expected 0 notifications after tenant deletion, found ${afterDelete.length}`);
      
      // Clean up orphaned notifications
      await prisma.filingNotification.deleteMany({
        where: { tenantId: testTenantId },
      });
      
      return false;
    }
  } catch (error) {
    logError(`Error testing cascade delete: ${error.message}`);
    
    // Clean up on error
    try {
      if (testTenantId) {
        await prisma.filingNotification.deleteMany({
          where: { tenantId: testTenantId },
        });
        await prisma.tenant.delete({
          where: { id: testTenantId },
        });
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    return false;
  }
}

async function runAllTests() {
  log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║  Filing Notifications Migration Test Suite                ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════╝', 'cyan');
  
  const results = {
    tableExists: false,
    columns: false,
    primaryKey: false,
    indexes: false,
    foreignKey: false,
    defaultValues: false,
    crudOperations: false,
    tenantIsolation: false,
    cascadeDelete: false,
  };
  
  try {
    results.tableExists = await testTableExists();
    
    if (results.tableExists) {
      results.columns = await testColumns();
      results.primaryKey = await testPrimaryKey();
      results.indexes = await testIndexes();
      results.foreignKey = await testForeignKey();
      results.defaultValues = await testDefaultValues();
      results.crudOperations = await testCRUDOperations();
      results.tenantIsolation = await testTenantIsolation();
      results.cascadeDelete = await testCascadeDelete();
    } else {
      logError('\nTable does not exist. Skipping remaining tests.');
      logInfo('Please run the migration first:');
      logInfo('  npm run prisma:migrate:deploy');
    }
  } catch (error) {
    logError(`\nUnexpected error during tests: ${error.message}`);
    console.error(error);
  }
  
  // Summary
  log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║  Test Summary                                              ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════╝', 'cyan');
  
  const testNames = {
    tableExists: 'Table Exists',
    columns: 'Column Structure',
    primaryKey: 'Primary Key',
    indexes: 'Indexes',
    foreignKey: 'Foreign Key to Tenants',
    defaultValues: 'Default Values',
    crudOperations: 'CRUD Operations',
    tenantIsolation: 'Tenant Isolation',
    cascadeDelete: 'Cascade Delete',
  };
  
  let passCount = 0;
  let totalTests = Object.keys(results).length;
  
  for (const [key, passed] of Object.entries(results)) {
    const status = passed ? '✓ PASS' : '✗ FAIL';
    const color = passed ? 'green' : 'red';
    log(`  ${status} - ${testNames[key]}`, color);
    if (passed) passCount++;
  }
  
  log('');
  log(`  Total: ${passCount}/${totalTests} tests passed`, passCount === totalTests ? 'green' : 'yellow');
  
  if (passCount === totalTests) {
    log('\n✓ All tests passed! Migration is successful.', 'green');
    return 0;
  } else {
    log(`\n✗ ${totalTests - passCount} test(s) failed. Please review the errors above.`, 'red');
    return 1;
  }
}

// Run tests
runAllTests()
  .then(exitCode => {
    prisma.$disconnect();
    process.exit(exitCode);
  })
  .catch(error => {
    logError(`Fatal error: ${error.message}`);
    console.error(error);
    prisma.$disconnect();
    process.exit(1);
  });
