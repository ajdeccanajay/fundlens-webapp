// @ts-nocheck
// This seed file uses old schema models and is temporarily disabled
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create sample companies
  const apple = await prisma.company.upsert({
    where: { cik: '0000320193' },
    update: {},
    create: {
      cik: '0000320193',
      ticker: 'AAPL',
      name: 'Apple Inc.',
      sic: '3571',
      sicDescription: 'Electronic Computers',
      category: 'Domestic',
      state: 'CA',
      city: 'Cupertino',
      zip: '95014',
      address: 'One Apple Park Way',
      phone: '408-996-1010',
      website: 'https://www.apple.com',
      sector: 'Technology',
      industry: 'Consumer Electronics',
      employees: 164000,
    },
  });

  const microsoft = await prisma.company.upsert({
    where: { cik: '0000789019' },
    update: {},
    create: {
      cik: '0000789019',
      ticker: 'MSFT',
      name: 'Microsoft Corporation',
      sic: '7372',
      sicDescription: 'Prepackaged Software',
      category: 'Domestic',
      state: 'WA',
      city: 'Redmond',
      zip: '98052',
      address: 'One Microsoft Way',
      phone: '425-882-8080',
      website: 'https://www.microsoft.com',
      sector: 'Technology',
      industry: 'Software',
      employees: 221000,
    },
  });

  const amazon = await prisma.company.upsert({
    where: { cik: '0001018724' },
    update: {},
    create: {
      cik: '0001018724',
      ticker: 'AMZN',
      name: 'Amazon.com Inc.',
      sic: '5961',
      sicDescription: 'Catalog and Mail-Order Houses',
      category: 'Domestic',
      state: 'WA',
      city: 'Seattle',
      zip: '98109',
      address: '410 Terry Avenue North',
      phone: '206-266-1000',
      website: 'https://www.amazon.com',
      sector: 'Consumer Cyclical',
      industry: 'Internet Retail',
      employees: 1608000,
    },
  });

  // Create sample SEC filings
  const appleFiling = await prisma.secFiling.upsert({
    where: { accessionNumber: '0000320193-24-000123' },
    update: {},
    create: {
      companyId: apple.id,
      form: '10-K',
      filingDate: new Date('2024-11-01'),
      reportDate: new Date('2024-09-28'),
      accessionNumber: '0000320193-24-000123',
      primaryDocument: 'aapl-20240928.htm',
      url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm',
      isProcessed: true,
      processingDate: new Date(),
    },
  });

  // Create sample financial facts
  const appleRevenue = await prisma.financialFact.upsert({
    where: { 
      id: 'apple-revenue-2024' // Use a simple ID for upsert
    },
    update: {},
    create: {
      id: 'apple-revenue-2024',
      companyId: apple.id,
      tag: 'Revenues',
      taxonomy: 'us-gaap',
      unit: 'USD',
      value: 394328000000, // $394.328 billion
      startDate: new Date('2023-09-30'),
      endDate: new Date('2024-09-28'),
      periodType: 'duration',
      sourceFilingId: appleFiling.id,
    },
  });

  // Create sample news articles
  const appleNews = await prisma.newsArticle.upsert({
    where: { url: 'https://example.com/apple-q4-earnings-2024' },
    update: {},
    create: {
      companyId: apple.id,
      title: 'Apple Reports Record Q4 Earnings Driven by iPhone Sales',
      url: 'https://example.com/apple-q4-earnings-2024',
      source: 'Reuters',
      type: 'earnings',
      publishedAt: new Date('2024-11-01T10:30:00Z'),
      summary: 'Apple Inc. reported record fourth-quarter earnings...',
      isProcessed: true,
      keywords: ['earnings', 'iPhone', 'revenue', 'growth'],
    },
  });

  // Create sample user
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@fundlens.com' },
    update: {},
    create: {
      email: 'admin@fundlens.com',
      name: 'FundLens Admin',
      role: 'ADMIN',
      isActive: true,
      preferences: {
        defaultCurrency: 'USD',
        defaultTimeframe: '1Y',
        notifications: true,
      },
    },
  });

  console.log('✅ Database seeded successfully!');
  console.log(`   Companies: 3`);
  console.log(`   SEC Filings: 1`);
  console.log(`   Financial Facts: 1`);
  console.log(`   News Articles: 1`);
  console.log(`   Users: 1`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 