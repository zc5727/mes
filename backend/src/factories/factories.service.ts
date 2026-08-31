import { ConflictException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { CorePersistenceService } from '../database/core-persistence.service';
import { createId, MockEntity, timestamp } from '../common/mock.types';
import { CreateFactoryDto } from './dto/create-factory.dto';
import { UpdateFactoryDto } from './dto/update-factory.dto';
import { AuditService } from '../audit/audit.service';

export interface Factory extends MockEntity {
  code: string;
  name: string;
  address: string;
  manager: string;
  timezone: string;
  status: 'active' | 'inactive';
}

@Injectable()
export class FactoriesService implements OnModuleInit {
  constructor(
    @Optional() private readonly persistence?: CorePersistenceService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const snapshot = await this.persistence?.restore();
    if (this.persistence?.isEnabled?.()) this.factories.clear();
    if (snapshot?.factories.length) {
      this.factories.clear();
      snapshot.factories.forEach((item) => this.factories.set(item.id, { ...item, address: '', manager: '', timezone: 'Asia/Shanghai', status: 'active' }));
    }
  }
  private readonly factories = new Map<string, Factory>([
    [
      'factory-demo',
      {
        id: 'factory-demo',
        tenantId: 'tenant-demo',
        code: 'F001',
        name: '华南精密制造一厂',
        address: '广东省广州市南沙区',
        manager: '李厂长',
        timezone: 'Asia/Shanghai',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  ]);

  findAll(tenantId: string): Factory[] {
    return [...this.factories.values()].filter((factory) => factory.tenantId === tenantId);
  }

  findOne(tenantId: string, id: string): Factory {
    const factory = this.factories.get(id);
    if (!factory || factory.tenantId !== tenantId) {
      throw new NotFoundException(`Factory ${id} not found`);
    }

    return factory;
  }

  create(tenantId: string, dto: CreateFactoryDto): Factory {
    const duplicate = this.findAll(tenantId).some((factory) => factory.code === dto.code);
    if (duplicate) {
      throw new ConflictException(`Factory code ${dto.code} already exists in tenant ${tenantId}`);
    }

    const now = timestamp();
    const factory: Factory = {
      id: createId('factory'),
      tenantId,
      code: dto.code,
      name: dto.name,
      address: dto.address ?? '',
      manager: dto.manager ?? '',
      timezone: dto.timezone ?? 'Asia/Shanghai',
      status: dto.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.factories.set(factory.id, factory);
    void this.persistence?.saveFactory(factory);
    this.audit?.record(tenantId, 'system', {
      action: 'factory.created',
      resource: 'factory',
      resourceId: factory.id,
      after: factory as unknown as Record<string, unknown>,
      details: { code: factory.code },
    });
    return factory;
  }

  update(tenantId: string, id: string, dto: UpdateFactoryDto): Factory {
    const current = this.findOne(tenantId, id);
    if (dto.code && dto.code !== current.code) {
      const duplicate = this.findAll(tenantId).some((factory) => factory.code === dto.code);
      if (duplicate) {
        throw new ConflictException(`Factory code ${dto.code} already exists in tenant ${tenantId}`);
      }
    }

    const updated: Factory = { ...current, ...dto, updatedAt: timestamp() };
    this.factories.set(id, updated);
    void this.persistence?.saveFactory(updated);
    this.audit?.record(tenantId, 'system', {
      action: 'factory.updated',
      resource: 'factory',
      resourceId: id,
      before: current as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      details: { code: updated.code },
    });
    return updated;
  }

  remove(tenantId: string, id: string): { id: string; deleted: true } {
    const factory = this.findOne(tenantId, id);
    this.factories.delete(id);
    void this.persistence?.deleteFactory(id);
    this.audit?.record(tenantId, 'system', {
      action: 'factory.deleted',
      resource: 'factory',
      resourceId: id,
      before: factory as unknown as Record<string, unknown>,
      details: { code: factory.code },
    });
    return { id, deleted: true };
  }
}
