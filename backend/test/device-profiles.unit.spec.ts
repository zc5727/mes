import { NotFoundException } from '@nestjs/common';
import { DeviceProfilesService } from '../src/device-profiles/device-profiles.service';

describe('device profile catalog', () => {
  it('exposes verified=false templates for the supported industrial protocols', () => {
    const service = new DeviceProfilesService();
    const profiles = service.list();

    expect(profiles.map((profile) => profile.protocol)).toEqual(['opcua', 'opcua', 'mtconnect', 'modbus-tcp']);
    expect(profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'generic-cnc-opcua', verified: false }),
      expect.objectContaining({ key: 'generic-cnc-modbus', verified: false }),
    ]));
    for (const profile of profiles) {
      expect(profile.dataPoints.length).toBeGreaterThan(0);
      expect(profile.dataPoints).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'status', access: 'read' }),
      ]));
      expect(profile.controlMethods).toEqual(expect.arrayContaining(['Start', 'Stop', 'Reset']));
    }
  });

  it('returns defensive copies and rejects unknown profiles', () => {
    const service = new DeviceProfilesService();
    const first = service.findOne('generic-cnc-opcua');
    first.dataPoints[0].name = 'mutated';
    first.faultCodes.pop();
    first.controlMethods.pop();

    const second = service.findOne('generic-cnc-opcua');
    expect(second.dataPoints[0].name).toBe('设备状态');
    expect(second.faultCodes).toContain('COMMUNICATION_LOSS');
    expect(second.controlMethods).toContain('EmergencyStop');
    expect(() => service.findOne('missing-profile')).toThrow(NotFoundException);
  });

  it('supports protocol-filtered read-only catalog queries', () => {
    expect(new DeviceProfilesService().list('opcua')).toHaveLength(2);
    expect(new DeviceProfilesService().list('mtconnect')[0]).toEqual(
      expect.objectContaining({ key: 'fanuc-cnc-mtconnect', verified: false }),
    );
  });
});
