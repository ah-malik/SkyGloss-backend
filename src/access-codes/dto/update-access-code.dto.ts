import { PartialType } from '@nestjs/mapped-types';
import { CreateAccessCodeDto } from './create-access-code.dto';

export class UpdateAccessCodeDto extends PartialType(CreateAccessCodeDto) {}
