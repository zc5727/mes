import { Controller, Get, Sse } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { TenantId } from '../common/tenant.decorator';
import { DigitalTwinService } from './digital-twin.service';
import { DigitalTwinRealtimeService, DigitalTwinSseMessage } from './digital-twin-realtime.service';

@Controller('digital-twin')
export class DigitalTwinController {
  constructor(private readonly digitalTwinService: DigitalTwinService, private readonly realtime: DigitalTwinRealtimeService) {}

  @Get('snapshot')
  snapshot(@TenantId() tenantId: string) {
    return { data: this.digitalTwinService.getSnapshot(tenantId), tenantId };
  }

  @Get('current-state')
  currentState(@TenantId() tenantId: string) {
    return { data: this.digitalTwinService.getSnapshot(tenantId), tenantId };
  }

  @Sse('stream')
  stream(@TenantId() tenantId: string): Observable<DigitalTwinSseMessage> {
    return this.realtime.stream(tenantId);
  }
}
