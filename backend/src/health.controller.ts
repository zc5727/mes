import { Controller, Get, Optional } from '@nestjs/common';
import { Public } from './common/public.decorator';
import { PrismaService } from './database/prisma.service';

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

@Controller('health')
export class HealthController {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

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
}
