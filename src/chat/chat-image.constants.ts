export const CHAT_IMAGE_FOLDER = 'skygloss-chat';
export const CHAT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const CHAT_IMAGE_RETENTION_DAYS = 30;
export const CHAT_IMAGE_PLACEHOLDER = '📷 Photo';

export const CHAT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
] as const;

export const CHAT_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export function isAllowedChatImageMime(mime?: string): boolean {
  if (!mime) return false;
  return (CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(
    mime.toLowerCase(),
  );
}

export function isAllowedChatImageName(originalname?: string): boolean {
  if (!originalname) return false;
  const lower = originalname.toLowerCase();
  return CHAT_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isAllowedChatImageFile(file?: {
  mimetype?: string;
  originalname?: string;
}): boolean {
  if (!file) return false;
  return (
    isAllowedChatImageMime(file.mimetype) ||
    isAllowedChatImageName(file.originalname)
  );
}

export function isTrustedChatImageUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dxhmopbei';
  const prefix = `https://res.cloudinary.com/${cloudName}/`;
  return url.startsWith(prefix) && url.includes(`/${CHAT_IMAGE_FOLDER}/`);
}

export function chatPreviewText(message: string, hasImage: boolean): string {
  const text = (message || '').trim();
  if (text) return text;
  if (hasImage) return CHAT_IMAGE_PLACEHOLDER;
  return '';
}
