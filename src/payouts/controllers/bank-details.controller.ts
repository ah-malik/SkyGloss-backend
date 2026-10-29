import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { BankDetailsService } from '../services/bank-details.service';
import { WithdrawalsService } from '../services/withdrawals.service';
import { HubProductCommissionService } from '../services/hub-product-commission.service';
import { UserDocument, UserRole } from '../../users/entities/user.entity';
import { CreateBankDetailsDto } from '../dto/create-bank-details.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { WITHDRAWAL_ELIGIBLE_ROLES } from '../payout-roles';

// Hub: only the 10% product-commission Hubs (checked per request).
const PAYOUT_ROLES = [...WITHDRAWAL_ELIGIBLE_ROLES, UserRole.PARTNER];

@Controller('bank-details')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BankDetailsController {
  constructor(
    private readonly bankDetailsService: BankDetailsService,
    private readonly withdrawalsService: WithdrawalsService,
    private readonly hubProductCommission: HubProductCommissionService,
  ) {}

  private assertCanUseBankDetails(user: UserDocument) {
    if (user?.role === UserRole.PARTNER) {
      this.hubProductCommission.assertEligible(user);
    }
  }

  @Get('my')
  @Roles(...PAYOUT_ROLES)
  getMine(@GetUser() user: UserDocument) {
    this.assertCanUseBankDetails(user);
    return this.bankDetailsService.getMyBankDetails(String(user._id));
  }

  @Get('wise-requirements')
  @Roles(...PAYOUT_ROLES)
  wiseRequirements(
    @GetUser() user: UserDocument,
    @Query('country') country: string,
    @Query('currency') currency?: string,
  ) {
    this.assertCanUseBankDetails(user);
    return this.bankDetailsService.getWiseRequirements(country, currency);
  }

  @Post()
  @Roles(...PAYOUT_ROLES)
  async upsert(@GetUser() user: UserDocument, @Body() dto: CreateBankDetailsDto) {
    this.assertCanUseBankDetails(user);
    const userId = String(user._id);
    const bank = await this.bankDetailsService.upsertPrimary(userId, dto);
    try {
      await this.withdrawalsService.resumeWaitingWithdrawalsForUser(
        userId?.toString?.() || userId,
      );
    } catch (err) {
      console.error(
        '[BankDetailsController] Withdrawal resume after bank save failed',
        err,
      );
    }
    return bank;
  }
}
