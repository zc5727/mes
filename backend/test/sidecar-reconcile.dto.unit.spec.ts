import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SidecarReconcileDto } from '../src/integrations/sidecar/dto/sidecar-reconcile.dto';

describe('SidecarReconcileDto', () => {
  it('accepts a typed reconciliation payload', async () => {
    const errors = await validate(plainToInstance(SidecarReconcileDto, {
      domain: 'work-orders',
      local: [{ id: 'wo-1', plannedQty: 10, completedQty: 4 }],
      fixture: [{ id: 'remote-1', externalId: 'ERP-1', quantity: 4.5 }],
    }));

    expect(errors).toHaveLength(0);
  });

  it('rejects unknown domains and malformed reconciliation items', async () => {
    const errors = await validate(plainToInstance(SidecarReconcileDto, {
      domain: 'unknown',
      local: [{ id: '', plannedQty: -1 }],
    }));

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['domain', 'local']),
    );
  });
});
