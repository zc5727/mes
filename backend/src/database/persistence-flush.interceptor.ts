import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { FoundationPersistenceService } from './foundation-persistence.service';
import { InventoryPersistenceService } from './inventory-persistence.service';

/** Makes queued PostgreSQL writes part of the request success boundary. */
@Injectable()
export class PersistenceFlushInterceptor implements NestInterceptor {
  constructor(
    private readonly foundation: FoundationPersistenceService,
    private readonly inventory: InventoryPersistenceService,
  ) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        await this.flush();
        return value;
      }),
      catchError((error: unknown) => from(this.flush()).pipe(
        mergeMap(() => throwError(() => error)),
      )),
    );
  }

  private async flush(): Promise<void> {
    await Promise.all([this.foundation.flush(), this.inventory.flush()]);
  }
}
