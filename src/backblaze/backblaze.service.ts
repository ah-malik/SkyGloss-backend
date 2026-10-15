import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { createHash, randomUUID } from 'crypto';

const B2_AUTH_URL = 'https://api.backblazeb2.com/b2api/v3/b2_authorize_account';
// B2 auth tokens last 24h; refresh a bit earlier.
const AUTH_TTL_MS = 23 * 60 * 60 * 1000;
const DEFAULT_DOWNLOAD_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_DOWNLOAD_TTL_SECONDS = 7 * 24 * 60 * 60; // B2 maximum
const PDF_FOLDER = 'pdfs';

interface B2Session {
  apiUrl: string;
  downloadUrl: string;
  authorizationToken: string;
  accountId: string;
  expiresAt: number;
}

interface B2Bucket {
  bucketId: string;
  bucketName: string;
  isPublic: boolean;
}

export interface PdfUploadResult {
  fileName: string;
  originalName: string;
  size: number;
  url: string;
  isPublic: boolean;
  /** ISO timestamp when the URL stops working (null for public buckets). */
  expiresAt: string | null;
}

@Injectable()
export class BackblazeService {
  private session: B2Session | null = null;
  private bucket: B2Bucket | null = null;

  private get keyId() {
    return process.env.B2_KEY_ID || '';
  }

  private get applicationKey() {
    return process.env.B2_APPLICATION_KEY || '';
  }

  private get bucketName() {
    return process.env.B2_BUCKET_NAME || '';
  }

  private get downloadTtlSeconds() {
    const raw = Number(process.env.B2_DOWNLOAD_URL_TTL_SECONDS);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_DOWNLOAD_TTL_SECONDS;
    return Math.min(Math.floor(raw), MAX_DOWNLOAD_TTL_SECONDS);
  }

  private assertConfigured() {
    if (!this.keyId || !this.applicationKey || !this.bucketName) {
      throw new ServiceUnavailableException(
        'Backblaze B2 is not configured (B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME).',
      );
    }
  }

  private async authorize(force = false): Promise<B2Session> {
    if (!force && this.session && this.session.expiresAt > Date.now()) {
      return this.session;
    }
    this.assertConfigured();
    try {
      const res = await axios.get<{
        accountId: string;
        authorizationToken: string;
        apiInfo: { storageApi: { apiUrl: string; downloadUrl: string } };
      }>(B2_AUTH_URL, {
        auth: { username: this.keyId, password: this.applicationKey },
        timeout: 15000,
      });
      const storage = res.data.apiInfo.storageApi;
      this.session = {
        apiUrl: storage.apiUrl,
        downloadUrl: storage.downloadUrl,
        authorizationToken: res.data.authorizationToken,
        accountId: res.data.accountId,
        expiresAt: Date.now() + AUTH_TTL_MS,
      };
      return this.session;
    } catch (error) {
      this.session = null;
      console.error(
        '[BackblazeService] Authorization failed:',
        this.describe(error),
      );
      throw new BadGatewayException('Could not authenticate with Backblaze B2');
    }
  }

