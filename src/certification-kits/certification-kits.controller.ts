import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';
import { UserDocument } from '../users/entities/user.entity';
import { CertificationKitBuilderService } from './certification-kit-builder.service';
import { CERTIFICATION_KIT_OWNER_ROLES } from './certification-kits.service';
import { SaveCertificationKitDto } from './dto/save-certification-kit.dto';

@Controller('certification-kits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CertificationKitsController {
  constructor(private readonly builder: CertificationKitBuilderService) {}

  @Get('me')
  @Roles(...CERTIFICATION_KIT_OWNER_ROLES)
  getMine(@GetUser() user: UserDocument) {
    return this.builder.getMine(user);
  }

  @Put('me')
  @Roles(...CERTIFICATION_KIT_OWNER_ROLES)
  saveMine(@GetUser() user: UserDocument, @Body() dto: SaveCertificationKitDto) {
    return this.builder.saveMine(user, dto);
  }
}
