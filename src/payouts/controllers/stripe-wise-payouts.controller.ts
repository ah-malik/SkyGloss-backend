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
import { StripeWisePayoutsService } from '../services/stripe-wise-payouts.service';
import { CreateStripeWisePayoutDto } from '../dto/create-stripe-wise-payout.dto';
import { UpdateStripeWiseDestinationDto } from '../dto/update-stripe-wise-destination.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { UserRole } from '../../users/entities/user.entity';

@Controller('stripe-wise-payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class StripeWisePayoutsController {
  constructor(private readonly payouts: StripeWisePayoutsService) {}

  @Get('overview')
  getOverview() {
    return this.payouts.getOverview();
  }

  @Get('destination')
  getDestination() {
    return this.payouts.getDestination();
  }

  @Patch('destination')
  updateDestination(@Body() dto: UpdateStripeWiseDestinationDto) {
    return this.payouts.updateDestination(dto);
  }

  @Post('destination/from-wise')
  importFromWise() {
    return this.payouts.importDestinationFromWise();
  }

  @Get('history')
  listHistory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payouts.listHistory(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 30,
    );
  }

  @Get(':id')
  getPayout(@Param('id') id: string) {
    return this.payouts.getPayout(id);
  }

  @Post()
  createPayout(
    @GetUser('_id') adminId: string,
    @Body() dto: CreateStripeWisePayoutDto,
  ) {
    return this.payouts.createPayout(String(adminId), dto);
  }
}
