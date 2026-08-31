import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { AuditPersistenceService } from './audit-persistence.service';

/** Flushes audit writes before an HTTP response is allowed to succeed. */
@Injectable()
export class AuditPersistenceInterceptor implements NestInterceptor {
  constructor(private readonly persistence: AuditPersistenceService) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        await this.persistence.flush();
        return value;
      }),
      catchError((error: unknown) => from(this.persistence.flush()).pipe(
        mergeMap(() => throwError(() => error)),
      )),
    );
  }
}
