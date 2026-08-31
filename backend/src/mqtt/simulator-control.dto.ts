import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { SimulatorControlAction, SimulatorFaultType } from './mqtt.types';

const CONTROL_ACTIONS: SimulatorControlAction[] = [
  'start',
  'stop',
  'pause',
  'resume',
  'speed',
  'fault',
  'reset',
  'recover',
  'snapshot',
  'export',
];

const FAULT_TYPES: SimulatorFaultType[] = [
  'OVERHEAT',
  'JAM',
  'COMMUNICATION_LOSS',
  'QUALITY_DRIFT',
  'EMERGENCY_STOP',
  'MATERIAL_SHORTAGE',
  'QUALITY_ANOMALY',
];

export class SimulatorControlDto {
  @IsIn(CONTROL_ACTIONS)
  action!: SimulatorControlAction;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  commandId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lineId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  deviceId?: string;

  @IsOptional()
  @IsIn(FAULT_TYPES)
  faultType?: SimulatorFaultType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  speed?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  requestedBy?: string;

  @IsOptional()
  @IsISO8601()
  timestamp?: string;
}

export function validateSimulatorControlCommand(command: SimulatorControlDto): void {
  if (command.action === 'fault') {
    if (!command.lineId || !command.deviceId || !command.faultType) {
      throw new BadRequestException('fault requires lineId, deviceId and faultType');
    }
    if (command.speed !== undefined) {
      throw new BadRequestException('fault does not accept speed');
    }
    return;
  }

  if (command.action === 'speed') {
    if (command.speed === undefined) throw new BadRequestException('speed requires a positive speed');
    if (command.lineId || command.deviceId || command.faultType) {
      throw new BadRequestException('speed does not accept line, device or fault arguments');
    }
    return;
  }

  if (command.action === 'reset' || command.action === 'recover') {
    if (command.deviceId !== undefined && command.lineId === undefined) {
      throw new BadRequestException(`${command.action} deviceId requires lineId`);
    }
    if (command.faultType !== undefined && command.deviceId === undefined) {
      throw new BadRequestException(`${command.action} faultType requires deviceId`);
    }
    return;
  }

  if (command.action === 'start' || command.action === 'stop') {
    if (command.faultType || command.speed !== undefined) {
      throw new BadRequestException(`${command.action} does not accept speed or fault arguments`);
    }
    if (command.deviceId && !command.lineId) {
      throw new BadRequestException(`${command.action} deviceId requires lineId`);
    }
    return;
  }

  if (command.speed !== undefined || command.lineId || command.deviceId || command.faultType) {
    throw new BadRequestException(`${command.action} does not accept control arguments`);
  }
}

/**
 * Converts the API-friendly recover alias into the simulator protocol action.
 * The simulator currently understands `reset`; keeping the alias at the API
 * boundary lets clients use domain language without changing the wire format.
 */
export function normalizeSimulatorControlCommand(command: SimulatorControlDto): SimulatorControlDto {
  return command.action === 'recover' ? { ...command, action: 'reset' } : command;
}
