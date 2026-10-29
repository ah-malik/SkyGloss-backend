import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { WithdrawalsService } from '../services/withdrawals.service';
import { HubProductCommissionService } from '../services/hub-product-commission.service';
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
  constructor(
    private readonly withdrawalsService: WithdrawalsService,
    private readonly hubProductCommission: HubProductCommissionService,
  ) {}

  /** Hub 10% product commission payouts (allowlisted Hubs only). */
  @Get('hub-commission/summary')
  @Roles(UserRole.PARTNER)
  async hubCommissionSummary(@GetUser() user: UserDocument) {
    if (!this.hubProductCommission.isEligible(user)) return { eligible: false };
    return this.hubProductCommission.getSummary(user);
  }

  @Post('hub-commission')
  @Roles(UserRole.PARTNER)
  submitHubCommission(
    @GetUser('_id') userId: string,
    @Body() body: { amount: number },
  ) {
    return this.withdrawalsService.submitHubProductCommissionWithdrawal(
      String(userId),
      Number(body?.amount),
    );
  }

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
  @Roles(...WITHDRAWAL_ELIGIBLE_ROLES, UserRole.PARTNER)
  listMine(@GetUser('_id') userId: string) {
    return this.withdrawalsService.listMyWithdrawals(userId);
  }

  @Get('hub/network')
  @Roles(UserRole.PARTNER, UserRole.DISTRIBUTOR)
  listHubNetwork(@GetUser('_id') userId: string) {
    return this.withdrawalsService.listHubNetworkWithdrawals(userId);
  }

  @Get('hub/pending')
  @Roles(UserRole.PARTNER, UserRole.DISTRIBUTOR)
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

  @Get('admin/wise-account')
  @Roles(UserRole.ADMIN)
  getWiseAccount() {
    return this.withdrawalsService.getWiseAccountMeta();
  }

  @Get('admin/wise-balance')
  @Roles(UserRole.ADMIN)
  getWiseBalance() {
    return this.withdrawalsService.getWiseAccountSummary();
  }

  @Get(':id/reveal-amounts')
  @Roles(UserRole.ADMIN)
  revealAmounts(@Param('id') id: string) {
    return this.withdrawalsService.revealAdminAmounts(id);
  }

  /**
   * Payout invoice PDF once Admin approved — the requester only (Admin amounts
   * stay behind reveal-amounts).
   */
  @Get(':id/invoice')
  @Roles(...WITHDRAWAL_ELIGIBLE_ROLES, UserRole.PARTNER)
  async downloadInvoice(
    @Param('id') id: string,
    @GetUser('_id') userId: string,
    @Res() res: Response,
  ) {
    const { fileName, pdf } = await this.withdrawalsService.getInvoicePdf(
      id,
      String(userId),
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
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
  @Roles(UserRole.PARTNER, UserRole.DISTRIBUTOR)
  hubReview(
    @Param('id') id: string,
    @GetUser('_id') userId: string,
    @Body() body: { action: 'approve' | 'reject'; note?: string },
  ) {
    return this.withdrawalsService.hubReview(id, userId, body.action, body.note);
  }

  @Patch(':id/verify-bank')
  @Roles(UserRole.ADMIN)
  verifyBank(@Param('id') id: string, @GetUser('_id') userId: string) {
    return this.withdrawalsService.verifyBankForAdmin(id, userId);
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
