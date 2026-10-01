import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { RegistrationFeesService } from './registration-fees.service';
import { CreateRegistrationFeeGroupDto, UpdateRegistrationFeeGroupDto } from './dto/registration-fee-group.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { getEuropeVatRatePercent } from '../common/europe-vat';
import { roundMoney } from '../common/order-monetary';

@Controller('registration-fees')
export class RegistrationFeesController {
  constructor(private readonly registrationFeesService: RegistrationFeesService) {}

  @Get('public/by-country/:country')
  async getFeeByCountry(@Param('country') country: string) {
    const fee = await this.registrationFeesService.findByCountry(country);
    const vatRate = getEuropeVatRatePercent(country);
    if (!fee) {
      const feeAmount = 250;
      const taxAmount =
        vatRate != null && vatRate > 0
          ? roundMoney((feeAmount * vatRate) / 100)
          : 0;
      return { feeAmount, taxAmount, currency: 'USD', vatRate: vatRate ?? 0 };
    }
    const feeAmount = fee.feeAmount;
    const taxAmount =
      vatRate != null
        ? roundMoney((feeAmount * vatRate) / 100)
        : fee.taxAmount || 0;
    const plain =
      typeof (fee as any).toObject === 'function'
        ? (fee as any).toObject()
        : { ...fee };
    return {
      ...plain,
      taxAmount,
      vatRate: vatRate ?? 0,
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateRegistrationFeeGroupDto) {
    return this.registrationFeesService.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.registrationFeesService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.registrationFeesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateRegistrationFeeGroupDto) {
    return this.registrationFeesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.registrationFeesService.remove(id);
  }
}
