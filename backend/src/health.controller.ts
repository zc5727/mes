import { Controller, Get, Optional } from '@nestjs/common';
import { Public } from './common/public.decorator';
import { PrismaService } from './database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  @Get()
  @Public()
  check() {
    return {
      status: 'ok',
      service: 'mes-saas-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readiness')
  @Public()
  async readiness() {
    const database = this.prisma ? await this.prisma.readiness() : { enabled: false, status: 'disabled' as const };
    return { status: database.status === 'unavailable' ? 'degraded' : 'ready', service: 'mes-saas-backend', database };
  }
}
