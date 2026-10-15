import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MEDIA_CATEGORIES, MediaCategory } from '../media-types';
import { MAX_LARGE_FILE_PARTS } from '../../backblaze/backblaze.service';

// B2's maximum object size is 10 TB.
const MAX_FILE_BYTES = 10 * 1000 ** 4;

export class CreateUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  originalName: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contentType?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FILE_BYTES)
  size: number;
}

export class FinishLargeUploadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LARGE_FILE_PARTS)
  @Matches(/^[a-f0-9]{40}$/, { each: true })
  partSha1Array: string[];
}

export class CompleteUploadDto {
  @IsString()
  @IsNotEmpty()
  fileId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  originalName: string;
}

export class ListMediaQueryDto {
  @IsOptional()
  @IsIn(MEDIA_CATEGORIES)
  category?: MediaCategory;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
