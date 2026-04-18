import { PartialType } from '@nestjs/mapped-types';
import { CreateShopRequestDto } from './create-shop-request.dto';

export class UpdateShopRequestDto extends PartialType(CreateShopRequestDto) {}
