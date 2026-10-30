import { MEDIA_FOLDERS, MEDIA_ROOT } from '../media/media-types';

/** Uploaded signature images: the browser compresses to this size first. */
export const SIGNATURE_UPLOAD_MAX_BYTES = 500 * 1024;

export const SIGNATURE_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Key returned by POST /account-activation/signature-image (Media Library image). */
export function isSignatureMediaKey(key?: string | null): boolean {
  return (
    typeof key === 'string' &&
    key.startsWith(`${MEDIA_ROOT}${MEDIA_FOLDERS.image}/`) &&
    !key.includes('..')
  );
}
