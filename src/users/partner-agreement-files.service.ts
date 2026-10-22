import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BackblazeService } from '../backblaze/backblaze.service';

/** B2 folder for Admin-uploaded partner agreements (kept out of the Media Library sync). */
export const PARTNER_AGREEMENT_PREFIX = 'partner-agreements/';

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
// Signed links stay valid for a while so an open page keeps working;
// tokens are reused until they get close to expiry.
const TOKEN_TTL_SECONDS = 6 * 60 * 60;
const TOKEN_RENEW_BEFORE_MS = 60 * 60 * 1000;

export function isPartnerAgreementKey(key?: string | null): boolean {
  return (
    typeof key === 'string' &&
    key.startsWith(PARTNER_AGREEMENT_PREFIX) &&
    !key.includes('..')
  );
}

/** Agreement files live in the private B2 bucket; viewers get short-lived signed links. */
@Injectable()
export class PartnerAgreementFilesService {
  private readonly tokens = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(private readonly backblaze: BackblazeService) {}

  async upload(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Please choose an agreement file.');
    }
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Agreement must be a PDF, JPG, PNG, or WEBP file.',
      );
    }
    const safeName =
      (file.originalname || 'agreement')
        .replace(/[^\w.\- ]+/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(-120) || 'agreement';
    const stored = await this.backblaze.uploadSmallFile(
      `${PARTNER_AGREEMENT_PREFIX}${randomUUID()}-${safeName}`,
      file.buffer,
      file.mimetype,
    );
    return { key: stored.fileName, fileName: file.originalname || safeName };
  }

  /** Signed view link, or null when B2 is unavailable (callers must not fail on it). */
  async signedUrl(key?: string | null): Promise<string | null> {
    if (!isPartnerAgreementKey(key)) return null;
    try {
      const bucket = await this.backblaze.getBucket();
      if (bucket.isPublic) return this.backblaze.buildFileUrl(key!);
      let cached = this.tokens.get(key!);
      if (!cached || cached.expiresAt - Date.now() < TOKEN_RENEW_BEFORE_MS) {
        cached = {
          token: await this.backblaze.getDownloadAuthorization(
            key!,
            TOKEN_TTL_SECONDS,
          ),
          expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000,
        };
        this.tokens.set(key!, cached);
      }
      return this.backblaze.buildFileUrl(key!, cached.token);
    } catch (err) {
      console.error('[PartnerAgreementFiles] Could not sign agreement link', err);
      return null;
    }
  }
}
