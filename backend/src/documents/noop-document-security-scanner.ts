import { Injectable } from '@nestjs/common';
import type { DocumentScanInput, DocumentScanResult, DocumentSecurityScanner } from './documents.types';

/** Explicitly reports that no antivirus engine is configured; it never claims a file is clean. */
@Injectable()
export class NoopDocumentSecurityScanner implements DocumentSecurityScanner {
  async scan(_input: DocumentScanInput): Promise<DocumentScanResult> {
    return { status: 'not_scanned', provider: 'none', message: 'No antivirus scanner configured' };
  }
}
