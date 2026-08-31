import { BadGatewayException, GatewayTimeoutException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

export type ErpNextErrorCode = 'disabled' | 'unauthorized' | 'not_found' | 'timeout' | 'upstream';

export class ErpNextError extends Error {
  constructor(
    readonly code: ErpNextErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ErpNextError';
  }
}

export function mapErpNextError(error: unknown): Error {
  if (!(error instanceof ErpNextError)) return new BadGatewayException('ERPNext request failed');
  switch (error.code) {
    case 'disabled': return new ServiceUnavailableException('ERPNext integration is disabled or not configured');
    case 'unauthorized': return new UnauthorizedException('ERPNext credentials were rejected');
    case 'not_found': return new BadGatewayException('ERPNext resource was not found');
    case 'timeout': return new GatewayTimeoutException('ERPNext request timed out');
    default: return new BadGatewayException(`ERPNext upstream error${error.status ? ` (${error.status})` : ''}`);
  }
}
