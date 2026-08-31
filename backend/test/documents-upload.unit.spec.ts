import { BadRequestException } from '@nestjs/common';
import { DocumentsService } from '../src/documents/documents.service';
import type { DocumentSecurityScanner, DocumentStorage } from '../src/documents/documents.types';

const file = (name = 'drawing.pdf', mimetype = 'application/pdf') => ({
  originalname: name, mimetype, size: 7, buffer: Buffer.from('payload'),
});

describe('document upload boundary', () => {
  const storage: DocumentStorage = {
    provider: 'local-disk', root: '/tmp/mes-documents',
    put: jest.fn().mockResolvedValue(undefined), read: jest.fn(), remove: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => jest.clearAllMocks());

  it('hashes, versions, audits and exposes a truthful PDF preview boundary', async () => {
    const scanner: DocumentSecurityScanner = { scan: jest.fn().mockResolvedValue({ status: 'not_scanned', provider: 'clamav-not-configured', message: 'scanner unavailable' }) };
    const audit = { record: jest.fn() };
    const service = new DocumentsService(storage, undefined, scanner, audit as never);
    const record = await service.upload('tenant-demo', { documentKey: 'drawing-001', uploadedBy: 'engineer' }, file());

    expect(record.fileHash).toHaveLength(64);
    expect(record.version).toBe(1);
    expect(record.securityScanStatus).toBe('not_scanned');
    expect(record.securityScannedAt).toBeNull();
    expect(service.preview('tenant-demo', record.id)).toEqual(expect.objectContaining({ supported: true, kind: 'pdf' }));
    expect(audit.record).toHaveBeenCalledWith('tenant-demo', 'engineer', expect.objectContaining({ action: 'document.uploaded' }));
  });

  it('rejects infected content before writing the binary', async () => {
    const scanner: DocumentSecurityScanner = { scan: jest.fn().mockResolvedValue({ status: 'infected', provider: 'clamav', message: 'signature detected' }) };
    const service = new DocumentsService(storage, undefined, scanner);

    await expect(service.upload('tenant-demo', { documentKey: 'drawing-002', uploadedBy: 'engineer' }, file())).rejects.toThrow(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('does not pretend that CAD can be previewed without a renderer', async () => {
    const service = new DocumentsService(storage);
    const record = await service.upload('tenant-demo', { documentKey: 'drawing-003', uploadedBy: 'engineer' }, file('layout.dwg', 'application/acad'));
    expect(service.preview('tenant-demo', record.id)).toEqual({
      supported: false, kind: 'cad', renderer: 'cad-viewer',
      reason: 'CAD preview requires a licensed or separately deployed CAD renderer',
    });
  });

  it('creates a deterministic structural analysis draft without inventing visual semantics', async () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
    png.writeUInt32BE(1920, 16);
    png.writeUInt32BE(1080, 20);
    storage.read = jest.fn().mockResolvedValue(png);
    const service = new DocumentsService(storage);
    const record = await service.upload('tenant-demo', { documentKey: 'drawing-visual-001', uploadedBy: 'engineer' }, {
      originalname: 'layout.png', mimetype: 'image/png', size: png.length, buffer: png,
    });
    const analyzed = await service.analyze('tenant-demo', record.id, 'engineer');

    expect(analyzed.analysisStatus).toBe('draft');
    expect(analyzed.analysisDraft).toEqual(expect.objectContaining({
      analyzer: 'local-structural-v1',
      format: 'png',
      dimensions: { width: 1920, height: 1080 },
      visualSemantics: 'not_configured',
      requiresHumanReview: true,
    }));
  });

  it('supports asynchronous analysis with a retryable failure state', async () => {
    const stored = Buffer.from('%PDF-1.7\n/Type /Page\n');
    storage.read = jest.fn().mockRejectedValueOnce(new Error('temporary storage outage')).mockResolvedValue(stored);
    const service = new DocumentsService(storage);
    const record = await service.upload('tenant-demo', { documentKey: 'drawing-async-001', uploadedBy: 'engineer' }, file());

    const queued = await service.queueAnalysis('tenant-demo', record.id, 'engineer');
    expect(queued.analysisStatus).toBe('queued');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(service.findOne('tenant-demo', record.id).analysisStatus).toBe('failed');

    const retried = await service.retryAnalysis('tenant-demo', record.id, 'engineer');
    expect(retried.analysisStatus).toBe('queued');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(service.findOne('tenant-demo', record.id).analysisStatus).toBe('draft');
  });

  it('removes the binary and memory projection when metadata persistence fails', async () => {
    const persistence = { saveDocumentReliable: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const service = new DocumentsService(storage, persistence as never);

    await expect(service.uploadReliable('tenant-demo', { documentKey: 'drawing-004', uploadedBy: 'engineer' }, file()))
      .rejects.toThrow('database unavailable');
    expect(storage.put).toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(service.list('tenant-demo')).toHaveLength(0);
  });
});
