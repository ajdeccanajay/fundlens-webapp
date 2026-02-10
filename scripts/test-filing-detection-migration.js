/**
 * Test script for filing detection migration
 * 
 * This script validates that the filing_detection_state table migration
 * was applied successfully on staging/production database.
 * 
 * Tests:
 * 1. Table exists
 * 2. All columns exist with correct types
 * 3. Primary key is set correctly
 * 4. Indexes are created
 * 5. Default values work correctly
 * 6. CRUD operations work
 * 7. Constraints are enforced
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
        AND table_name = 'filing_detection_state'
      ) as exists;
    `;
    
    if (result[0].exists) {
      logSuccess('filing_detection_state table exists');
      return true;
    } else {
      logError('filing_detection_state table does not exist');
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
    ticker: { type: 'character varying', nullable: false, maxLength: 20 },
    last_check_date: { type: 'timestamp without time zone', nullable: false },
    last_filing_date: { type: 'timestamp without time zone', nullable: true },
    check_count: { type: 'integer', nullable: false },
    consecutive_failures: { type: 'integer', nullable: false },
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
      AND table_name = 'filing_detection_state'
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
        AND tc.table_name = 'filing_detection_state';
    `;
    
    if (result.length === 0) {
      logError('No primary key found');
      return false;
    }
    
    if (result[0].column_name === 'ticker') {
      logSuccess('Primary key is set on ticker column');
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
        AND tablename = 'filing_detection_state';
    `;
    
    logInfo(`Found ${indexes.length} indexes`);
    
    // Check for the expected index on last_check_date
    const lastCheckIndex = indexes.find(idx => 
      idx.indexname === 'idx_filing_detection_last_check'
    );
    
    if (lastCheckIndex) {
      logSuccess('Index idx_filing_detection_last_check exists');
      logInfo(`  Definition: ${lastCheckIndex.indexdef}`);
      return true;
    } else {
      logWarning('Index idx_filing_detection_last_check not found');
      logInfo('Available indexes:');
      indexes.forEach(idx => logInfo(`  - ${idx.indexname}`));
      return false;
    }
  } catch (error) {
    logError(`Error checking indexes: ${error.message}`);
    return false;
  }
}

async function testDefaultValues() {
  log('\n=== Test 5: Default Values ===', 'blue');
  
  try {
    // Insert a minimal record to test defaults
    const testTicker = 'TEST' + Date.now().toString().slice(-12);
    
    const created = await prisma.filingDetectionState.create({
      data: {
        ticker: testTicker,
        lastCheckDate: new Date(),
      },
    });
    
    // Check defaults
    let allDefaultsValid = true;
    
    if (created.checkCount !== 0) {
      logError(`check_count default is ${created.checkCount}, expected 0`);
      allDefaultsValid = false;
    } else {
      logSuccess('check_count defaults to 0');
    }
    
    if (created.consecutiveFailures !== 0) {
      logError(`consecutive_failures default is ${created.consecutiveFailures}, expected 0`);
      allDefaultsValid = false;
    } else {
      logSuccess('consecutive_failures defaults to 0');
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
    
    // Clean up
    await prisma.filingDetectionState.delete({
      where: { ticker: testTicker },
    });
    
    logInfo('Test record cleaned up');
    
    return allDefaultsValid;
  } catch (error) {
    logError(`Error testing default values: ${error.message}`);
    return false;
  }
}

async function testCRUDOperations() {
  log('\n=== Test 6: CRUD Operations ===', 'blue');
  
  // Use shorter ticker name (max 20 chars)
  const testTicker = 'CRUD' + Date.now().toString().slice(-10);
  
  try {
    // CREATE
    logInfo('Testing CREATE...');
    const created = await prisma.filingDetectionState.create({
      data: {
        ticker: testTicker,
        lastCheckDate: new Date(),
        lastFilingDate: new Date('2024-01-15'),
        checkCount: 5,
        consecutiveFailures: 0,
      },
    });
    
    if (created.ticker === testTicker) {
      logSuccess('CREATE operation successful');
    } else {
      logError('CREATE operation failed');
      return false;
    }
    
    // READ
    logInfo('Testing READ...');
    const read = await prisma.filingDetectionState.findUnique({
      where: { ticker: testTicker },
    });
    
    if (read && read.ticker === testTicker && read.checkCount === 5) {
      logSuccess('READ operation successful');
    } else {
      logError('READ operation failed');
      return false;
    }
    
    // UPDATE
    logInfo('Testing UPDATE...');
    const updated = await prisma.filingDetectionState.update({
      where: { ticker: testTicker },
      data: {
        checkCount: 10,
        consecutiveFailures: 2,
      },
    });
    
    if (updated.checkCount === 10 && updated.consecutiveFailures === 2) {
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
    await prisma.filingDetectionState.delete({
      where: { ticker: testTicker },
    });
    
    const deleted = await prisma.filingDetectionState.findUnique({
      where: { ticker: testTicker },
    });
    
    if (!deleted) {
      logSuccess('DELETE operation successful');
    } else {
      logError('DELETE operation failed');
      return false;
    }
    
    return true;
  } catch (error) {
    logError(`Error testing CRUD operations: ${error.message}`);
    
    // Clean up on error
    try {
      await prisma.filingDetectionState.delete({
        where: { ticker: testTicker },
      });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    return false;
  }
}

async function testConstraints() {
  log('\n=== Test 7: Constraints ===', 'blue');
  
  const testTicker = 'CONS' + Date.now().toString().slice(-12);
  
  try {
    // Test primary key uniqueness
    logInfo('Testing primary key uniqueness...');
    
    await prisma.filingDetectionState.create({
      data: {
        ticker: testTicker,
        lastCheckDate: new Date(),
      },
    });
    
    try {
      await prisma.filingDetectionState.create({
        data: {
          ticker: testTicker, // Duplicate ticker
          lastCheckDate: new Date(),
        },
      });
      
      logError('Primary key constraint not enforced (duplicate allowed)');
      
      // Clean up
      await prisma.filingDetectionState.deleteMany({
        where: { ticker: testTicker },
      });
      
      return false;
    } catch (error) {
      if (error.code === 'P2002') {
        logSuccess('Primary key constraint enforced (duplicate rejected)');
      } else {
        logError(`Unexpected error: ${error.message}`);
        return false;
      }
    }
    
    // Clean up
    await prisma.filingDetectionState.delete({
      where: { ticker: testTicker },
    });
    
    return true;
  } catch (error) {
    logError(`Error testing constraints: ${error.message}`);
    
    // Clean up on error
    try {
      await prisma.filingDetectionState.deleteMany({
        where: { ticker: testTicker },
      });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    return false;
  }
}

async function testUpsertOperation() {
  log('\n=== Test 8: UPSERT Operation ===', 'blue');
  
  const testTicker = 'UPS' + Date.now().toString().slice(-13);
  
  try {
    // First upsert (should create)
    logInfo('Testing UPSERT (create)...');
    const created = await prisma.filingDetectionState.upsert({
      where: { ticker: testTicker },
      create: {
        ticker: testTicker,
        lastCheckDate: new Date(),
        checkCount: 1,
      },
      update: {
        checkCount: { increment: 1 },
      },
    });
    
    if (created.checkCount === 1) {
      logSuccess('UPSERT create successful');
    } else {
      logError('UPSERT create failed');
      return false;
    }
    
    // Second upsert (should update)
    logInfo('Testing UPSERT (update)...');
    const updated = await prisma.filingDetectionState.upsert({
      where: { ticker: testTicker },
      create: {
        ticker: testTicker,
        lastCheckDate: new Date(),
        checkCount: 1,
      },
      update: {
        checkCount: { increment: 1 },
        lastCheckDate: new Date(),
      },
    });
    
    if (updated.checkCount === 2) {
      logSuccess('UPSERT update successful');
    } else {
      logError(`UPSERT update failed (checkCount: ${updated.checkCount})`);
      return false;
    }
    
    // Clean up
    await prisma.filingDetectionState.delete({
      where: { ticker: testTicker },
    });
    
    logInfo('Test record cleaned up');
    
    return true;
  } catch (error) {
    logError(`Error testing UPSERT: ${error.message}`);
    
    // Clean up on error
    try {
      await prisma.filingDetectionState.delete({
        where: { ticker: testTicker },
      });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    return false;
  }
}

async function runAllTests() {
  log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║  Filing Detection State Migration Test Suite              ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════╝', 'cyan');
  
  const results = {
    tableExists: false,
    columns: false,
    primaryKey: false,
    indexes: false,
    defaultValues: false,
    crudOperations: false,
    constraints: false,
    upsertOperation: false,
  };
  
  try {
    results.tableExists = await testTableExists();
    
    if (results.tableExists) {
      results.columns = await testColumns();
      results.primaryKey = await testPrimaryKey();
      results.indexes = await testIndexes();
      results.defaultValues = await testDefaultValues();
      results.crudOperations = await testCRUDOperations();
      results.constraints = await testConstraints();
      results.upsertOperation = await testUpsertOperation();
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
    defaultValues: 'Default Values',
    crudOperations: 'CRUD Operations',
    constraints: 'Constraints',
    upsertOperation: 'UPSERT Operation',
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
