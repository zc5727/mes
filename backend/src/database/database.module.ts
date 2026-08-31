import { Global, Module } from '@nestjs/common';
import { MqttStatePersistenceService } from './mqtt-state-persistence.service';
import { PrismaService } from './prisma.service';
import { CorePersistenceService } from './core-persistence.service';
import { FoundationPersistenceService } from './foundation-persistence.service';
import { InventoryPersistenceService } from './inventory-persistence.service';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PersistenceFlushInterceptor } from './persistence-flush.interceptor';

@Global()
@Module({
  providers: [
    PrismaService, MqttStatePersistenceService, CorePersistenceService,
    FoundationPersistenceService, InventoryPersistenceService,
    { provide: APP_INTERCEPTOR, useClass: PersistenceFlushInterceptor },
  ],
  exports: [PrismaService, MqttStatePersistenceService, CorePersistenceService, FoundationPersistenceService, InventoryPersistenceService],
})
export class DatabaseModule {}
