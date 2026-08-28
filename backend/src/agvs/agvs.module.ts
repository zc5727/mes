import { Module } from '@nestjs/common';
import { AgvsController } from './agvs.controller';
import { AgvsService } from './agvs.service';

@Module({ controllers: [AgvsController], providers: [AgvsService], exports: [AgvsService] })
export class AgvsModule {}
