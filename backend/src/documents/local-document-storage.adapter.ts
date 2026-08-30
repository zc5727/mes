import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import type { DocumentStorage } from './documents.types';

/** Stores uploaded demo binaries locally when no object storage is configured. */
@Injectable()
export class LocalDocumentStorageAdapter implements DocumentStorage {
  readonly provider = 'local-disk' as const;
  readonly root: string;

  constructor(@Optional() root?: string) {
    const storageRoot = root ?? process.env.MES_LOCAL_STORAGE_ROOT ?? resolve(process.cwd(), '.data/documents');
    this.root = isAbsolute(storageRoot) ? normalize(storageRoot) : resolve(storageRoot);
  }

  async put(storageKey: string, content: Buffer): Promise<void> {
    const target = this.safePath(storageKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' });
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.safePath(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.safePath(storageKey), { force: true });
  }

  private safePath(storageKey: string): string {
    const target = normalize(join(this.root, storageKey));
    if (target !== this.root && !target.startsWith(`${this.root}/`)) {
      throw new BadRequestException('Invalid document storage key');
    }
    return target;
  }
}
