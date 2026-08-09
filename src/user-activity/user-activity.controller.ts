import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { UserActivityService } from './user-activity.service';

@Controller('admin/user-activity')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class UserActivityController {
  constructor(private readonly userActivityService: UserActivityService) {}

  @Get('countries')
  listCountries() {
    return this.userActivityService.listCountries();
  }

  @Get()
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('portal') portal?: string,
    @Query('country') country?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.userActivityService.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
      search,
      action,
      userId,
      portal,
      country,
      from,
      to,
    });
  }
}
