import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createId, MockEntity, timestamp } from '../common/mock.types';
import { CreateFactoryDto } from './dto/create-factory.dto';
import { UpdateFactoryDto } from './dto/update-factory.dto';

export interface Factory extends MockEntity {
  code: string;
  name: string;
  address: string;
  manager: string;
  timezone: string;
  status: 'active' | 'inactive';
}

@Injectable()
export class FactoriesService {
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
    return updated;
  }

  remove(tenantId: string, id: string): { id: string; deleted: true } {
    this.findOne(tenantId, id);
    this.factories.delete(id);
    return { id, deleted: true };
  }
}
