import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';

const B2_AUTH_URL = 'https://api.backblazeb2.com/b2api/v3/b2_authorize_account';
// B2 auth tokens last 24h; refresh a bit earlier.
const AUTH_TTL_MS = 23 * 60 * 60 * 1000;
const USAGE_CACHE_MS = 5 * 60 * 1000;
export const MAX_DOWNLOAD_TTL_SECONDS = 7 * 24 * 60 * 60; // B2 maximum
export const MAX_LARGE_FILE_PARTS = 10000; // B2 maximum

interface B2Session {
  apiUrl: string;
  downloadUrl: string;
  authorizationToken: string;
  accountId: string;
  recommendedPartSize: number;
  absoluteMinimumPartSize: number;
  expiresAt: number;
}

interface B2AuthorizeResponse {
  accountId: string;
  authorizationToken: string;
  apiInfo: {
    storageApi: {
      apiUrl: string;
      downloadUrl: string;
      recommendedPartSize: number;
      absoluteMinimumPartSize: number;
    };
  };
}

export interface B2Bucket {
  bucketId: string;
  bucketName: string;
  isPublic: boolean;
}

export interface B2FileInfo {
  fileId: string;
  fileName: string;
  bucketId: string;
  contentLength: number;
  contentType: string;
  uploadTimestamp: number;
}

export interface B2UploadTarget {
  uploadUrl: string;
  authorizationToken: string;
}

/** Thin client over the Backblaze B2 native API (v3). Credentials stay server-side. */
@Injectable()
export class BackblazeService {
  private session: B2Session | null = null;
  private bucket: B2Bucket | null = null;
  private usage: { bytes: number; files: number; at: number } | null = null;

  private get keyId() {
    return process.env.B2_KEY_ID || '';
  }

  private get applicationKey() {
    return process.env.B2_APPLICATION_KEY || '';
  }

  private get bucketName() {
    return process.env.B2_BUCKET_NAME || '';
  }

  private assertConfigured() {
    if (!this.keyId || !this.applicationKey || !this.bucketName) {
      throw new ServiceUnavailableException(
        'Backblaze B2 is not configured (B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME).',
      );
    }
  }

  async authorize(force = false): Promise<B2Session> {
    if (!force && this.session && this.session.expiresAt > Date.now()) {
      return this.session;
    }
    this.assertConfigured();
    try {
      const res = await axios.get<B2AuthorizeResponse>(B2_AUTH_URL, {
        auth: { username: this.keyId, password: this.applicationKey },
        timeout: 15000,
      });
      const storage = res.data.apiInfo.storageApi;
      this.session = {
        apiUrl: storage.apiUrl,
        downloadUrl: storage.downloadUrl,
        authorizationToken: res.data.authorizationToken,
        accountId: res.data.accountId,
        recommendedPartSize: storage.recommendedPartSize,
        absoluteMinimumPartSize: storage.absoluteMinimumPartSize,
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
        const res = await axios.post<T>(
          `${session.apiUrl}/b2api/v3/${endpoint}`,
          body,
          {
            headers: { Authorization: session.authorizationToken },
            timeout: 30000,
          },
        );
        return res.data;
      } catch (error) {
        const status = (error as AxiosError).response?.status;
        if (attempt === 0 && status === 401) continue;
        console.error(
          `[BackblazeService] ${endpoint} failed:`,
          this.describe(error),
        );
        if (status === 404) {
          throw new NotFoundException('File not found in Backblaze B2');
        }
        if (status === 400) {
          throw new BadRequestException('Backblaze B2 rejected the request');
        }
        throw new BadGatewayException('Backblaze B2 request failed');
      }
    }
    throw new BadGatewayException('Backblaze B2 request failed');
  }

