import { Controller, Get } from '@nestjs/common';
import { Public } from './common/public.decorator';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  check() {
    return {
      status: 'ok',
      service: 'mes-saas-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
