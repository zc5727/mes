import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { MqttIngestionService } from './mqtt-ingestion.service';
import {
  normalizeSimulatorControlCommand,
  SimulatorControlDto,
  validateSimulatorControlCommand,
} from './simulator-control.dto';
import { AuditService } from '../audit/audit.service';

@Controller('simulator')
export class SimulatorControlController {
  constructor(private readonly mqtt: MqttIngestionService, private readonly audit: AuditService) {}

  @Post('control')
  @HttpCode(HttpStatus.ACCEPTED)
  async control(@TenantId() tenantId: string, @Body() command: SimulatorControlDto) {
    validateSimulatorControlCommand(command);
    const normalizedCommand = normalizeSimulatorControlCommand(command);
    const commandId = await this.mqtt.publishSimulatorControl(tenantId, normalizedCommand);
    this.audit.record(tenantId, command.requestedBy ?? 'api-user', {
      action: `simulator.${command.action}`,
      resource: 'simulator',
      resourceId: commandId,
      details: { ...command, normalizedAction: normalizedCommand.action, commandId },
    });
    return {
      data: {
        accepted: true,
        action: command.action,
        normalizedAction: normalizedCommand.action,
        tenantId,
        topic: `mes/control/${tenantId}/simulator/command`,
        commandId,
      },
      tenantId,
    };
  }
}
