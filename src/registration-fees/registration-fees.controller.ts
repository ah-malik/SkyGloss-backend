import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { RegistrationFeesService } from './registration-fees.service';
import { CreateRegistrationFeeGroupDto, UpdateRegistrationFeeGroupDto } from './dto/registration-fee-group.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('registration-fees')
export class RegistrationFeesController {
  constructor(private readonly registrationFeesService: RegistrationFeesService) {}

  @Get('public/by-country/:country')
  async getFeeByCountry(@Param('country') country: string) {
    const fee = await this.registrationFeesService.findByCountry(country);
    if (!fee) return { feeAmount: 250, currency: 'USD' }; // Fallback
    return fee;
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