  /** Calls a B2 native API endpoint, re-authorizing once if the token expired. */
  private async callApi<T>(endpoint: string, body: object): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await this.authorize(attempt > 0);
      try {
        const res = await axios.post(
          `${session.apiUrl}/b2api/v3/${endpoint}`,
          body,
          {
            headers: { Authorization: session.authorizationToken },
            timeout: 15000,
          },
        );
        return res.data as T;
      } catch (error) {
        if (attempt === 0 && (error as AxiosError).response?.status === 401) {
          continue;
        }
        console.error(
          `[BackblazeService] ${endpoint} failed:`,
          this.describe(error),
        );
        throw new BadGatewayException('Backblaze B2 request failed');
      }
    }
    throw new BadGatewayException('Backblaze B2 request failed');
  }

  private async getBucket(): Promise<B2Bucket> {
    if (this.bucket) return this.bucket;
    const session = await this.authorize();
    const data = await this.callApi<{
      buckets: { bucketId: string; bucketName: string; bucketType: string }[];
    }>('b2_list_buckets', {
      accountId: session.accountId,
      bucketName: this.bucketName,
    });
    const found = data.buckets?.[0];
    if (!found) {
      throw new ServiceUnavailableException(
        `Backblaze bucket "${this.bucketName}" was not found or the key cannot access it.`,
      );
    }
    this.bucket = {
      bucketId: found.bucketId,
      bucketName: found.bucketName,
      isPublic: found.bucketType === 'allPublic',
    };
    return this.bucket;
  }

  buildFileName(originalName: string): string {
    const base = (originalName || 'document')
      .replace(/\.pdf$/i, '')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
      .toLowerCase();
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${PDF_FOLDER}/${yyyy}/${mm}/${randomUUID()}${base ? `-${base}` : ''}.pdf`;
  }

  async uploadPdf(file: Express.Multer.File): Promise<PdfUploadResult> {
    const bucket = await this.getBucket();
    const fileName = this.buildFileName(file.originalname);
    const sha1 = createHash('sha1').update(file.buffer).digest('hex');

    console.log(
      `[BackblazeService] Uploading PDF ${file.originalname} (${file.size} bytes) -> ${fileName}`,
    );

    // Upload URLs can be busy/expired; retry once with a fresh one.
    for (let attempt = 0; attempt < 2; attempt++) {
      const target = await this.callApi<{
        uploadUrl: string;
        authorizationToken: string;
      }>('b2_get_upload_url', { bucketId: bucket.bucketId });
      try {
        await axios.post(target.uploadUrl, file.buffer, {
          headers: {
            Authorization: target.authorizationToken,
            'X-Bz-File-Name': this.encodePath(fileName),
            'Content-Type': 'application/pdf',
            'Content-Length': file.size,
            'X-Bz-Content-Sha1': sha1,
            'X-Bz-Info-b2-content-disposition': this.encodePath(
              `inline; filename="${fileName.split('/').pop()}"`,
            ),
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 5 * 60 * 1000,
        });
        break;
      } catch (error) {
        const status = (error as AxiosError).response?.status;
        const retryable =
          !status || status === 401 || status === 408 || status >= 500;
        if (attempt === 0 && retryable) continue;
        console.error(
          '[BackblazeService] Upload failed:',
          this.describe(error),
        );
        throw new BadGatewayException('Upload to Backblaze B2 failed');
      }
    }

    const { url, expiresAt } = await this.getFileUrl(fileName);
    console.log(`[BackblazeService] Uploaded ${fileName}`);
    return {
      fileName,
      originalName: file.originalname,
      size: file.size,
      url,
      isPublic: bucket.isPublic,
      expiresAt,
    };
  }

  /**
   * Public bucket: permanent friendly URL.
   * Private bucket: time-limited URL signed with a download authorization
   * scoped to this single file.
   */
  async getFileUrl(
    fileName: string,
  ): Promise<{ url: string; expiresAt: string | null }> {
    const bucket = await this.getBucket();
    const session = await this.authorize();
    const baseUrl = `${session.downloadUrl}/file/${encodeURIComponent(bucket.bucketName)}/${this.encodePath(fileName)}`;

    if (bucket.isPublic) {
      return { url: baseUrl, expiresAt: null };
    }

    const ttl = this.downloadTtlSeconds;
    const auth = await this.callApi<{ authorizationToken: string }>(
      'b2_get_download_authorization',
      {
        bucketId: bucket.bucketId,
        fileNamePrefix: fileName,
        validDurationInSeconds: ttl,
      },
    );
    return {
      url: `${baseUrl}?Authorization=${encodeURIComponent(auth.authorizationToken)}`,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  private encodePath(value: string) {
    return value.split('/').map(encodeURIComponent).join('/');
  }

  private describe(error: unknown) {
    const err = error as AxiosError;
    return err.response
      ? `${err.response.status} ${JSON.stringify(err.response.data)}`
      : err.message;
  }
}
