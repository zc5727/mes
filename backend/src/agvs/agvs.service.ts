import { Injectable, NotFoundException } from '@nestjs/common';
import { MockEntity } from '../common/mock.types';

export type AgvState = 'idle' | 'moving' | 'loading' | 'charging' | 'error';

export interface Agv extends MockEntity {
  lineId: string;
  code: string;
  name: string;
  state: AgvState;
  battery: number;
  speed: number;
  task: string;
  progress: number;
  position: { x: number; y: number; z: number };
}

@Injectable()
export class AgvsService {
  private readonly agvs: Agv[] = [
    this.createSeed('agv-01', 'line-cnc', 'AGV-01', '运输机器人 1', 'moving', 86, '原料配送', 0),
    this.createSeed('agv-02', 'line-assembly', 'AGV-02', '运输机器人 2', 'moving', 73, '成品入库', 30),
    this.createSeed('agv-03', 'line-welding', 'AGV-03', '运输机器人 3', 'moving', 61, '工装回收', 60),
  ];

  findAll(tenantId: string, lineId?: string): Agv[] {
    return this.agvs.filter((agv) => agv.tenantId === tenantId && (!lineId || agv.lineId === lineId));
  }

  findOne(tenantId: string, id: string): Agv {
    const agv = this.agvs.find((item) => item.id === id && item.tenantId === tenantId);
    if (!agv) throw new NotFoundException(`AGV ${id} not found`);
    return agv;
  }

  private createSeed(id: string, lineId: string, code: string, name: string, state: AgvState, battery: number, task: string, progress: number): Agv {
    return {
      id, tenantId: 'tenant-demo', lineId, code, name, state, battery, speed: 0.34,
      task, progress, position: { x: 0, y: 0, z: 0 }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-08-28T08:00:00.000Z'
    };
  }
}
