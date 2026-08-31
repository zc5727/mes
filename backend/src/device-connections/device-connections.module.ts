import { Module } from '@nestjs/common';
import { DEVICE_CONNECTION_PROBE } from './device-connection.constants';
import { DeviceConnectionsController } from './device-connections.controller';
import { DeviceConnectionsService } from './device-connections.service';
import { DeviceConnectionPersistenceService } from './device-connection-persistence.service';
import { ProtocolConnectionProbe } from './protocol-connection-probe';
import { DeviceProfilesModule } from '../device-profiles/device-profiles.module';

@Module({
  imports: [DeviceProfilesModule],
  controllers: [DeviceConnectionsController],
  providers: [
    ProtocolConnectionProbe,
    DeviceConnectionPersistenceService,
    { provide: DEVICE_CONNECTION_PROBE, useExisting: ProtocolConnectionProbe },
    DeviceConnectionsService,
  ],
  exports: [DeviceConnectionsService],
})
export class DeviceConnectionsModule {}
