import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.tenant.upsert({
    where: { id: 'tenant-demo' },
    update: { name: 'MES演示租户' },
    create: { id: 'tenant-demo', name: 'MES演示租户' },
  });
  await prisma.factory.upsert({
    where: { id: 'factory-demo' },
    update: { name: '华南精密制造一厂' },
    create: { id: 'factory-demo', tenantId: 'tenant-demo', code: 'F001', name: '华南精密制造一厂' },
  });

  const lines = [
    ['line-cnc', 'L001', 'CNC加工线', '机加工'],
    ['line-assembly', 'L002', '精密装配线', '装配'],
    ['line-welding', 'L003', '自动焊接线', '焊接'],
    ['line-vision', 'L004', '视觉检测线', '检测'],
  ] as const;
  for (const [id, code, name, type] of lines) {
    await prisma.productionLine.upsert({
      where: { id },
      update: { name, type },
      create: { id, tenantId: 'tenant-demo', factoryId: 'factory-demo', code, name, type, targetOee: 85 },
    });
  }

  const sources = [
    ['line-cnc', 'cnc'], ['line-assembly', 'asm'], ['line-welding', 'weld'], ['line-vision', 'vision'],
  ] as const;
  for (const [lineId, prefix] of sources) {
    for (let index = 1; index <= 3; index += 1) {
      const sourceId = `${prefix}-${String(index).padStart(2, '0')}`;
      await prisma.device.upsert({
        where: { id: `device-${sourceId}` },
        update: { lineId, name: sourceId.toUpperCase() },
        create: {
          id: `device-${sourceId}`, tenantId: 'tenant-demo', lineId, code: sourceId.toUpperCase(),
          name: sourceId.toUpperCase(), protocol: 'simulator', status: 'offline',
        },
      });
    }
  }
}

main().finally(() => prisma.$disconnect());
