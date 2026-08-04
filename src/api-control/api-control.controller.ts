import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiControlService } from './api-control.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import {
  BulkSetPortalDto,
  UpdateApiControlDto,
} from './dto/update-api-control.dto';

@Controller('api-control')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ApiControlController {
  constructor(private readonly apiControlService: ApiControlService) {}

  @Get()
  getSettings() {
    return this.apiControlService.getSettings();
  }

  @Patch()
  updateSettings(@Body() body: UpdateApiControlDto) {
    return this.apiControlService.applyUpdates(
      body.securityCode,
      body.updates || [],
    );
  }

  @Post('bulk')
  bulkSet(@Body() body: BulkSetPortalDto) {
    const portal = body.portal === 'admin' ? 'admin' : 'frontend';
    return this.apiControlService.bulkSetPortal(
      body.securityCode,
      portal,
      !!body.enabled,
    );
  }
}