  async getBucket(): Promise<B2Bucket> {
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

  /** Chooses a part size that keeps the file within B2's 10,000-part limit. */
  async getPartSize(totalBytes: number): Promise<number> {
    const session = await this.authorize();
    return Math.max(
      session.recommendedPartSize,
      session.absoluteMinimumPartSize,
      Math.ceil(totalBytes / MAX_LARGE_FILE_PARTS),
    );
  }

  async getUploadUrl(): Promise<B2UploadTarget> {
    const bucket = await this.getBucket();
    return this.callApi<B2UploadTarget>('b2_get_upload_url', {
      bucketId: bucket.bucketId,
    });
  }

  async startLargeFile(fileName: string, contentType: string): Promise<string> {
    const bucket = await this.getBucket();
    const res = await this.callApi<{ fileId: string }>('b2_start_large_file', {
      bucketId: bucket.bucketId,
      fileName,
      contentType,
    });
    return res.fileId;
  }

  getUploadPartUrl(fileId: string): Promise<B2UploadTarget> {
    return this.callApi<B2UploadTarget>('b2_get_upload_part_url', { fileId });
  }

  finishLargeFile(fileId: string, partSha1Array: string[]) {
    return this.callApi<B2FileInfo>('b2_finish_large_file', {
      fileId,
      partSha1Array,
    });
  }

  async cancelLargeFile(fileId: string): Promise<void> {
    await this.callApi('b2_cancel_large_file', { fileId });
  }

  async listUnfinishedLargeFiles(namePrefix: string): Promise<B2FileInfo[]> {
    const bucket = await this.getBucket();
    const files: B2FileInfo[] = [];
    let startFileId: string | null = null;
    do {
      const res: { files: B2FileInfo[]; nextFileId: string | null } =
        await this.callApi('b2_list_unfinished_large_files', {
          bucketId: bucket.bucketId,
          namePrefix,
          maxFileCount: 100,
          ...(startFileId ? { startFileId } : {}),
        });
      files.push(...res.files);
      startFileId = res.nextFileId;
    } while (startFileId);
    return files;
  }

  getFileInfo(fileId: string): Promise<B2FileInfo> {
    return this.callApi<B2FileInfo>('b2_get_file_info', { fileId });
  }

  async deleteFile(fileName: string, fileId: string): Promise<void> {
    await this.callApi('b2_delete_file_version', { fileName, fileId });
  }

  /** Download token for every file under `fileNamePrefix` (an exact name scopes it to one file). */
  async getDownloadAuthorization(
    fileNamePrefix: string,
    validDurationInSeconds: number,
  ): Promise<string> {
    const bucket = await this.getBucket();
    const res = await this.callApi<{ authorizationToken: string }>(
      'b2_get_download_authorization',
      {
        bucketId: bucket.bucketId,
        fileNamePrefix,
        validDurationInSeconds: Math.min(
          Math.max(1, Math.floor(validDurationInSeconds)),
          MAX_DOWNLOAD_TTL_SECONDS,
        ),
      },
    );
    return res.authorizationToken;
  }

  async buildFileUrl(fileName: string, downloadToken?: string) {
    const bucket = await this.getBucket();
    const session = await this.authorize();
    const url = `${session.downloadUrl}/file/${encodeURIComponent(bucket.bucketName)}/${this.encodePath(fileName)}`;
    return downloadToken
      ? `${url}?Authorization=${encodeURIComponent(downloadToken)}`
      : url;
  }

  /** Total bytes stored in the bucket (all file versions). Cached for a few minutes. */
  async getBucketUsage(): Promise<{ bytes: number; files: number }> {
    if (this.usage && Date.now() - this.usage.at < USAGE_CACHE_MS) {
      return { bytes: this.usage.bytes, files: this.usage.files };
    }
    const bucket = await this.getBucket();
    let bytes = 0;
    let files = 0;
    let startFileName: string | null = null;
    let startFileId: string | null = null;
    do {
      const res: {
        files: { contentLength: number; action: string }[];
        nextFileName: string | null;
        nextFileId: string | null;
      } = await this.callApi('b2_list_file_versions', {
        bucketId: bucket.bucketId,
        maxFileCount: 10000,
        ...(startFileName ? { startFileName } : {}),
        ...(startFileId ? { startFileId } : {}),
      });
      for (const file of res.files) {
        if (file.action !== 'upload') continue;
        bytes += file.contentLength || 0;
        files += 1;
      }
      startFileName = res.nextFileName;
      startFileId = res.nextFileId;
    } while (startFileName);
    this.usage = { bytes, files, at: Date.now() };
    return { bytes, files };
  }

  /** Keeps the cached usage accurate after uploads/deletes without re-listing the bucket. */
  adjustUsage(deltaBytes: number, deltaFiles: number) {
    if (!this.usage) return;
    this.usage.bytes = Math.max(0, this.usage.bytes + deltaBytes);
    this.usage.files = Math.max(0, this.usage.files + deltaFiles);
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
