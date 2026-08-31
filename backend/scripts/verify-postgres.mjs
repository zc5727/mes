import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; export it before running verify:postgres');
try {
  execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { stdio: 'inherit' });
} catch {
  console.error(`PostgreSQL migration check failed for ${process.env.DATABASE_URL}. Start PostgreSQL, verify DATABASE_URL, then rerun npm run verify:postgres.`);
  process.exit(1);
}
const prisma = new PrismaClient();
try {
  await prisma.$queryRaw`SELECT 1`;
  console.log('PostgreSQL migration and connectivity check passed');
} catch (error) {
  console.error(`PostgreSQL connectivity check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
