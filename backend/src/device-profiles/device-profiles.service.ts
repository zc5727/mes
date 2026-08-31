import { Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import type { DeviceProfile } from './device-profile.types';
import { DeviceProfilePersistenceService } from './device-profile-persistence.service';

/** Versioned, declarative machine profiles. `verified=false` means no vendor compatibility claim. */
@Injectable()
export class DeviceProfilesService implements OnModuleInit {
  private profiles: DeviceProfile[] = [
    this.profile('generic-cnc-opcua', '通用三轴铣床 OPC UA', '三轴铣床', 'Generic', 'opcua', 'cnc-generic'),
    this.profile('siemens-sinumerik-opcua', 'SINUMERIK OPC UA 适配模板', '加工中心', 'SINUMERIK', 'opcua', 'cnc-siemens'),
    this.profile('fanuc-cnc-mtconnect', 'FANUC MTConnect 适配模板', '数控车床', 'FANUC', 'mtconnect', 'cnc-fanuc'),
    this.profile('generic-cnc-modbus', '通用机床 Modbus TCP', '三轴铣床', 'Generic', 'modbus-tcp', 'cnc-generic'),
  ];

  constructor(
    @Optional() private readonly persistence?: DeviceProfilePersistenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.persistence) return;
    this.profiles = await this.persistence.restoreOrSeed(this.profiles);
  }

  /** Return defensive copies of all supported device profiles. */
  list(): DeviceProfile[] {
    return this.profiles.map((profile) => this.clone(profile));
  }

  /** Find one profile by its stable catalog key. */
  findOne(key: string): DeviceProfile {
    const profile = this.profiles.find((item) => item.key === key);
    if (!profile) throw new NotFoundException(`Device profile ${key} not found`);
    return this.clone(profile);
  }

  private profile(
    key: string,
    name: string,
    machineType: string,
    controller: string,
    protocol: DeviceProfile['protocol'],
    modelKey: string,
  ): DeviceProfile {
    return {
      key, name, machineType, controller, protocol, modelKey, verified: false,
      dataPoints: [
        { key: 'status', name: '设备状态', dataType: 'string', access: 'read', address: protocol === 'opcua' ? 'Objects/Machine/Status' : 'status' },
        { key: 'spindleSpeed', name: '主轴转速', dataType: 'number', access: 'read', address: protocol === 'modbus-tcp' ? '40001' : 'Spindle/Speed', unit: 'rpm' },
        { key: 'program', name: '当前程序', dataType: 'string', access: 'read', address: protocol === 'opcua' ? 'Objects/Machine/Program' : 'program' },
      ],
      faultCodes: ['COMMUNICATION_LOSS', 'SPINDLE_OVERLOAD', 'SPINDLE_OVERHEAT', 'TOOL_BROKEN', 'EMERGENCY_STOP'],
      controlMethods: ['Start', 'Stop', 'Pause', 'Resume', 'Reset', 'EmergencyStop'],
    };
  }

  private clone(profile: DeviceProfile): DeviceProfile {
    return {
      ...profile,
      dataPoints: profile.dataPoints.map((point) => ({ ...point })),
      faultCodes: [...profile.faultCodes],
      controlMethods: [...profile.controlMethods],
    };
  }
}
