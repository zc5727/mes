import { Module } from '@nestjs/common';
import { DEVICE_CONNECTION_PROBE } from './device-connection.constants';
import { DeviceConnectionsController } from './device-connections.controller';
import { DeviceConnectionsService } from './device-connections.service';
import { ProtocolConnectionProbe } from './protocol-connection-probe';

@Module({
  controllers: [DeviceConnectionsController],
  providers: [
    ProtocolConnectionProbe,
    { provide: DEVICE_CONNECTION_PROBE, useExisting: ProtocolConnectionProbe },
    DeviceConnectionsService,
  ],
  exports: [DeviceConnectionsService],
})
export class DeviceConnectionsModule {}
