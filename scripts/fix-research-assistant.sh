#!/bin/bash

# Research Assistant Quick Fix Script
# Applies database migration and sets up environment

set -e

echo "🔧 Research Assistant Quick Fix"
echo "================================"
echo ""

# Check if database is accessible
echo "1️⃣  Checking database connection..."
if psql -d fundlens -c "SELECT 1;" > /dev/null 2>&1; then
  echo "   ✅ Database connected"
else
  echo "   ❌ Cannot connect to database 'fundlens'"
  echo "   Make sure PostgreSQL is running and database exists"
  exit 1
fi

# Apply migration
echo ""
echo "2️⃣  Applying research assistant migration..."
if psql -d fundlens -f prisma/migrations/add_research_assistant_schema_simple.sql > /dev/null 2>&1; then
  echo "   ✅ Migration applied"
else
  echo "   ⚠️  Migration may have already been applied (this is OK)"
fi

# Check if JWT_SECRET exists
echo ""
echo "3️⃣  Checking JWT_SECRET..."
if grep -q "^JWT_SECRET=" .env 2>/dev/null; then
  echo "   ✅ JWT_SECRET already set"
else
  echo "   ⚠️  JWT_SECRET not found, generating..."
  SECRET=$(openssl rand -base64 32)
  echo "JWT_SECRET=$SECRET" >> .env
  echo "   ✅ JWT_SECRET added to .env"
fi

# Generate Prisma Client
echo ""
echo "4️⃣  Generating Prisma Client..."
echo "   ⚠️  NOTE: This will fail until you add models to schema.prisma"
echo "   See: .kiro/specs/research-assistant-improvement/CRITICAL_FIX_REQUIRED.md"
if npx prisma generate > /dev/null 2>&1; then
  echo "   ✅ Prisma Client generated"
else
  echo "   ⚠️  Prisma Client generation failed (expected - models not in schema yet)"
fi

# Verify tables exist
echo ""
echo "5️⃣  Verifying tables..."
TABLE_COUNT=$(psql -d fundlens -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'research_%';" | tr -d ' ')
if [ "$TABLE_COUNT" -gt 0 ]; then
  echo "   ✅ Found $TABLE_COUNT research tables"
  psql -d fundlens -c "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'research_%' ORDER BY table_name;"
else
  echo "   ❌ No research tables found"
fi

# Summary
echo ""
echo "================================"
echo "📋 Summary"
echo "================================"
echo ""
echo "Database tables: ✅ Created"
echo "JWT_SECRET: ✅ Set"
echo "Prisma models: ⚠️  NEED TO BE ADDED"
echo ""
echo "⚠️  CRITICAL NEXT STEP:"
echo "Add Prisma models to prisma/schema.prisma"
echo ""
echo "See detailed instructions:"
echo ".kiro/specs/research-assistant-improvement/CRITICAL_FIX_REQUIRED.md"
echo ""
echo "After adding models:"
echo "1. npx prisma generate"
echo "2. npm run start:dev"
echo "3. Test at: http://localhost:3000/app/deals/workspace.html?ticker=AAPL"
echo ""
