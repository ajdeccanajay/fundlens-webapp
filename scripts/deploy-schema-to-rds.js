const { execSync } = require('child_process');
const fs = require('fs');
require('dotenv').config();

const RDS_CONNECTION = 'postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db?sslmode=require';

async function deploySchemaToRDS() {
  console.log('🚀 Deploying Prisma Schema to RDS');
  console.log('');
  
  try {
    // Backup current .env
    const currentEnv = fs.readFileSync('.env', 'utf8');
    fs.writeFileSync('.env.backup', currentEnv);
    console.log('💾 Backed up current .env file');
    
    // Update .env with RDS connection
    const updatedEnv = currentEnv.replace(
      /DATABASE_URL="[^"]*"/,
      `DATABASE_URL="${RDS_CONNECTION}"`
    );
    
    // Add RDS_DATABASE_URL if not exists
    if (!updatedEnv.includes('RDS_DATABASE_URL')) {
      const finalEnv = updatedEnv + `\n# AWS RDS Connection\nRDS_DATABASE_URL="${RDS_CONNECTION}"\n`;
      fs.writeFileSync('.env', finalEnv);
    } else {
      fs.writeFileSync('.env', updatedEnv);
    }
    
    console.log('🔧 Updated .env with RDS connection');
    
    // Generate Prisma client
    console.log('📦 Generating Prisma client...');
    execSync('npx prisma generate', { stdio: 'inherit' });
    
    // Push schema to RDS
    console.log('🏗️  Pushing schema to RDS...');
    execSync('npx prisma db push', { stdio: 'inherit' });
    
    console.log('✅ Schema deployed successfully!');
    
    // Run custom migrations
    console.log('🔄 Running custom migrations...');
    execSync('node scripts/run-migration.js', { stdio: 'inherit' });
    
    console.log('');
    console.log('🎉 RDS Database is fully set up!');
    console.log('');
    console.log('📋 Next steps:');
    console.log('1. Test the application with RDS');
    console.log('2. Migrate existing data if needed');
    console.log('3. Update production environment variables');
    
  } catch (error) {
    console.error('❌ Schema deployment failed:', error.message);
    
    // Restore .env
    if (fs.existsSync('.env.backup')) {
      fs.copyFileSync('.env.backup', '.env');
      console.log('🔄 Restored original .env file');
    }
    
    process.exit(1);
  }
}

deploySchemaToRDS();