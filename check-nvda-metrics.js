const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkMetrics() {
  try {
    // Check what metrics exist for NVDA
    const metrics = await prisma.financialMetric.findMany({
      where: { ticker: 'NVDA' },
      select: { normalizedMetric: true },
      distinct: ['normalizedMetric'],
      take: 20,
    });

    console.log('NVDA metrics in database:');
    console.log(JSON.stringify(metrics, null, 2));

    // Check specifically for revenue
    const revenueMetrics = await prisma.financialMetric.findMany({
      where: {
        ticker: 'NVDA',
        normalizedMetric: { contains: 'revenue', mode: 'insensitive' },
      },
      take: 5,
    });

    console.log('\nRevenue-related metrics:');
    console.log(JSON.stringify(revenueMetrics, null, 2));

    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkMetrics();
