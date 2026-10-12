import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccountActivationService } from './account-activation.service';
import { SubmitAccountActivationDto } from './dto/submit-account-activation.dto';
import { HubReviewActivationDto } from './dto/hub-review-activation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';
import { UserRole } from '../users/entities/user.entity';
import { ACCOUNT_ACTIVATION_ELIGIBLE_ROLES } from './account-activation.roles';

@Controller('account-activation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountActivationController {
  constructor(
    private readonly accountActivationService: AccountActivationService,
  ) {}

  @Get('my')
  @Roles(...ACCOUNT_ACTIVATION_ELIGIBLE_ROLES)
  getMine(@GetUser('_id') userId: string) {
    return this.accountActivationService.getMyStatus(userId);
  }

  @Post('submit')
  @Roles(...ACCOUNT_ACTIVATION_ELIGIBLE_ROLES)
  submit(
    @GetUser('_id') userId: string,
    @Body() dto: SubmitAccountActivationDto,
  ) {
    return this.accountActivationService.submit(userId, dto);
  }

  @Get('hub/pending')
  @Roles(UserRole.PARTNER)
  listHubPending(@GetUser('_id') userId: string) {
    return this.accountActivationService.listHubPending(userId);
  }

  @Patch(':id/hub-review')
  @Roles(UserRole.PARTNER)
  hubReview(
    @Param('id') id: string,
    @GetUser('_id') userId: string,
    @Body() dto: HubReviewActivationDto,
  ) {
    return this.accountActivationService.hubReview(
      id,
      userId,
      dto.action,
      dto.note,
    );
  }
}
