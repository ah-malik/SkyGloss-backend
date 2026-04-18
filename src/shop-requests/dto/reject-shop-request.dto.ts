import { IsString, IsNotEmpty } from 'class-validator';

export class RejectShopRequestDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
