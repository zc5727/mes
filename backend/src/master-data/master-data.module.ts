import { Module } from '@nestjs/common';
import { MasterDataController } from './master-data.controller';
import { MasterDataService } from './master-data.service';
import { AuditModule } from '../audit/audit.module';
@Module({ imports: [AuditModule], controllers: [MasterDataController], providers: [MasterDataService], exports: [MasterDataService] })
export class MasterDataModule {}
