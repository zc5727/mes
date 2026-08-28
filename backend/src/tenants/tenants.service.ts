import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createId, MockEntity, timestamp } from '../common/mock.types';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

export interface Tenant extends MockEntity {
  code: string;
  name: string;
  industry: string;
  timezone: string;
  status: 'active' | 'suspended';
}

@Injectable()
export class TenantsService {
  private readonly tenants = new Map<string, Tenant>([
    [
      'tenant-demo',
      {
        id: 'tenant-demo',
        tenantId: 'tenant-demo',
        code: 'DEMO',
        name: '示范制造工厂',
        industry: '精密制造',
        timezone: 'Asia/Shanghai',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  ]);

  findAll(): Tenant[] {
    return [...this.tenants.values()];
  }

  findOne(id: string): Tenant {
    const tenant = this.tenants.get(id);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} not found`);
    }

    return tenant;
  }

  create(dto: CreateTenantDto): Tenant {
    const duplicate = [...this.tenants.values()].some((tenant) => tenant.code === dto.code);
    if (duplicate) {
      throw new ConflictException(`Tenant code ${dto.code} already exists`);
    }

    const now = timestamp();
    const tenant: Tenant = {
      id: createId('tenant'),
      tenantId: '',
      code: dto.code,
      name: dto.name,
      industry: dto.industry ?? '制造业',
      timezone: dto.timezone ?? 'Asia/Shanghai',
      status: dto.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    };
    tenant.tenantId = tenant.id;
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  update(id: string, dto: UpdateTenantDto): Tenant {
    const current = this.findOne(id);
    if (dto.code && dto.code !== current.code) {
      const duplicate = [...this.tenants.values()].some((tenant) => tenant.code === dto.code);
      if (duplicate) {
        throw new ConflictException(`Tenant code ${dto.code} already exists`);
      }
    }

    const updated: Tenant = {
      ...current,
      ...dto,
      updatedAt: timestamp(),
    };
    this.tenants.set(id, updated);
    return updated;
  }

  remove(id: string): { id: string; deleted: true } {
    this.findOne(id);
    this.tenants.delete(id);
    return { id, deleted: true };
  }
}
