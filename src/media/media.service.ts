import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  BackblazeService,
  MAX_DOWNLOAD_TTL_SECONDS,
} from '../backblaze/backblaze.service';
import { MediaFile, MediaFileDocument } from './entities/media-file.entity';
import {
  CompleteUploadDto,
  CreateUploadDto,
  ListMediaQueryDto,
} from './dto/media.dto';
import {
  MEDIA_CATEGORIES,
  MEDIA_ROOT,
  MediaCategory,
  buildMediaFileName,
  categoryForContentType,
  LEGACY_PREFIXES,
  categoryForFileName,
  originalNameFromFileName,
  resolveContentType,
} from './media-types';

// Signed URLs for thumbnails/previews inside the admin panel.
const VIEW_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const VIEW_TOKEN_RENEW_BEFORE_MS = 60 * 60 * 1000;
// B2 bills in decimal GB; the free tier is 10 GB.
const DEFAULT_STORAGE_LIMIT_GB = 10;
const ABANDONED_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;

type MediaLean = MediaFile & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

@Injectable()
export class MediaService {
  private viewToken: { token: string; expiresAt: number } | null = null;

  constructor(
    @InjectModel(MediaFile.name)
    private readonly mediaModel: Model<MediaFileDocument>,
    private readonly backblaze: BackblazeService,
  ) {}

  private get shareTtlSeconds() {
    const raw = Number(process.env.B2_DOWNLOAD_URL_TTL_SECONDS);
    if (!Number.isFinite(raw) || raw <= 0) return MAX_DOWNLOAD_TTL_SECONDS;
    return Math.min(Math.floor(raw), MAX_DOWNLOAD_TTL_SECONDS);
  }

  private get storageLimitBytes() {
    const gb = Number(process.env.B2_STORAGE_LIMIT_GB);
    return (
      (Number.isFinite(gb) && gb > 0 ? gb : DEFAULT_STORAGE_LIMIT_GB) * 1e9
    );
  }

  /** One token scoped to the media folder, reused for every thumbnail in the library. */
  private async getViewToken(): Promise<string | undefined> {
    const bucket = await this.backblaze.getBucket();
    if (bucket.isPublic) return undefined;
    if (
      this.viewToken &&
      this.viewToken.expiresAt - Date.now() > VIEW_TOKEN_RENEW_BEFORE_MS
    ) {
      return this.viewToken.token;
    }
    const token = await this.backblaze.getDownloadAuthorization(
      MEDIA_ROOT,
      VIEW_TOKEN_TTL_SECONDS,
    );
    this.viewToken = {
      token,
      expiresAt: Date.now() + VIEW_TOKEN_TTL_SECONDS * 1000,
    };
    return token;
  }

  private async serialize(doc: MediaLean, viewToken?: string) {
    return {
      id: String(doc._id),
      originalName: doc.originalName,
      fileName: doc.fileName,
      category: doc.category,
      contentType: doc.contentType,
      size: doc.size,
      createdAt: doc.createdAt,
      url: await this.backblaze.buildFileUrl(doc.fileName, viewToken),
    };
  }

