export const MEDIA_CATEGORIES = ['image', 'video', 'pdf'] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

/** Root "folder" in the bucket for everything the media library manages. */
export const MEDIA_ROOT = 'media/';

export const MEDIA_FOLDERS: Record<MediaCategory, string> = {
  image: 'images',
  video: 'videos',
  pdf: 'pdfs',
};

/** Used when the browser reports an empty or generic type (common for .mkv, .heic, ...). */
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  pdf: 'application/pdf',
};

export function getExtension(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName || '');
  return match ? match[1].toLowerCase() : '';
}

/** Normalises the content type, falling back to the file extension. */
export function resolveContentType(
  fileName: string,
  contentType?: string,
): string {
  const type = (contentType || '').trim().toLowerCase();
  if (type && type !== 'application/octet-stream') return type;
  return MIME_BY_EXTENSION[getExtension(fileName)] || type;
}

export function categoryForContentType(
  contentType: string,
): MediaCategory | null {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType === 'application/pdf') return 'pdf';
  return null;
}

export function categoryForFileName(fileName: string): MediaCategory | null {
  for (const category of MEDIA_CATEGORIES) {
    if (fileName.startsWith(`${MEDIA_ROOT}${MEDIA_FOLDERS[category]}/`)) {
      return category;
    }
  }
  return null;
}

/** e.g. media/images/2026/10/<uuid>-summer-banner.png */
export function buildMediaFileName(
  category: MediaCategory,
  originalName: string,
  uniqueId: string,
  now = new Date(),
): string {
  const ext = getExtension(originalName);
  const base = (originalName || 'file')
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .toLowerCase();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${MEDIA_ROOT}${MEDIA_FOLDERS[category]}/${yyyy}/${mm}/${uniqueId}${base ? `-${base}` : ''}${ext ? `.${ext}` : ''}`;
}
