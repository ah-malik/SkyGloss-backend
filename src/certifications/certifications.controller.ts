import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { CertificationsService } from './certifications.service';
import { CreateCertificationDto } from './dto/create-certification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { GetUser } from '../common/decorators/get-user.decorator';
import { RequestStatus } from './entities/certification.entity';

@Controller('certifications')
export class CertificationsController {
  constructor(private readonly certificationsService: CertificationsService) {}

  @Post('checkout-session')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER)
  createCheckoutSession(
    @GetUser('_id') userId: string,
    @Body() createDto: CreateCertificationDto,
  ) {
    return this.certificationsService.createCheckoutSession(userId, createDto);
  }

  @Get('my-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER)
  getMyRequests(@GetUser('_id') userId: string) {
    return this.certificationsService.getMyRequests(userId);
  }

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getAllRequests() {
    return this.certificationsService.getAllRequests();
  }

  @Get('admin/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getCertificationStatusSummary() {
    return this.certificationsService.getCertificationStatusSummary();
  }

  @Post('admin/email-summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  emailCertificationStatusSummary(@Body('email') email: string) {
    return this.certificationsService.emailCertificationStatusSummary(email);
  }

  @Patch('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateStatus(@Param('id') id: string, @Body('status') status: RequestStatus) {
    return this.certificationsService.updateStatus(id, status);
  }

  @Get('verify-payment/:sessionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER)
  async verifyPayment(@Param('sessionId') sessionId: string) {
    return this.certificationsService.verifyPayment(sessionId);
  }

  @Get('admin/verify-payment/:sessionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminVerifyPayment(@Param('sessionId') sessionId: string) {
    return this.certificationsService.verifyPayment(sessionId);
  }

  @Post('webhook')
  async handleWebhook(@Req() req: RawBodyRequest<any>) {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    return this.certificationsService.handleWebhook(sig, req.rawBody);
  }
}
