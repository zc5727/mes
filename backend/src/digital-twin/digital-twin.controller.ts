import { Controller, Get } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { DigitalTwinService } from './digital-twin.service';

@Controller('digital-twin')
export class DigitalTwinController {
  constructor(private readonly digitalTwinService: DigitalTwinService) {}

  @Get('snapshot')
  snapshot(@TenantId() tenantId: string) {
    return { data: this.digitalTwinService.getSnapshot(tenantId), tenantId };
  }

  @Get('current-state')
  currentState(@TenantId() tenantId: string) {
    return { data: this.digitalTwinService.getSnapshot(tenantId), tenantId };
  }
}
