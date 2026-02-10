/**
 * Apply filing detection migration
 * 
 * This script applies the filing_detection_state and filing_notifications
 * table migrations to the database.
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function applyMigration() {
  log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║  Applying Filing Detection Migration                      ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════╝', 'cyan');
  
  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, '..', 'prisma', 'migrations', 'add_filing_detection_tables.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    log('\nReading migration file...', 'cyan');
    log(`  Path: ${migrationPath}`, 'cyan');
    
    // Parse SQL statements properly - handle multi-line statements
    const statements = [];
    let currentStatement = '';
    const lines = migrationSQL.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and comment-only lines
      if (!trimmedLine || trimmedLine.startsWith('--')) {
        continue;
      }
      
      // Add line to current statement
      currentStatement += line + '\n';
      
      // If line ends with semicolon, we have a complete statement
      if (trimmedLine.endsWith(';')) {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
    }
    
    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }
    
    log(`\nFound ${statements.length} SQL statements to execute`, 'cyan');
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Determine statement type
      const statementType = statement.substring(0, 20).replace(/\n/g, ' ').replace(/\s+/g, ' ');
      log(`\n[${i + 1}/${statements.length}] ${statementType}...`, 'cyan');
      
      try {
        await prisma.$executeRawUnsafe(statement);
        log(`  ✓ Success`, 'green');
      } catch (error) {
        // Check if error is "already exists"
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          log(`  ⚠ Already exists (skipping)`, 'cyan');
        } else {
          log(`  ✗ Error: ${error.message}`, 'red');
          throw error;
        }
      }
    }
    
    log('\n✓ Migration applied successfully!', 'green');
    
    // Verify tables exist
    log('\nVerifying tables...', 'cyan');
    
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('filing_detection_state', 'filing_notifications')
      ORDER BY table_name;
    `;
    
    log(`  Found ${tables.length} tables:`, 'green');
    tables.forEach(t => log(`    - ${t.table_name}`, 'green'));
    
    if (tables.length === 2) {
      log('\n✓ All tables created successfully!', 'green');
      return 0;
    } else {
      log('\n✗ Some tables are missing!', 'red');
      return 1;
    }
    
  } catch (error) {
    log(`\n✗ Error applying migration: ${error.message}`, 'red');
    console.error(error);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
applyMigration()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(error => {
    log(`\n✗ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });
