import { Controller, Get, UseGuards } from '@nestjs/common';
import { WalletsService } from '../services/wallets.service';
import { AuditService } from '../services/audit.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { WITHDRAWAL_ELIGIBLE_ROLES } from '../payout-roles';

const PAYOUT_ROLES = [...WITHDRAWAL_ELIGIBLE_ROLES];

@Controller('wallets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('my')
  @Roles(...PAYOUT_ROLES)
  getWallet(@GetUser('_id') userId: string) {
    return this.walletsService.getWalletSummary(userId);
  }

  @Get('my/transactions')
  @Roles(...PAYOUT_ROLES)
  getWalletTransactions(@GetUser('_id') userId: string) {
    return this.walletsService.getTransactions(userId);
  }

  @Get('my/history')
  @Roles(...PAYOUT_ROLES)
  getTransactionHistory(@GetUser('_id') userId: string) {
    return this.auditService.getUserTransactions(userId);
  }
}
