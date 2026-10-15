import { BadRequestException } from '@nestjs/common';
import { BackblazeController } from './backblaze.controller';
import { BackblazeService } from './backblaze.service';

const makeFile = (overrides: Partial<Express.Multer.File> = {}) => {
  const buffer = overrides.buffer ?? Buffer.from('%PDF-1.4\n...');
  return {
    originalname: 'doc.pdf',
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
    ...overrides,
  } as Express.Multer.File;
};

describe('BackblazeController', () => {
  const uploadPdf = jest
    .fn()
    .mockResolvedValue({ url: 'https://example/x.pdf' });
  const getFileUrl = jest.fn().mockResolvedValue({ url: 'u', expiresAt: null });
  const controller = new BackblazeController({
    uploadPdf,
    getFileUrl,
  } as unknown as BackblazeService);

  beforeEach(() => jest.clearAllMocks());

  it('uploads a valid PDF', async () => {
    await expect(controller.uploadPdf(makeFile())).resolves.toEqual({
      url: 'https://example/x.pdf',
    });
    expect(uploadPdf).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing file', undefined],
    ['wrong extension', makeFile({ originalname: 'doc.png' })],
    ['wrong mime type', makeFile({ mimetype: 'image/png' })],
    ['non-PDF content', makeFile({ buffer: Buffer.from('<html></html>') })],
  ])('rejects %s', async (_label, file) => {
    await expect(
      controller.uploadPdf(file as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploadPdf).not.toHaveBeenCalled();
  });

  it('rejects file names outside the PDF folder', async () => {
    for (const name of [
      undefined,
      'other/a.pdf',
      'pdfs/../x.pdf',
      'pdfs/a.txt',
    ]) {
      await expect(controller.getPdfUrl(name)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    await expect(controller.getPdfUrl('pdfs/2026/10/a.pdf')).resolves.toEqual({
      fileName: 'pdfs/2026/10/a.pdf',
      url: 'u',
      expiresAt: null,
    });
  });
});
