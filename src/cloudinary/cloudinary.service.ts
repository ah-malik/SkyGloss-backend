import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryResponse } from './cloudinary.response';
import { CHAT_IMAGE_FOLDER } from '../chat/chat-image.constants';
const toStream = require('buffer-to-stream');

@Injectable()
export class CloudinaryService {
  constructor() {
    console.log('[CloudinaryService] Initialized. Checking configuration...');
    console.log(
      '- Cloud Name:',
      process.env.CLOUDINARY_CLOUD_NAME ? 'SET' : 'MISSING',
    );
    console.log(
      '- API Key:',
      process.env.CLOUDINARY_API_KEY ? 'SET' : 'MISSING',
    );
    console.log(
      '- API Secret:',
      process.env.CLOUDINARY_API_SECRET ? 'SET' : 'MISSING',
    );
  }

  uploadFile(file: Express.Multer.File): Promise<CloudinaryResponse> {
    return new Promise((resolve, reject) => {
      console.log(
        `[CloudinaryService] Starting upload for file: ${file.originalname} (${file.size} bytes)`,
      );

      const upload = cloudinary.uploader.upload_stream(
        { resource_type: 'auto' },
        (error, result) => {
        if (error) {
          console.error(
            '[CloudinaryService] Upload error details:',
            JSON.stringify(error, null, 2),
          );
          return reject(error);
        }
        if (!result) {
          console.error(
            '[CloudinaryService] Upload failed: No result returned from Cloudinary',
          );
          return reject(
            new Error('Cloudinary upload failed: No result returned'),
          );
        }
        console.log(
          `[CloudinaryService] Successfully uploaded: ${file.originalname} -> ${result.secure_url}`,
        );
        resolve(result);
      });

      toStream(file.buffer).pipe(upload);
    });
  }

  uploadVideo(file: Express.Multer.File): Promise<CloudinaryResponse> {
    return new Promise((resolve, reject) => {
      console.log(
        `[CloudinaryService] Starting VIDEO upload for file: ${file.originalname} (${file.size} bytes)`,
      );

      const upload = cloudinary.uploader.upload_stream(
        { resource_type: 'video' },
        (error, result) => {
          if (error) {
            console.error(
              '[CloudinaryService] Video upload error details:',
              JSON.stringify(error, null, 2),
            );
            return reject(error);
          }
          if (!result) {
            console.error(
              '[CloudinaryService] Video upload failed: No result returned from Cloudinary',
            );
            return reject(
              new Error('Cloudinary video upload failed: No result returned'),
            );
          }
          console.log(
            `[CloudinaryService] Successfully uploaded VIDEO: ${file.originalname} -> ${result.secure_url}`,
          );
          resolve(result);
        },
      );

      toStream(file.buffer).pipe(upload);
    });
  }

  uploadChatImage(file: Express.Multer.File): Promise<CloudinaryResponse> {
    return new Promise((resolve, reject) => {
      console.log(
        `[CloudinaryService] Starting CHAT image upload: ${file.originalname} (${file.size} bytes)`,
      );

      const upload = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          folder: CHAT_IMAGE_FOLDER,
          tags: ['chat-image'],
        },
        (error, result) => {
          if (error) {
            console.error(
              '[CloudinaryService] Chat image upload error:',
              JSON.stringify(error, null, 2),
            );
            return reject(error);
          }
          if (!result) {
            return reject(
              new Error('Cloudinary chat image upload failed: No result returned'),
            );
          }
          console.log(
            `[CloudinaryService] Chat image uploaded: ${file.originalname} -> ${result.secure_url}`,
          );
          resolve(result);
        },
      );

      toStream(file.buffer).pipe(upload);
    });
  }

  async listChatImages(options?: {
    maxResults?: number;
    nextCursor?: string;
    direction?: 'asc' | 'desc';
  }) {
    return cloudinary.api.resources({
      type: 'upload',
      resource_type: 'image',
      prefix: `${CHAT_IMAGE_FOLDER}/`,
      max_results: options?.maxResults ?? 100,
      next_cursor: options?.nextCursor,
      direction: options?.direction ?? 'asc',
    });
  }

  async deleteFiles(publicIds: string[]): Promise<void> {
    if (!publicIds.length) return;
    await cloudinary.api.delete_resources(publicIds, {
      resource_type: 'image',
    });
  }

  async uploadImages(files: Express.Multer.File[]): Promise<string[]> {
    if (!files || files.length === 0) {
      console.warn('[CloudinaryService] No files provided for upload');
      return [];
    }
    console.log(
      `[CloudinaryService] Batch uploading ${files.length} images...`,
    );
    const uploadPromises = files.map((file) => this.uploadFile(file));
    const results = await Promise.all(uploadPromises);
    return results.map((result) => result.secure_url);
  }
}
