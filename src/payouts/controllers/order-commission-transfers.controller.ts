import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderCommissionTransferService } from '../services/order-commission-transfer.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';
import { ORDER_COMMISSION_TRANSFER_STATUSES } from '../entities/order-commission-transfer.entity';

@Controller('order-commission-transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class OrderCommissionTransfersController {
  constructor(private readonly transfers: OrderCommissionTransferService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const normalized = ORDER_COMMISSION_TRANSFER_STATUSES.includes(
      status as (typeof ORDER_COMMISSION_TRANSFER_STATUSES)[number],
    )
      ? (status as (typeof ORDER_COMMISSION_TRANSFER_STATUSES)[number])
      : undefined;
    return this.transfers.listTransfers({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 30,
      status: normalized,
    });
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.transfers.getTransfer(id);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.transfers.retryTransfer(id);
  }
}
