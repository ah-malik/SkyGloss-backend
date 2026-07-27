import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { EmailSettingsService } from './email-settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { EmailTemplateVersion } from './entities/email-settings.entity';

@Controller('email-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class EmailSettingsController {
  constructor(private readonly emailSettingsService: EmailSettingsService) {}

  @Get()
  getSettings() {
    return this.emailSettingsService.getSettings();
  }

  @Patch()
  setTemplateVersion(
    @Body() body: { templateVersion: EmailTemplateVersion },
  ) {
    const version =
      body?.templateVersion === 'latest' ? 'latest' : 'legacy';
    return this.emailSettingsService.setTemplateVersion(version);
  }
}
