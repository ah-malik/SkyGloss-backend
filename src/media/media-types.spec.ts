import {
  buildMediaFileName,
  categoryForContentType,
  categoryForFileName,
  resolveContentType,
} from './media-types';

describe('media-types', () => {
  it('maps content types to categories', () => {
    expect(categoryForContentType('image/png')).toBe('image');
    expect(categoryForContentType('video/mp4')).toBe('video');
    expect(categoryForContentType('application/pdf')).toBe('pdf');
    expect(categoryForContentType('application/zip')).toBeNull();
    expect(categoryForContentType('text/html')).toBeNull();
  });

  it('falls back to the extension when the browser gives no type', () => {
    expect(resolveContentType('clip.MKV', '')).toBe('video/x-matroska');
    expect(resolveContentType('doc.pdf', 'application/octet-stream')).toBe(
      'application/pdf',
    );
    expect(resolveContentType('photo.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(resolveContentType('archive.zip', '')).toBe('');
  });

  it('builds unique, safe object keys inside the category folder', () => {
    const name = buildMediaFileName(
      'image',
      'Summer Banner (Final)!.PNG',
      'abc-123',
      new Date('2026-03-05T00:00:00Z'),
    );
    expect(name).toBe('media/images/2026/03/abc-123-summer-banner-final.png');
    expect(categoryForFileName(name)).toBe('image');
    expect(categoryForFileName('other/x.png')).toBeNull();
  });
});
