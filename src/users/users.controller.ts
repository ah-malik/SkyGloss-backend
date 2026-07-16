import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Req,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { ChatService } from '../chat/chat.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  User,
  UserDocument,
  UserRole,
  UserStatus,
} from './entities/user.entity';
import { GetUser } from '../common/decorators/get-user.decorator';
import { Request } from 'express';
import { ForbiddenException } from '@nestjs/common';
import { MailService } from 'src/mail/mail.service';
import { GLOBAL_HUB_PARTNER_CODE, isGlobalHubAccount, isGlobalHubPartnerCode } from '../common/global-hub';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly chatService: ChatService,
    private readonly mailService: MailService,
  ) { }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get('stats')
  @Roles(UserRole.ADMIN)
  getStats() {
    return this.usersService.getStats();
  }

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.MASTER_PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.DISTRIBUTOR,
    UserRole.PARTNER,
  )
  findAll() {
    return this.usersService.findAll();
  }


  @Get('referred-shops')
  @Roles(
    UserRole.MASTER_PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.SUB_PROMOTER,
    UserRole.DISTRIBUTOR,
    UserRole.PARTNER,
  )
  async getReferredShops(@GetUser() user: UserDocument) {
    const network = await this.usersService.findNetworkUsersForViewer(user);
    const globalHub = isGlobalHubAccount(user)
      ? await this.usersService.findByPartnerCode(GLOBAL_HUB_PARTNER_CODE)
      : null;
    return {
      ...network,
      globalHub,
      operationalRepresentativeCodes: user.operationalRepresentativeCodes ?? [],
      operationalPromoterCodes: user.operationalPromoterCodes ?? [],
    };
  }

  @Get('admin/network/:ownerId/links')
  @Roles(UserRole.ADMIN)
  getAdminNetworkLinks(@Param('ownerId') ownerId: string) {
    return this.usersService.adminGetNetworkLinks(ownerId);
  }

  @Get('admin/network/search-member')
  @Roles(UserRole.ADMIN)
  searchAdminNetworkMember(
    @Query('ownerId') ownerId: string,
    @Query('role') role: 'master_partner' | 'regional_partner',
    @Query('query') query: string,
  ) {
    return this.usersService.adminSearchNetworkMember(ownerId, role, query);
  }

  @Post('admin/network/add-member')
  @Roles(UserRole.ADMIN)
  addAdminNetworkMember(
    @Body('ownerId') ownerId: string,
    @Body('role') role: 'master_partner' | 'regional_partner',
    @Body('query') query: string,
    @Body('firstOrderPartnerDevelopmentRate')
    firstOrderPartnerDevelopmentRate?: number,
    @Body('firstOrderShopIntroductionRate')
    firstOrderShopIntroductionRate?: number,
  ) {
    return this.usersService.adminLinkNetworkMember(
      ownerId,
      role,
      query,
      firstOrderPartnerDevelopmentRate,
      firstOrderShopIntroductionRate,
    );
  }

  @Patch('admin/network/linked-representative-rate')
  @Roles(UserRole.ADMIN)
  updateLinkedRepresentativeRate(
    @Body('ownerId') ownerId: string,
    @Body('partnerCode') partnerCode: string,
    @Body('firstOrderPartnerDevelopmentRate')
    firstOrderPartnerDevelopmentRate: number,
    @Body('firstOrderShopIntroductionRate')
    firstOrderShopIntroductionRate?: number,
  ) {
    return this.usersService.adminUpdateLinkedRepresentativeRate(
      ownerId,
      partnerCode,
      firstOrderPartnerDevelopmentRate,
      firstOrderShopIntroductionRate,
    );
  }

  @Post('admin/network/remove-member')
  @Roles(UserRole.ADMIN)
  removeAdminNetworkMember(
    @Body('ownerId') ownerId: string,
    @Body('role') role: 'master_partner' | 'regional_partner',
    @Body('partnerCode') partnerCode: string,
  ) {
    return this.usersService.adminUnlinkNetworkMember(ownerId, role, partnerCode);
  }

  @Get('network/search-representative')
  @Roles(UserRole.MASTER_PARTNER)
  searchRepresentative(
    @Query('query') query: string,
    @GetUser() user: UserDocument,
  ) {
    return this.usersService.searchRepresentativeForLinking(query, user);
  }

  @Post('network/add-representative')
  @Roles(UserRole.MASTER_PARTNER)
  addRepresentative(
    @Body('query') query: string,
    @GetUser() user: UserDocument,
  ) {
    return this.usersService.linkRepresentativeToViewer(query, user);
  }

  @Get('partners-list')
  @Roles(UserRole.ADMIN, UserRole.MASTER_PARTNER)
  async getPartnersList() {
    return this.usersService.findAllPartners();
  }

  @Get('me/local-representative')
  getLocalRepresentative(@GetUser() user: UserDocument) {
    return this.usersService.getLocalRepresentativeForShop(user);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch('me/profile')
  async updateProfile(
    @GetUser() user: UserDocument,
    @Body() profileData: any,
  ) {
    const allowedFields = [
      'firstName',
      'lastName',
      'phoneNumber',
      'address',
      'streetAddress',
      'city',
      'zipCode',
      'country',
      'website',
      'facebook',
      'instagram',
      'youtube',
      'tiktok',
      'linkedin',
      'password',
      'hasSeenWelcomePopup',
      'profileImage',
    ];

    const updatePayload: any = {};
    for (const key of allowedFields) {
      if (profileData[key] !== undefined) {
        updatePayload[key] = profileData[key];
      }
    }

    return this.usersService.update(user._id.toString(), updatePayload, user);
  }

  @Post('me/profile-image')
  @UseInterceptors(FileInterceptor('image'))
  async uploadProfileImage(
    @GetUser() user: UserDocument,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Please provide an image file.');
    }
    const result = await this.cloudinaryService.uploadFile(file);
    return this.usersService.updateProfileImage(user._id.toString(), result.secure_url);
  }

  @Patch('referred-shops/:id/visibility')
  @Roles(
    UserRole.MASTER_PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.SUB_PROMOTER,
    UserRole.DISTRIBUTOR,
    UserRole.PARTNER,
  )
  async updateReferredShopVisibility(
    @Param('id') id: string,
    @Body('isVisibleOnMap') isVisibleOnMap: boolean,
    @GetUser() user: UserDocument,
  ) {
    const updatedUser = await this.usersService.updateShopVisibility(
      id,
      isVisibleOnMap,
      user,
    );
    if (!updatedUser) {
      throw new BadRequestException('User not found or you do not have permission to update map visibility.');
    }
    return updatedUser;
  }

  @Patch(':id/transfer-shop')
  @Roles(UserRole.ADMIN, UserRole.MASTER_PARTNER)
  async transferShop(
    @Param('id') id: string,
    @Body('partnerCode') partnerCode: string,
    @Req() req: any
  ) {
    // Extra security: If it's a partner calling, it must be the Global Hub
    if (req.user.role === UserRole.MASTER_PARTNER &&
      !isGlobalHubPartnerCode(req.user.partnerCode) &&
      req.user.email !== 'certified@skygloss.com' &&
      req.user.email !== 'globalhub@skygloss.com') {
      throw new ForbiddenException('Only the Global Hub can re-assign shops.');
    }
    return this.usersService.assignPartner(id, partnerCode);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.DISTRIBUTOR, UserRole.PARTNER, UserRole.CERTIFIED_SHOP)
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @GetUser() currentUser: UserDocument,
  ) {
    return this.usersService.update(id, updateUserDto, currentUser);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }


  @Patch('me/complete-course')
  completeCourse(
    @GetUser() user: UserDocument,
    @Body('courseName') courseName: string,
  ) {
    return this.usersService.completeCourse(user._id.toString(), courseName);
  }

  @Patch('me/course-progress')
  updateCourseProgress(
    @GetUser() user: UserDocument,
    @Body('courseName') courseName: string,
    @Body('stepId') stepId: string,
  ) {
    return this.usersService.updateCourseProgress(
      user._id.toString(),
      courseName,
      stepId,
    );
  }

  @Post('upload-certification-video')
  @UseInterceptors(FileInterceptor('video', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async uploadCertificationVideo(
    @GetUser() user: UserDocument,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Please provide a video file.');
    }
    if (!user.isSelfRegistered) {
      throw new BadRequestException('Only self-registered distributors can upload a certification video.');
    }

    const COURSE_STEPS = {
      WELCOME_TO_SKYGLOSS: 16,
      UNDERSTANDING_SKYGLOSS: 9,
      SOCIAL_MEDIA_COMMUNICATION: 11,
      SKYGLOSS_SHOP_SETUP: 4,
      FUSION: 20,
      RESIN_FILM: 7,
      SHINE: 6,
      MATTE: 6,
      SEAL: 5,
    };

    let completedCount = 0;
    const legacyCount = user.completedCourses?.length || 0;

    if (user.courseProgress) {
      const progressMap = JSON.parse(JSON.stringify(user.courseProgress || {}));
      Object.entries(COURSE_STEPS).forEach(([courseKey, totalSteps]) => {
        const progress = progressMap[courseKey] || progressMap[courseKey.replace('_', ' ')] || [];
        if (progress && progress.length >= totalSteps) {
          completedCount++;
        }
      });
    }

    completedCount = Math.max(completedCount, legacyCount);

    if (completedCount < 9) {
      throw new BadRequestException('You must complete all 9 courses before uploading a certification video.');
    }

    // Upload to Cloudinary
    const result = await this.cloudinaryService.uploadVideo(file);
    const updatedUser = await this.usersService.updateCertificationVideoUrl(user._id.toString(), result.secure_url);

    // Notify Admins
    if (updatedUser) {
      const notificationMessage = `${updatedUser.firstName} ${updatedUser.lastName} has submitted their final certification video for review.`;
      await this.notificationsService.create({
        type: NotificationType.CERT_VIDEO_UPLOADED,
        title: 'New Certification Video',
        message: notificationMessage,
        user: updatedUser._id.toString() as any, // Mongoose schema compatibility
      });

      this.notificationsGateway.broadcastNotification({
        title: 'New Certification Video',
        message: notificationMessage,
        type: NotificationType.CERT_VIDEO_UPLOADED,
      });
    }

    return {
      message: 'Video uploaded successfully',
      videoUrl: updatedUser?.certificationVideoUrl,
    };
  }

  @Post('me/training-complete')
  async completeTraining(@GetUser() user: UserDocument) {
    if (user.isTrainingComplete) {
      return { message: 'Training already marked as complete' };
    }

    // Verify all courses are actually completed before finalizing
    const COURSE_STEPS = {
      WELCOME_TO_SKYGLOSS: 16,
      UNDERSTANDING_SKYGLOSS: 9,
      SOCIAL_MEDIA_COMMUNICATION: 11,
      SKYGLOSS_SHOP_SETUP: 4,
      FUSION: 20,
      RESIN_FILM: 7,
      SHINE: 6,
      MATTE: 6,
      SEAL: 5,
    };

    let completedCount = 0;
    const legacyCount = user.completedCourses?.length || 0;

    if (user.courseProgress) {
      const progressMap = JSON.parse(JSON.stringify(user.courseProgress || {}));
      Object.entries(COURSE_STEPS).forEach(([courseKey, totalSteps]) => {
        const progress = progressMap[courseKey] || progressMap[courseKey.replace('_', ' ')] || [];
        if (progress && progress.length >= totalSteps) {
          completedCount++;
        }
      });
    }

    completedCount = Math.max(completedCount, legacyCount);

    if (completedCount < 9) {
      throw new BadRequestException('You must complete all 9 training courses before finalizing certification.');
    }
    const updatedUser = await this.usersService.update(user._id.toString(), {
      isTrainingComplete: true,
    } as any, user);

    // Ensure they have an active chat room implicitly connected to them
    const existingRoom = await this.chatService.createOrGetRoom({
      userId: user._id.toString(),
      userName: `${user.firstName} ${user.lastName}`,
      userEmail: user.email || 'no-email@skygloss.com',
      userType: user.role,
    });

    const notificationMessage = `${user.firstName} ${user.lastName} has 100% completed all available SkyGloss training courses.`;

    // Notify Admins
    if (updatedUser) {
      await this.notificationsService.create({
        type: NotificationType.TRAINING_COMPLETED,
        title: 'Network Training Completed',
        message: notificationMessage,
        user: user._id.toString() as any,
      });

      this.notificationsGateway.broadcastNotification({
        title: 'Network Training Completed',
        message: notificationMessage,
        type: NotificationType.TRAINING_COMPLETED,
      });
    }

    // Notify Referring Partner
    if (user.referredByPartnerCode) {
      const partner = await this.usersService.findByPartnerCode(user.referredByPartnerCode);
      if (partner) {
        await this.notificationsService.create({
          type: NotificationType.TRAINING_COMPLETED,
          title: 'Shop Training Completed',
          message: `${user.firstName} ${user.lastName} has completed all training modules and is awaiting your certification.`,
          user: partner._id.toString() as any,
          link: '/dashboard/partner/network',
        });
      }
    }

    // Send Training Complete Email Notification to user and certified@skygloss.com
    this.mailService.sendTrainingCompleteNotification(user).catch(err => {
      console.error('Failed to send training complete email:', err);
    });

    return { message: 'Training completion submitted successfully.', roomId: (existingRoom as any)._id };
  }

}

