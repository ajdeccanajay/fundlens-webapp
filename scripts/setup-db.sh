#!/bin/bash

# FundLens Database Setup Script
# This script helps set up PostgreSQL for the FundLens application

echo "🚀 Setting up FundLens PostgreSQL Database..."

# Check if PostgreSQL is running
if ! pg_isready -q; then
    echo "❌ PostgreSQL is not running. Please start PostgreSQL first."
    echo "   On macOS with Homebrew: brew services start postgresql"
    echo "   On Ubuntu/Debian: sudo systemctl start postgresql"
    exit 1
fi

echo "✅ PostgreSQL is running"

# Database configuration
DB_NAME="fundlens_db"
DB_USER="fundlens_user"
DB_PASSWORD="fundlens_password"

echo "📊 Creating database: $DB_NAME"
echo "👤 Creating user: $DB_USER"

# Create user and database
psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" postgres 2>/dev/null || echo "User $DB_USER already exists"
psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" postgres 2>/dev/null || echo "Database $DB_NAME already exists"

echo "✅ Database setup complete!"

# Display connection information
echo ""
echo "🔗 Database Connection Details:"
echo "   Host: localhost"
echo "   Port: 5432"
echo "   Database: $DB_NAME"
echo "   Username: $DB_USER"
echo "   Password: $DB_PASSWORD"
echo ""
echo "📝 Add this to your .env file:"
echo "   DATABASE_URL=\"postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME?schema=public\""
echo ""
echo "🔄 Next steps:"
echo "   1. Copy the DATABASE_URL to your .env file"
echo "   2. Run: npx prisma db push"
echo "   3. Run: npx prisma generate"
echo "   4. Start your application: npm run start:dev" 