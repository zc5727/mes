import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from '../../src/app.module';

export async function createTestApp(): Promise<INestApplication> {
  process.env.MES_API_KEY = 'test-api-key';
  process.env.MES_ALLOWED_TENANTS = 'tenant-demo,tenant-other';
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  app.use((request: Request, _response: Response, next: NextFunction) => {
    request.headers.authorization ??= 'Bearer test-api-key';
    request.headers['x-tenant-id'] ??= 'tenant-demo';
    next();
  });
  await app.init();
  return app;
}
