import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../src/audit/audit.service';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';
import {
  normalizeSimulatorControlCommand,
  SimulatorControlDto,
  validateSimulatorControlCommand,
} from '../src/mqtt/simulator-control.dto';
import { SimulatorControlController } from '../src/mqtt/simulator-control.controller';
import { StrategyAuthorizationService } from '../src/strategies/strategy-authorization.service';

describe('simulator control API contract', () => {
  const identity = ['operator-1', 'equipment_supervisor', 'factory-demo', '*', 'session-1', 'trace-001'] as const;

  it('accepts the frontend fault payload and publishes it unchanged', async () => {
    const mqtt = { publishSimulatorControl: jest.fn().mockResolvedValue('cmd-1') } as unknown as MqttIngestionService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const controller = new SimulatorControlController(mqtt, audit, new StrategyAuthorizationService());
    const command: SimulatorControlDto = {
      action: 'fault', lineId: 'line-cnc', deviceId: 'cnc-01', faultType: 'OVERHEAT', requestedBy: 'digital-twin-ui',
    };

    await expect(controller.control('tenant-demo', command, ...identity)).resolves.toMatchObject({
      tenantId: 'tenant-demo', data: { accepted: true, action: 'fault', normalizedAction: 'fault', commandId: 'cmd-1' },
    });
    expect(mqtt.publishSimulatorControl).toHaveBeenCalledWith('tenant-demo', command);
    expect(audit.record).toHaveBeenCalled();
  });

  it('accepts recover as an API alias and publishes simulator reset', async () => {
    const mqtt = { publishSimulatorControl: jest.fn().mockResolvedValue('cmd-2') } as unknown as MqttIngestionService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const controller = new SimulatorControlController(mqtt, audit, new StrategyAuthorizationService());

    await expect(controller.control('tenant-demo', { action: 'recover' }, ...identity)).resolves.toMatchObject({
      data: { action: 'recover', normalizedAction: 'reset', commandId: 'cmd-2' },
    });
    expect(mqtt.publishSimulatorControl).toHaveBeenCalledWith('tenant-demo', { action: 'reset' });
  });

  it('accepts scoped reset/recover commands while retaining global reset', async () => {
    const mqtt = { publishSimulatorControl: jest.fn().mockResolvedValue('cmd-3') } as unknown as MqttIngestionService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const controller = new SimulatorControlController(mqtt, audit, new StrategyAuthorizationService());

    await controller.control('tenant-demo', {
      action: 'reset', lineId: 'line-cnc', deviceId: 'cnc-01', faultType: 'OVERHEAT',
    }, ...identity);
    await controller.control('tenant-demo', {
      action: 'recover', lineId: 'line-cnc', deviceId: 'cnc-01', faultType: 'OVERHEAT',
    }, ...identity);

    expect(mqtt.publishSimulatorControl).toHaveBeenNthCalledWith(1, 'tenant-demo', expect.objectContaining({
      action: 'reset', lineId: 'line-cnc', deviceId: 'cnc-01', faultType: 'OVERHEAT',
    }));
    expect(mqtt.publishSimulatorControl).toHaveBeenNthCalledWith(2, 'tenant-demo', expect.objectContaining({
      action: 'reset', lineId: 'line-cnc', deviceId: 'cnc-01', faultType: 'OVERHEAT',
    }));
    expect(() => validateSimulatorControlCommand({ action: 'reset', deviceId: 'cnc-01' })).toThrow(BadRequestException);
    expect(() => validateSimulatorControlCommand({ action: 'recover', lineId: 'line-cnc', faultType: 'OVERHEAT' })).toThrow(BadRequestException);
  });

  it('rejects incomplete fault commands before MQTT publishing', () => {
    expect(() => validateSimulatorControlCommand({ action: 'fault' })).toThrow(BadRequestException);
    expect(normalizeSimulatorControlCommand({ action: 'reset' })).toEqual({ action: 'reset' });
  });

  it('fails closed for missing or read-only identity', async () => {
    const mqtt = {
      publishSimulatorControl: jest.fn(),
    } as unknown as MqttIngestionService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const controller = new SimulatorControlController(
      mqtt,
      audit,
      new StrategyAuthorizationService(),
    );

    await expect(controller.control('tenant-demo', { action: 'start' }))
      .rejects.toThrow('AUTH_REQUIRED');
    await expect(controller.control(
      'tenant-demo',
      { action: 'start' },
      'viewer',
      'auditor',
      'factory-demo',
      '*',
      'session-2',
      'trace-2',
    )).rejects.toThrow('ROLE_FORBIDDEN');
    expect(mqtt.publishSimulatorControl).not.toHaveBeenCalled();
  });
});
