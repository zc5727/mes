import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../src/audit/audit.service';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';
import {
  normalizeSimulatorControlCommand,
  SimulatorControlDto,
  validateSimulatorControlCommand,
} from '../src/mqtt/simulator-control.dto';
import { SimulatorControlController } from '../src/mqtt/simulator-control.controller';

describe('simulator control API contract', () => {
  it('accepts the frontend fault payload and publishes it unchanged', async () => {
    const mqtt = { publishSimulatorControl: jest.fn().mockResolvedValue('cmd-1') } as unknown as MqttIngestionService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const controller = new SimulatorControlController(mqtt, audit);
    const command: SimulatorControlDto = {
      action: 'fault', lineId: 'line-cnc', deviceId: 'cnc-01', faultType: 'OVERHEAT', requestedBy: 'digital-twin-ui',
    };

    await expect(controller.control('tenant-demo', command)).resolves.toMatchObject({
      tenantId: 'tenant-demo', data: { accepted: true, action: 'fault', normalizedAction: 'fault', commandId: 'cmd-1' },
    });
    expect(mqtt.publishSimulatorControl).toHaveBeenCalledWith('tenant-demo', command);
    expect(audit.record).toHaveBeenCalled();
  });

  it('accepts recover as an API alias and publishes simulator reset', async () => {
    const mqtt = { publishSimulatorControl: jest.fn().mockResolvedValue('cmd-2') } as unknown as MqttIngestionService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const controller = new SimulatorControlController(mqtt, audit);

    await expect(controller.control('tenant-demo', { action: 'recover' })).resolves.toMatchObject({
      data: { action: 'recover', normalizedAction: 'reset', commandId: 'cmd-2' },
    });
    expect(mqtt.publishSimulatorControl).toHaveBeenCalledWith('tenant-demo', { action: 'reset' });
  });

  it('accepts scoped reset/recover commands while retaining global reset', async () => {
    const mqtt = { publishSimulatorControl: jest.fn().mockResolvedValue('cmd-3') } as unknown as MqttIngestionService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const controller = new SimulatorControlController(mqtt, audit);

    await controller.control('tenant-demo', {
      action: 'reset', lineId: 'line-cnc', deviceId: 'cnc-01', faultType: 'OVERHEAT',
    });
    await controller.control('tenant-demo', {
      action: 'recover', lineId: 'line-cnc', deviceId: 'cnc-01', faultType: 'OVERHEAT',
    });

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
});
