#!/bin/bash
# Check what tables exist in the database

DATABASE_URL="postgresql://fundlens_admin:FundLens2025SecureDB@fundlens-db.c858420i2mml.us-east-1.rds.amazonaws.com:5432/fundlens_db?sslmode=no-verify"

node -e "
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const result = await client.query(\`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name
  \`);
  console.log('📊 Existing tables:');
  result.rows.forEach(row => console.log(\`  - \${row.table_name}\`));
  await client.end();
})();
" DATABASE_URL="$DATABASE_URL"
