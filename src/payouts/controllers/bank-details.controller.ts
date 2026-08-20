import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { BankDetailsService } from '../services/bank-details.service';
import { CreateBankDetailsDto } from '../dto/create-bank-details.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { WITHDRAWAL_ELIGIBLE_ROLES } from '../payout-roles';

const PAYOUT_ROLES = [...WITHDRAWAL_ELIGIBLE_ROLES];

@Controller('bank-details')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BankDetailsController {
  constructor(private readonly bankDetailsService: BankDetailsService) {}

  @Get('my')
  @Roles(...PAYOUT_ROLES)
  getMine(@GetUser('_id') userId: string) {
    return this.bankDetailsService.getMyBankDetails(userId);
  }

  @Get('wise-requirements')
  @Roles(...PAYOUT_ROLES)
  wiseRequirements(
    @Query('country') country: string,
    @Query('currency') currency?: string,
  ) {
    return this.bankDetailsService.getWiseRequirements(country, currency);
  }

  @Post()
  @Roles(...PAYOUT_ROLES)
  upsert(@GetUser('_id') userId: string, @Body() dto: CreateBankDetailsDto) {
    return this.bankDetailsService.upsertPrimary(userId, dto);
  }
}
