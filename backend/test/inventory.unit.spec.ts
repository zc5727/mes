import { ConflictException, NotFoundException } from '@nestjs/common';
import { InventoryService } from '../src/inventory/inventory.service';

describe('InventoryService', () => {
  it('maintains batch balances and an idempotent movement ledger', () => {
    const service = new InventoryService();
    service.createMaterial('tenant-demo', 'factory-demo', { code: 'MAT-001', name: 'Steel', unit: 'kg' });
    service.createLocation('tenant-demo', 'factory-demo', { warehouseCode: 'WH-01', locationCode: 'A-01' });

    const receipt = service.receipt('tenant-demo', 'factory-demo', {
      materialCode: 'MAT-001', batchNo: 'B-001', locationCode: 'A-01', quantity: 100, idempotencyKey: 'receipt-1', traceId: 'trace-1',
    });
    expect(receipt.delta).toBe(100);
    expect(service.receipt('tenant-demo', 'factory-demo', {
      materialCode: 'MAT-001', batchNo: 'B-001', locationCode: 'A-01', quantity: 100, idempotencyKey: 'receipt-1', traceId: 'trace-1',
    })).toEqual(receipt);

    service.issue('tenant-demo', 'factory-demo', {
      materialCode: 'MAT-001', batchNo: 'B-001', locationCode: 'A-01', quantity: 30, idempotencyKey: 'issue-1', workOrderId: 'WO-001',
    });
    expect(service.listBalances('tenant-demo', 'factory-demo', {})).toMatchObject([
      { materialCode: 'MAT-001', batchNo: 'B-001', locationCode: 'A-01', quantity: 70 },
    ]);
    expect(service.listLedger('tenant-demo', 'factory-demo')).toHaveLength(2);
  });

  it('rejects unknown master data and negative balances', () => {
    const service = new InventoryService();
    expect(() => service.receipt('tenant-demo', 'factory-demo', {
      materialCode: 'MISSING', batchNo: 'B-001', locationCode: 'A-01', quantity: 1, idempotencyKey: 'r-1',
    })).toThrow(NotFoundException);

    service.createMaterial('tenant-demo', 'factory-demo', { code: 'MAT-001', name: 'Steel', unit: 'kg' });
    service.createLocation('tenant-demo', 'factory-demo', { warehouseCode: 'WH-01', locationCode: 'A-01' });
    expect(() => service.issue('tenant-demo', 'factory-demo', {
      materialCode: 'MAT-001', batchNo: 'B-001', locationCode: 'A-01', quantity: 1, idempotencyKey: 'i-1',
    })).toThrow(ConflictException);
  });

  it('records count variance without changing the ledger twice', () => {
    const service = new InventoryService();
    service.createMaterial('tenant-demo', 'factory-demo', { code: 'MAT-001', name: 'Steel', unit: 'kg' });
    service.createLocation('tenant-demo', 'factory-demo', { warehouseCode: 'WH-01', locationCode: 'A-01' });
    service.receipt('tenant-demo', 'factory-demo', {
      materialCode: 'MAT-001', batchNo: 'B-001', locationCode: 'A-01', quantity: 10, idempotencyKey: 'r-1',
    });
    const count = { materialCode: 'MAT-001', batchNo: 'B-001', locationCode: 'A-01', countedQuantity: 8, idempotencyKey: 'count-1' };
    const first = service.count('tenant-demo', 'factory-demo', count);
    expect(first.variance).toBe(-2);
    expect(service.count('tenant-demo', 'factory-demo', count)).toEqual(first);
    expect(service.listLedger('tenant-demo', 'factory-demo')).toHaveLength(2);
  });
});
