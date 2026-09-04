import { Module } from '@nestjs/common';
import { StrategyAuthorizationService } from './strategy-authorization.service';

/** Owns the shared strategy authorization policy without importing feature modules. */
@Module({
  providers: [StrategyAuthorizationService],
  exports: [StrategyAuthorizationService],
})
export class StrategyAuthorizationModule {}
