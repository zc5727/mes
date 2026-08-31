import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutBucketLifecycleConfigurationCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { DocumentStorage } from './documents.types';

export interface S3DocumentStorageOptions {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  maxAttempts: number;
  lifecycleDays: number;
}

/** S3-compatible binary storage for MinIO or production object storage. */
@Injectable()
export class S3DocumentStorageAdapter implements DocumentStorage {
  readonly provider = 's3' as const;
  readonly root: string;

  constructor(private readonly options: S3DocumentStorageOptions, private readonly client = new S3Client({ endpoint: options.endpoint, region: options.region, forcePathStyle: options.forcePathStyle, credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey } })) {
    if (!options.endpoint || !options.bucket || !options.accessKeyId || !options.secretAccessKey) throw new BadRequestException('S3 document storage requires endpoint, bucket and credentials');
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 5) throw new BadRequestException('S3 maxAttempts must be between 1 and 5');
    if (!Number.isInteger(options.lifecycleDays) || options.lifecycleDays < 0) throw new BadRequestException('S3 lifecycleDays must be a non-negative integer');
    this.root = options.bucket;
  }

  async put(storageKey: string, content: Buffer): Promise<void> {
    const sha256 = createHash('sha256').update(content).digest('hex');
    await this.retry(() => this.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: this.safeKey(storageKey), Body: content, ContentType: 'application/octet-stream', ContentLength: content.length, Metadata: { sha256 } })));
  }

  async read(storageKey: string, expectedSha256?: string): Promise<Buffer> {
    const response = await this.retry(() => this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: this.safeKey(storageKey) })));
    if (!response.Body) throw new Error('S3 object response contained no body');
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    if (expectedSha256 && createHash('sha256').update(bytes).digest('hex') !== expectedSha256) throw new Error('S3 object SHA-256 verification failed');
    return bytes;
  }

  async remove(storageKey: string): Promise<void> { await this.retry(() => this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.safeKey(storageKey) }))); }

  /** Apply a bucket lifecycle policy without pretending that malware scanning succeeded. */
  async configureLifecycle(): Promise<void> {
    if (this.options.lifecycleDays === 0) return;
    await this.retry(() => this.client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: this.options.bucket, LifecycleConfiguration: { Rules: [{ ID: 'mes-document-retention', Status: 'Enabled', Filter: { Prefix: '' }, Expiration: { Days: this.options.lifecycleDays } }] } })));
  }

  private async retry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try { return await operation(); } catch (error: unknown) { lastError = error; if (attempt < this.options.maxAttempts) await new Promise((resolve) => setTimeout(resolve, 50 * attempt)); }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private safeKey(storageKey: string): string {
    const key = storageKey.trim();
    if (!key || key.startsWith('/') || key.split('/').some((segment) => segment === '..')) throw new BadRequestException('Invalid S3 document storage key');
    return key;
  }
}

export function s3DocumentStorageOptions(env: NodeJS.ProcessEnv = process.env): S3DocumentStorageOptions {
  const endpoint = env.MES_OBJECT_STORAGE_ENDPOINT ?? env.S3_ENDPOINT ?? '';
  const bucket = env.MES_OBJECT_STORAGE_BUCKET ?? env.S3_BUCKET ?? 'mes-documents';
  const accessKeyId = env.MES_OBJECT_STORAGE_ACCESS_KEY ?? env.S3_ACCESS_KEY ?? '';
  const secretAccessKey = env.MES_OBJECT_STORAGE_SECRET_KEY ?? env.S3_SECRET_KEY ?? '';
  return { endpoint, bucket, region: env.S3_REGION ?? 'us-east-1', accessKeyId, secretAccessKey, forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') === 'true', maxAttempts: Number(env.S3_MAX_ATTEMPTS ?? 3), lifecycleDays: Number(env.S3_LIFECYCLE_DAYS ?? 0) };
}
