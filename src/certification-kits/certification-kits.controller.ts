import { Body, Controller, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';
import { UserDocument, UserRole } from '../users/entities/user.entity';
import { CertificationKitBuilderService } from './certification-kit-builder.service';
import { CERTIFICATION_KIT_OWNER_ROLES } from './certification-kits.service';
import {
  RejectCertificationKitDto,
  ReviewCertificationKitDto,
  SaveCertificationKitDto,
} from './dto/save-certification-kit.dto';

@Controller('certification-kits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CertificationKitsController {
  constructor(private readonly builder: CertificationKitBuilderService) {}

  @Get('me')
  @Roles(...CERTIFICATION_KIT_OWNER_ROLES)
  getMine(@GetUser() user: UserDocument) {
    return this.builder.getMine(user);
  }

  /** Sends the kit to SkyGloss: it waits for Admin approval before shops see it. */
  @Put('me')
  @Roles(...CERTIFICATION_KIT_OWNER_ROLES)
  saveMine(@GetUser() user: UserDocument, @Body() dto: SaveCertificationKitDto) {
    return this.builder.saveMine(user, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  listForAdmin(@Query('status') status?: string) {
    return this.builder.listForAdmin(status);
  }

  @Patch(':id/approve')
  @Roles(UserRole.ADMIN)
  approve(
    @Param('id') id: string,
    @GetUser('_id') adminId: string,
    @Body() dto: ReviewCertificationKitDto,
  ) {
    return this.builder.approve(id, String(adminId), dto?.savedAt);
  }

  @Patch(':id/reject')
  @Roles(UserRole.ADMIN)
  reject(
    @Param('id') id: string,
    @GetUser('_id') adminId: string,
    @Body() dto: RejectCertificationKitDto,
  ) {
    return this.builder.reject(id, String(adminId), dto.note, dto.savedAt);
  }
}
