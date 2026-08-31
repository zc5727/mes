import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { IngestDeviceEventDto } from './dto/ingest-device-event.dto';
import { MqttIngestionService } from './mqtt-ingestion.service';

/** HTTP fallback for gateways that cannot publish MQTT. It never controls devices. */
@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestion: MqttIngestionService) {}

  @Get('status')
  status(@TenantId() tenantId: string) { return { data: this.ingestion.getStatus(), tenantId }; }

  @Post('device-events')
  @HttpCode(HttpStatus.ACCEPTED)
  ingest(@TenantId() tenantId: string, @Body() event: IngestDeviceEventDto) {
    return { data: this.ingestion.ingestHttpEvent(tenantId, event), tenantId };
  }
}
