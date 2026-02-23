const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Fix all expired cache entries by setting expires_at to 2099-12-31
  const result = await prisma.$executeRawUnsafe(`
    UPDATE qualitative_cache 
    SET expires_at = '2099-12-31T00:00:00.000Z', updated_at = NOW()
    WHERE expires_at < '2099-01-01'
  `);
  console.log(`✅ Updated ${result} rows — set expires_at to 2099-12-31`);

  // Verify
  const check = await prisma.$queryRawUnsafe(`
    SELECT ticker, COUNT(*) as cnt, MIN(expires_at) as min_exp, MAX(expires_at) as max_exp
    FROM qualitative_cache 
    GROUP BY ticker
    ORDER BY ticker
  `);
  console.log('\nVerification:');
  for (const row of check) {
    console.log(`  ${row.ticker}: ${Number(row.cnt)} entries, expires ${new Date(row.max_exp).toISOString().split('T')[0]}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
