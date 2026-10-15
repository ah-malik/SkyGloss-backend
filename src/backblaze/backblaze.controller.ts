import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { BackblazeService } from './backblaze.service';

const MAX_PDF_BYTES = 50 * 1024 * 1024;

function isPdf(file?: Express.Multer.File): boolean {
  if (!file?.buffer?.length) return false;
  const hasPdfName = /\.pdf$/i.test(file.originalname || '');
  const hasPdfMime = ['application/pdf', 'application/octet-stream'].includes(
    file.mimetype,
  );
  // Every PDF starts with "%PDF-"; don't trust the client-reported type alone.
  const hasPdfSignature =
    file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  return hasPdfName && hasPdfMime && hasPdfSignature;
}

@Controller('backblaze')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class BackblazeController {
  constructor(private readonly backblazeService: BackblazeService) {}

  @Post('pdf')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES, files: 1 } }),
  )
  async uploadPdf(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Please select a PDF file to upload');
    }
    if (!isPdf(file)) {
      throw new BadRequestException('Only PDF files are allowed');
    }
    return this.backblazeService.uploadPdf(file);
  }

  /** Issues a fresh URL for a previously uploaded PDF (e.g. after a signed URL expired). */
  @Get('pdf/url')
  async getPdfUrl(@Query('fileName') fileName?: string) {
    if (
      !fileName ||
      !fileName.startsWith('pdfs/') ||
      !fileName.toLowerCase().endsWith('.pdf') ||
      fileName.includes('..')
    ) {
      throw new BadRequestException('Invalid fileName');
    }
    return { fileName, ...(await this.backblazeService.getFileUrl(fileName)) };
  }
}
