import { Controller, Get, Optional } from '@nestjs/common';
import { Public } from './common/public.decorator';
import { PrismaService } from './database/prisma.service';
import { MqttIngestionService } from './mqtt/mqtt-ingestion.service';
import { resolveMesControlMode, MesControlMode } from './common/control-mode';

interface HealthPayload {
  status: 'ok';
  service: string;
  timestamp: string;
}

interface ReadinessPayload {
  status: 'degraded' | 'ready';
  service: string;
  database: {
    enabled: boolean;
    status: 'disabled' | 'ready' | 'unavailable';
  };
}

interface ComponentsPayload {
  service: string;
  timestamp: string;
  environment: string;
  controlMode: MesControlMode;
  database: ReadinessPayload['database'];
  mqtt: {
    enabled: boolean;
    connected: boolean;
    state: string;
    lastHeartbeatAt: string | null;
    lastError: string | null;
    lastErrorCode: string | null;
  };
}

@Controller('health')
export class HealthController {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly mqtt?: MqttIngestionService,
  ) {}

  /** Returns a liveness response without checking external dependencies. */
  @Get()
  @Public()
  check(): HealthPayload {
    return {
      status: 'ok',
      service: 'mes-saas-backend',
      timestamp: new Date().toISOString(),
    };
  }

  /** Reports whether the configured persistence dependency is usable. */
  @Get('readiness')
  @Public()
  async readiness(): Promise<ReadinessPayload> {
    const database = this.prisma
      ? await this.prisma.readiness()
      : { enabled: false, status: 'disabled' as const };
    const status = database.status === 'ready' ? 'ready' : 'degraded';
    return {
      status,
      service: 'mes-saas-backend',
      database,
    };
  }

  /** Exposes dependency diagnostics without leaking broker URLs or credentials. */
  @Get('components')
  @Public()
  async components(): Promise<ComponentsPayload> {
    const database = this.prisma
      ? await this.prisma.readiness()
      : { enabled: false, status: 'disabled' as const };
    const mqtt = this.mqtt?.getStatus();
    return {
      service: 'mes-saas-backend',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV?.trim() || 'unknown',
      controlMode: resolveMesControlMode(),
      database,
      mqtt: mqtt
        ? {
            enabled: mqtt.enabled,
            connected: mqtt.connected,
            state: mqtt.state,
            lastHeartbeatAt: mqtt.lastHeartbeatAt,
            lastError: mqtt.lastError,
            lastErrorCode: mqtt.lastErrorCode,
          }
        : {
            enabled: false,
            connected: false,
            state: 'unavailable',
            lastHeartbeatAt: null,
            lastError: null,
            lastErrorCode: null,
          },
    };
  }
}
