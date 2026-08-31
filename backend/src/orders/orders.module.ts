import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { AuditModule } from '../audit/audit.module';

@Module({ controllers: [OrdersController], imports: [AuditModule], providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {}
