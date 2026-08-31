import { Module } from '@nestjs/common';
import { ErpNextClient } from './erpnext.client';
import { ERPNEXT_CONFIG } from './erpnext.constants';
import { ErpNextController } from './erpnext.controller';
import { ErpNextService } from './erpnext.service';

@Module({
  controllers: [ErpNextController],
  providers: [
    {
      provide: ERPNEXT_CONFIG,
      useFactory: () => ({
        enabled: process.env.ERPNEXT_ENABLED === 'true',
        baseUrl: process.env.ERPNEXT_URL?.trim() || undefined,
        apiKey: process.env.ERPNEXT_API_KEY?.trim() || undefined,
        apiSecret: process.env.ERPNEXT_API_SECRET?.trim() || undefined,
        timeoutMs: readTimeout(process.env.ERPNEXT_TIMEOUT_MS),
      }),
    },
    ErpNextClient,
    ErpNextService,
  ],
  exports: [ErpNextService],
})
export class ErpNextModule {}

function readTimeout(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 500 && parsed <= 30_000 ? parsed : 5_000;
}
