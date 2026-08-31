import { execFileSync } from 'node:child_process';
import { Prisma, PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; export it before running db:verify-runtime');

try {
  execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { stdio: 'inherit' });
} catch {
  console.error('Database migration deployment failed. Start PostgreSQL and verify DATABASE_URL before retrying.');
  process.exit(1);
}

const expectedTables = [
  'factories', 'production_lines', 'devices', 'production_orders', 'work_orders',
  'work_order_reports', 'alarms', 'device_events', 'current_states', 'connection_events',
  'quality_records', 'maintenance_work_orders', 'document_records', 'batch_inventories',
  'foundation_aux_records', 'device_profiles', 'device_connections',
  'device_connection_status_events', 'strategy_runs', 'strategy_candidates',
  'audit_events', 'audit_approvals',
];
const prisma = new PrismaClient();
try {
  const rows = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${Prisma.join(expectedTables)})`;
  const actual = new Set(rows.map((row) => row.table_name));
  const missing = expectedTables.filter((table) => !actual.has(table));
  if (missing.length) throw new Error(`Missing required tables: ${missing.join(', ')}`);
  await prisma.$queryRaw`SELECT 1`;
  console.log(`Database runtime verification passed: ${expectedTables.length} required tables are present`);
} catch (error) {
  console.error(`Database runtime verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
