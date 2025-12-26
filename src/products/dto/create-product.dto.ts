import {
    IsString,
    IsNotEmpty,
    IsEnum,
    IsArray,
    IsOptional,
    IsNumber,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class SpecificationDto {
    @IsString()
    @IsNotEmpty()
    label: string;

    @IsString()
    @IsNotEmpty()
    value: string;
}

class SizeDto {
    @IsString()
    @IsNotEmpty()
    size: string;

    @IsNumber()
    @IsNotEmpty()
    price: number;
}

export class CreateProductDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsNotEmpty()
    description: string;

    @IsString()
    @IsNotEmpty()
    category: string;

    @IsNumber()
    @IsOptional()
    stock?: number;

    @IsArray()
    @IsString({ each: true })
    @IsNotEmpty()
    images: string[];

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    features?: string[];

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SpecificationDto)
    @IsOptional()
    specifications?: SpecificationDto[];

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    applicationGuide?: string[];

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SizeDto)
    @IsOptional()
    sizes?: SizeDto[];

    @IsString()
    @IsOptional()
    technicalSheetUrl?: string;

    @IsString()
    @IsOptional()
    @IsEnum(['published', 'draft'])
    status?: string;
}
