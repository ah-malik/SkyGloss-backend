import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCertificationDto {
  @IsNotEmpty()
  @IsString()
  country: string;

  @IsNotEmpty()
  @IsString()
  distributorName: string;

  @IsNotEmpty()
  @IsString()
  requesterName: string;

  @IsNotEmpty()
  @IsString()
  shopName: string;

  @IsNotEmpty()
  @IsEmail()
  shopEmail: string;

  @IsNotEmpty()
  @IsString()
  shopPhone: string;

  @IsNotEmpty()
  @IsString()
  shopAddress: string;

  @IsNotEmpty()
  @IsString()
  shopCity: string;

  @IsNotEmpty()
  @IsString()
  shopState: string;

  @IsNotEmpty()
  @IsString()
  shopZip: string;

  @IsOptional()
  @IsString()
  shopInstagram?: string;

  @IsOptional()
  @IsString()
  shopWebsite?: string;

  @IsOptional()
  @IsString()
  shopFacebook?: string;
}
