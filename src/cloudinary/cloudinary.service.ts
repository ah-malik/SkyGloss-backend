import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryResponse } from './cloudinary.response';
const toStream = require('buffer-to-stream');

@Injectable()
export class CloudinaryService {
    constructor() {
        console.log('[CloudinaryService] Initialized. Checking configuration...');
        console.log('- Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME ? 'SET' : 'MISSING');
        console.log('- API Key:', process.env.CLOUDINARY_API_KEY ? 'SET' : 'MISSING');
        console.log('- API Secret:', process.env.CLOUDINARY_API_SECRET ? 'SET' : 'MISSING');
    }

    uploadFile(file: Express.Multer.File): Promise<CloudinaryResponse> {
        return new Promise((resolve, reject) => {
            console.log(`[CloudinaryService] Starting upload for file: ${file.originalname} (${file.size} bytes)`);

            const upload = cloudinary.uploader.upload_stream((error, result) => {
                if (error) {
                    console.error('[CloudinaryService] Upload error details:', JSON.stringify(error, null, 2));
                    return reject(error);
                }
                if (!result) {
                    console.error('[CloudinaryService] Upload failed: No result returned from Cloudinary');
                    return reject(new Error('Cloudinary upload failed: No result returned'));
                }
                console.log(`[CloudinaryService] Successfully uploaded: ${file.originalname} -> ${result.secure_url}`);
                resolve(result);
            });

            toStream(file.buffer).pipe(upload);
        });
    }

    async uploadImages(files: Express.Multer.File[]): Promise<string[]> {
        if (!files || files.length === 0) {
            console.warn('[CloudinaryService] No files provided for upload');
            return [];
        }
        console.log(`[CloudinaryService] Batch uploading ${files.length} images...`);
        const uploadPromises = files.map((file) => this.uploadFile(file));
        const results = await Promise.all(uploadPromises);
        return results.map((result) => result.secure_url);
    }
}
