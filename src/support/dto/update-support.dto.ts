import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateSupportDto } from './create-support.dto';
import { TicketStatus } from '../entities/support.entity';

export class UpdateSupportDto extends PartialType(CreateSupportDto) {
  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @IsOptional()
  adminReply?: string;
}
