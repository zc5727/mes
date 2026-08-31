import { Global, Module } from '@nestjs/common';
import { MqttStatePersistenceService } from './mqtt-state-persistence.service';
import { PrismaService } from './prisma.service';
import { CorePersistenceService } from './core-persistence.service';
import { FoundationPersistenceService } from './foundation-persistence.service';
import { InventoryPersistenceService } from './inventory-persistence.service';

@Global()
@Module({
  providers: [PrismaService, MqttStatePersistenceService, CorePersistenceService, FoundationPersistenceService, InventoryPersistenceService],
  exports: [PrismaService, MqttStatePersistenceService, CorePersistenceService, FoundationPersistenceService, InventoryPersistenceService],
})
export class DatabaseModule {}