  async list(query: ListMediaQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 40;
    const filter: Record<string, unknown> = {};
    if (query.category) filter.category = query.category;
    const search = query.search?.trim();
    if (search) {
      filter.originalName = {
        $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      };
    }

    const [docs, total] = await Promise.all([
      this.mediaModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<MediaLean[]>(),
      this.mediaModel.countDocuments(filter),
    ]);
    const viewToken = docs.length ? await this.getViewToken() : undefined;
    const items = await Promise.all(
      docs.map((doc) => this.serialize(doc, viewToken)),
    );
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getStats() {
    const [usage, grouped] = await Promise.all([
      this.backblaze.getBucketUsage(),
      this.mediaModel.aggregate<{
        _id: MediaCategory;
        count: number;
        bytes: number;
      }>([
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            bytes: { $sum: '$size' },
          },
        },
      ]),
    ]);
    const categories = Object.fromEntries(
      MEDIA_CATEGORIES.map((category) => {
        const row = grouped.find((g) => g._id === category);
        return [category, { count: row?.count ?? 0, bytes: row?.bytes ?? 0 }];
      }),
    ) as Record<MediaCategory, { count: number; bytes: number }>;
    const limitBytes = this.storageLimitBytes;
    return {
      usedBytes: usage.bytes,
      limitBytes,
      remainingBytes: Math.max(0, limitBytes - usage.bytes),
      bucketFiles: usage.files,
      totalFiles: MEDIA_CATEGORIES.reduce(
        (sum, c) => sum + categories[c].count,
        0,
      ),
      categories,
    };
  }

  /**
   * Starts a direct browser -> B2 upload. Small files get a single upload URL;
   * bigger files use B2's large-file API so there is no practical size limit.
   */
  async createUpload(dto: CreateUploadDto) {
    const contentType = resolveContentType(dto.originalName, dto.contentType);
    const category = categoryForContentType(contentType);
    if (!category) {
      throw new BadRequestException(
        'Only images, videos and PDF files are allowed',
      );
    }
    const fileName = buildMediaFileName(
      category,
      dto.originalName,
      randomUUID(),
    );
    const partSize = await this.backblaze.getPartSize(dto.size);

    if (dto.size <= partSize) {
      const target = await this.backblaze.getUploadUrl();
      return {
        mode: 'single' as const,
        fileName,
        contentType,
        category,
        uploadUrl: target.uploadUrl,
        authorizationToken: target.authorizationToken,
      };
    }

    const fileId = await this.backblaze.startLargeFile(fileName, contentType);
    return {
      mode: 'large' as const,
      fileName,
      contentType,
      category,
      fileId,
      partSize,
      totalParts: Math.ceil(dto.size / partSize),
    };
  }

  getUploadPartUrl(fileId: string) {
    return this.backblaze.getUploadPartUrl(fileId);
  }

  async finishLargeUpload(fileId: string, partSha1Array: string[]) {
    const info = await this.backblaze.finishLargeFile(fileId, partSha1Array);
    return { fileId: info.fileId, fileName: info.fileName };
  }

  async cancelLargeUpload(fileId: string) {
    await this.backblaze.cancelLargeFile(fileId);
    return { cancelled: true };
  }

  /** Records a finished upload after checking it really exists in the bucket. */
  async completeUpload(dto: CompleteUploadDto, userId?: string) {
    const existing = await this.mediaModel
      .findOne({ fileId: dto.fileId })
      .lean<MediaLean>();
    if (existing) return this.serialize(existing, await this.getViewToken());

    const info = await this.backblaze.getFileInfo(dto.fileId);
    const bucket = await this.backblaze.getBucket();
    const category = categoryForFileName(info.fileName);
    if (
      info.bucketId !== bucket.bucketId ||
      !category ||
      categoryForContentType(info.contentType) !== category
    ) {
      throw new BadRequestException('This file is not a media library upload');
    }

    const created = await this.mediaModel.create({
      originalName: dto.originalName,
      fileName: info.fileName,
      fileId: info.fileId,
      category,
      contentType: info.contentType,
      size: info.contentLength,
      uploadedBy:
        userId && Types.ObjectId.isValid(userId)
          ? new Types.ObjectId(userId)
          : undefined,
    });
    this.backblaze.adjustUsage(info.contentLength, 1);
    return this.serialize(
      created.toObject() as MediaLean,
      await this.getViewToken(),
    );
  }

  private async findOrFail(id: string): Promise<MediaLean> {
    const doc = Types.ObjectId.isValid(id)
      ? await this.mediaModel.findById(id).lean<MediaLean>()
      : null;
    if (!doc) throw new NotFoundException('Media file not found');
    return doc;
  }

  /** Shareable link scoped to this single file (temporary when the bucket is private). */
  async getShareUrl(id: string) {
    const doc = await this.findOrFail(id);
    const bucket = await this.backblaze.getBucket();
    if (bucket.isPublic) {
      return {
        url: await this.backblaze.buildFileUrl(doc.fileName),
        expiresAt: null,
      };
    }
    const ttl = this.shareTtlSeconds;
    const token = await this.backblaze.getDownloadAuthorization(
      doc.fileName,
      ttl,
    );
    return {
      url: await this.backblaze.buildFileUrl(doc.fileName, token),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  async remove(id: string) {
    const doc = await this.findOrFail(id);
    try {
      await this.backblaze.deleteFile(doc.fileName, doc.fileId);
      this.backblaze.adjustUsage(-doc.size, -1);
    } catch (error) {
      // Already gone from the bucket: still drop the library entry.
      if (!(error instanceof NotFoundException)) throw error;
    }
    await this.mediaModel.deleteOne({ _id: doc._id });
    return { deleted: true };
  }

  /**
   * Adds files that are in the bucket but missing from the library: uploads whose
   * final step never reached the API, and files from the earlier PDF uploader
   * (those are moved into the media folder so library links can reach them).
   */
  async syncFromBucket(userId?: string) {
    const [bucketFiles, known] = await Promise.all([
      this.backblaze.listFileNames(),
      this.mediaModel.find({}, { fileId: 1 }).lean<{ fileId: string }[]>(),
    ]);
    const knownIds = new Set(known.map((d) => d.fileId));
    const result = { imported: 0, moved: 0, skipped: 0 };

    for (const file of bucketFiles) {
      if (knownIds.has(file.fileId)) continue;
      const contentType = resolveContentType(file.fileName, file.contentType);
      const category = categoryForContentType(contentType);
      const isMedia = file.fileName.startsWith(MEDIA_ROOT);
      const isLegacy = LEGACY_PREFIXES.some((p) => file.fileName.startsWith(p));
      if (!category || (!isMedia && !isLegacy)) {
        result.skipped++;
        continue;
      }
      if (isMedia && categoryForFileName(file.fileName) !== category) {
        result.skipped++;
        continue;
      }

      const originalName = originalNameFromFileName(file.fileName);
      let stored = file;
      if (isLegacy) {
        stored = await this.backblaze.copyFile(
          file.fileId,
          buildMediaFileName(category, originalName, randomUUID()),
        );
        await this.backblaze.deleteFile(file.fileName, file.fileId);
        result.moved++;
      }

      await this.mediaModel.create({
        originalName,
        fileName: stored.fileName,
        fileId: stored.fileId,
        category,
        contentType,
        size: stored.contentLength,
        uploadedBy:
          userId && Types.ObjectId.isValid(userId)
            ? new Types.ObjectId(userId)
            : undefined,
      });
      result.imported++;
    }

    this.backblaze.resetUsage();
    return result;
  }

  /** Abandoned large uploads keep their parts (and storage cost) until cancelled. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupAbandonedUploads() {
    if (!process.env.B2_KEY_ID || !process.env.B2_BUCKET_NAME) return;
    try {
      const unfinished =
        await this.backblaze.listUnfinishedLargeFiles(MEDIA_ROOT);
      const cutoff = Date.now() - ABANDONED_UPLOAD_AGE_MS;
      for (const file of unfinished) {
        if (file.uploadTimestamp < cutoff) {
          await this.backblaze.cancelLargeFile(file.fileId);
          console.log(
            `[MediaService] Cancelled abandoned upload ${file.fileName}`,
          );
        }
      }
    } catch (error) {
      console.error('[MediaService] Abandoned upload cleanup failed:', error);
    }
  }
}
