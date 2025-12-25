import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateCertificationDto {
  @IsNotEmpty()
  @IsString()
  country: string;

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
  shopCity: string;
}
