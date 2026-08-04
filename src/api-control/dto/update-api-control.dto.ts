import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ApiToggleUpdateDto {
  @IsString()
  id: string;

  @IsBoolean()
  enabled: boolean;
}

export class UpdateApiControlDto {
  @IsString()
  securityCode: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApiToggleUpdateDto)
  updates: ApiToggleUpdateDto[];
}

export class BulkSetPortalDto {
  @IsString()
  securityCode: string;

  @IsString()
  portal: 'frontend' | 'admin';

  @IsBoolean()
  enabled: boolean;
}
