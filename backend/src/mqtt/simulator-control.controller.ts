import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { MqttIngestionService } from './mqtt-ingestion.service';
import { SimulatorControlDto, validateSimulatorControlCommand } from './simulator-control.dto';

@Controller('simulator')
export class SimulatorControlController {
  constructor(private readonly mqtt: MqttIngestionService) {}

  @Post('control')
  @HttpCode(HttpStatus.ACCEPTED)
  async control(@TenantId() tenantId: string, @Body() command: SimulatorControlDto) {
    validateSimulatorControlCommand(command);
    const commandId = await this.mqtt.publishSimulatorControl(tenantId, command);
    return {
      data: {
        accepted: true,
        tenantId,
        topic: `mes/control/${tenantId}/simulator/command`,
        commandId,
      },
      tenantId,
    };
  }
}
