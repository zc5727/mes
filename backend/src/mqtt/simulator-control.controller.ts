import { RequireCapability } from '../common/route-capability.decorator';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { StrategyAuthorizationService } from '../strategies/strategy-authorization.service';
import { StrategyRequestContext } from '../strategies/strategy.types';
import { AuditService } from '../audit/audit.service';
import { MqttIngestionService } from './mqtt-ingestion.service';
import {
  normalizeSimulatorControlCommand,
  SimulatorControlDto,
  validateSimulatorControlCommand,
} from './simulator-control.dto';

@Controller('simulator')
@RequireCapability('control')
export class SimulatorControlController {
  constructor(
    private readonly mqtt: MqttIngestionService,
    private readonly audit: AuditService,
    private readonly authorization: StrategyAuthorizationService,
  ) {}

  @Post('control')
  @HttpCode(HttpStatus.ACCEPTED)
  async control(
    @TenantId() tenantId: string,
    @Body() command: SimulatorControlDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.authorization.fromHeaders({
      userId,
      role,
      factoryId,
      scope,
      sessionId,
      traceId,
    });
    this.authorization.assertCanControlSimulator(context);
    validateSimulatorControlCommand(command);
    this.authorization.assertSimulatorCommandAccess(context, command);

    const normalizedCommand = normalizeSimulatorControlCommand(command);
    const commandId = await this.mqtt.publishSimulatorControl(
      tenantId,
      normalizedCommand,
    );
    this.audit.record(tenantId, context.userId, {
      action: `simulator.${command.action}`,
      resource: 'simulator',
      resourceId: commandId,
      operator: context.userId,
      traceId: context.traceId,
      details: {
        ...command,
        requestedBy: context.userId,
        normalizedAction: normalizedCommand.action,
        commandId,
      },
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
