import { Global, Module } from '@nestjs/common';
import { MqttStatePersistenceService } from './mqtt-state-persistence.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, MqttStatePersistenceService],
  exports: [PrismaService, MqttStatePersistenceService],
})
export class DatabaseModule {}
