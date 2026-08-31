import { validate } from 'class-validator';
import { CreateDeviceConnectionDto } from '../src/device-connections/dto/device-connection.dto';

describe('device connection DTO', () => {
  it.each([
    ['mqtt', 'mqtt://localhost:1883'],
    ['modbus-tcp', 'modbus-tcp://localhost:502'],
    ['opc-ua', 'opc.tcp://localhost:4840'],
    ['mtconnect', 'http://localhost:5000/mtconnect'],
  ])('accepts the %s endpoint syntax', async (type, endpoint) => {
    const dto = Object.assign(new CreateDeviceConnectionDto(), {
      deviceId: 'device-01', name: '设备连接', type, endpoint,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects malformed endpoint syntax before service-level protocol checks', async () => {
    const dto = Object.assign(new CreateDeviceConnectionDto(), {
      deviceId: 'device-01', name: '设备连接', type: 'modbus-tcp', endpoint: 'not-an-endpoint',
    });

    await expect(validate(dto)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'endpoint' }),
    ]));
  });
});
