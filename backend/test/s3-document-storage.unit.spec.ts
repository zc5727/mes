import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { S3DocumentStorageAdapter, s3DocumentStorageOptions } from '../src/documents/s3-document-storage.adapter';

describe('S3DocumentStorageAdapter', () => {
  it('uploads with sha256 metadata and verifies downloaded content', async () => {
    const calls: Array<{ input: Record<string, unknown> }> = [];
    const content = Buffer.from('drawing');
    const client = { send: jest.fn(async (command: { input: Record<string, unknown> }) => {
      calls.push(command);
      if ('Key' in command.input && command.input.Key === 'tenant/document.pdf' && calls.length > 1) return { Body: { transformToByteArray: async () => content } };
      return {};
    }) } as never;
    const storage = new S3DocumentStorageAdapter({ endpoint: 'http://minio:9000', bucket: 'mes-documents', region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret', forcePathStyle: true, maxAttempts: 1, lifecycleDays: 0 }, client);
    await storage.put('tenant/document.pdf', content);
    expect(calls[0].input.Metadata).toEqual({ sha256: createHash('sha256').update(content).digest('hex') });
    await expect(storage.read('tenant/document.pdf', createHash('sha256').update(content).digest('hex'))).resolves.toEqual(content);
  });

  it('retries transient object-store failures and rejects unsafe keys', async () => {
    let attempts = 0;
    const client = { send: jest.fn(async () => { attempts += 1; if (attempts < 3) throw new Error('temporary'); return {}; }) } as never;
    const storage = new S3DocumentStorageAdapter({ endpoint: 'http://minio:9000', bucket: 'mes-documents', region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret', forcePathStyle: true, maxAttempts: 3, lifecycleDays: 7 }, client);
    await expect(storage.remove('tenant/document.pdf')).resolves.toBeUndefined();
    expect(attempts).toBe(3);
    await expect(storage.remove('../escape')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('loads explicit MinIO/S3 configuration without claiming scanner success', () => {
    expect(s3DocumentStorageOptions({ MES_OBJECT_STORAGE_ENDPOINT: 'http://localhost:9000', MES_OBJECT_STORAGE_BUCKET: 'mes-documents', MES_OBJECT_STORAGE_ACCESS_KEY: 'mes_dev', MES_OBJECT_STORAGE_SECRET_KEY: 'secret', S3_LIFECYCLE_DAYS: '30' })).toMatchObject({ endpoint: 'http://localhost:9000', bucket: 'mes-documents', lifecycleDays: 30 });
  });
});
