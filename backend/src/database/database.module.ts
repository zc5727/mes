import { Global, Module } from '@nestjs/common';
import { MqttStatePersistenceService } from './mqtt-state-persistence.service';
import { PrismaService } from './prisma.service';
import { CorePersistenceService } from './core-persistence.service';
import { FoundationPersistenceService } from './foundation-persistence.service';

@Global()
@Module({
  providers: [PrismaService, MqttStatePersistenceService, CorePersistenceService, FoundationPersistenceService],
  exports: [PrismaService, MqttStatePersistenceService, CorePersistenceService, FoundationPersistenceService],
})
export class DatabaseModule {}
