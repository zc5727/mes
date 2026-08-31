import { Global, Module } from '@nestjs/common';
import { MqttStatePersistenceService } from './mqtt-state-persistence.service';
import { PrismaService } from './prisma.service';
import { CorePersistenceService } from './core-persistence.service';

@Global()
@Module({
  providers: [PrismaService, MqttStatePersistenceService, CorePersistenceService],
  exports: [PrismaService, MqttStatePersistenceService, CorePersistenceService],
})
export class DatabaseModule {}
