import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccountActivationService } from './account-activation.service';
import { SubmitAccountActivationDto } from './dto/submit-account-activation.dto';
import { HubReviewActivationDto } from './dto/hub-review-activation.dto';
import { AdminActivateDto } from './dto/admin-activate.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';
import { UserRole } from '../users/entities/user.entity';
import { ACCOUNT_ACTIVATION_ELIGIBLE_ROLES } from './account-activation.roles';
import { SIGNATURE_UPLOAD_MAX_BYTES } from './signature-upload';

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

  /** Uploaded signature image (≤ 500 KB, compressed in the browser) → Media Library. */
  @Post('signature-image')
  @Roles(...ACCOUNT_ACTIVATION_ELIGIBLE_ROLES)
  @UseInterceptors(
    // A little headroom so the service can answer with a clear size message.
    FileInterceptor('signature', {
      limits: { fileSize: SIGNATURE_UPLOAD_MAX_BYTES * 2 },
    }),
  )
  uploadSignatureImage(
    @GetUser('_id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.accountActivationService.uploadSignatureImage(userId, file);
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

  @Get('admin/requests')
  @Roles(UserRole.ADMIN)
  adminList(@Query('status') status?: string) {
    return this.accountActivationService.adminList(status);
  }

  @Get('admin/requests/:id')
  @Roles(UserRole.ADMIN)
  adminGetOne(@Param('id') id: string) {
    return this.accountActivationService.adminGetOne(id);
  }

  @Patch('admin/requests/:id/approve')
  @Roles(UserRole.ADMIN)
  adminApprove(
    @Param('id') id: string,
    @GetUser('_id') adminId: string,
    @Body() dto: AdminActivateDto,
  ) {
    return this.accountActivationService.adminApprove(id, adminId, dto.note);
  }

  @Patch('admin/users/:userId/activate')
  @Roles(UserRole.ADMIN)
  adminActivateUser(
    @Param('userId') userId: string,
    @GetUser('_id') adminId: string,
    @Body() dto: AdminActivateDto,
  ) {
    return this.accountActivationService.adminActivateUser(
      userId,
      adminId,
      dto.note,
    );
  }

  @Patch('admin/users/:userId/deactivate')
  @Roles(UserRole.ADMIN)
  adminDeactivateUser(@Param('userId') userId: string) {
    return this.accountActivationService.adminDeactivateUser(userId);
  }
}
