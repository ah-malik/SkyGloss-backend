import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WithdrawalsService } from '../services/withdrawals.service';
import { CreateWithdrawalDto } from '../dto/create-withdrawal.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { UserRole } from '../../users/entities/user.entity';
import { UserDocument } from '../../users/entities/user.entity';
import {
  WITHDRAWAL_ELIGIBLE_ROLES,
  PAYOUT_VIEW_ROLES,
} from '../payout-roles';

@Controller('withdrawals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Get('available-balance')
  @Roles(...WITHDRAWAL_ELIGIBLE_ROLES)
  async getAvailableBalance(@GetUser('_id') userId: string) {
    const balance = await this.withdrawalsService.getAvailableBalance(userId);
    return { available: balance, currency: 'USD' };
  }

  @Get('hubs')
  @Roles(...WITHDRAWAL_ELIGIBLE_ROLES)
  listWithdrawalHubs(@GetUser('_id') userId: string) {
    return this.withdrawalsService.listWithdrawalHubs(userId);
  }

  @Post()
  @Roles(...WITHDRAWAL_ELIGIBLE_ROLES)
  submit(@GetUser('_id') userId: string, @Body() dto: CreateWithdrawalDto) {
    return this.withdrawalsService.submitWithdrawal(userId, dto);
  }

  @Get('my')
  @Roles(...WITHDRAWAL_ELIGIBLE_ROLES)
  listMine(@GetUser('_id') userId: string) {
    return this.withdrawalsService.listMyWithdrawals(userId);
  }

  @Get('hub/network')
  @Roles(UserRole.PARTNER)
  listHubNetwork(@GetUser('_id') userId: string) {
    return this.withdrawalsService.listHubNetworkWithdrawals(userId);
  }

  @Get('hub/pending')
  @Roles(UserRole.PARTNER)
  listHubPending(@GetUser('_id') userId: string) {
    return this.withdrawalsService.listHubPending(userId);
  }

  @Get('admin/all')
  @Roles(UserRole.ADMIN)
  listAdminAll(@Query('status') status?: string) {
    return this.withdrawalsService.listAdminAll(status);
  }

  @Get('admin/pending')
  @Roles(UserRole.ADMIN)
  listAdminPending() {
    return this.withdrawalsService.listAdminPending();
  }

  @Get(':id')
  @Roles(...PAYOUT_VIEW_ROLES, UserRole.ADMIN)
  getDetail(@Param('id') id: string, @GetUser() user: UserDocument) {
    return this.withdrawalsService.getWithdrawalDetail(
      id,
      user._id.toString(),
      user.role,
    );
  }

  @Patch(':id/hub-review')
  @Roles(UserRole.PARTNER)
  hubReview(
    @Param('id') id: string,
    @GetUser('_id') userId: string,
    @Body() body: { action: 'approve' | 'reject'; note?: string },
  ) {
    return this.withdrawalsService.hubReview(id, userId, body.action, body.note);
  }

  @Patch(':id/admin-review')
  @Roles(UserRole.ADMIN)
  adminReview(
    @Param('id') id: string,
    @GetUser('_id') userId: string,
    @Body() body: { action: 'approve' | 'reject'; note?: string },
  ) {
    return this.withdrawalsService.adminReview(id, userId, body.action, body.note);
  }

  @Patch(':id/resume-after-bank')
  @Roles(...WITHDRAWAL_ELIGIBLE_ROLES)
  resumeAfterBank(@Param('id') id: string, @GetUser('_id') userId: string) {
    return this.withdrawalsService.attachBankAndResume(id, userId);
  }
}
