import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CommissionsService } from '../services/commissions.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { UserRole } from '../../users/entities/user.entity';
import { WITHDRAWAL_ELIGIBLE_ROLES } from '../payout-roles';

const PAYOUT_ROLES = [...WITHDRAWAL_ELIGIBLE_ROLES];

@Controller('commissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommissionsController {
  constructor(private readonly commissionsService: CommissionsService) {}

  @Get('summary')
  @Roles(...PAYOUT_ROLES)
  getSummary(@GetUser('_id') userId: string) {
    return this.commissionsService.getSummary(userId);
  }

  @Get()
  @Roles(...PAYOUT_ROLES)
  list(
    @GetUser('_id') userId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.commissionsService.listForUser(userId, {
      status,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  /** One-time migration: create commission records from existing shipped orders */
  @Post('admin/backfill')
  @Roles(UserRole.ADMIN)
  async backfill() {
    const created = await this.commissionsService.backfillFromExistingOrders();
    await this.commissionsService.releaseAvailableCommissions();
    return { created, message: 'Backfill complete' };
  }
}
