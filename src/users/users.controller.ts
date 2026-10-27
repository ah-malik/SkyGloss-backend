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
import { PartnerAgreementFilesService } from './partner-agreement-files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { ChatService } from '../chat/chat.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  CreateHubNetworkMemberDto,
  UpdateHubNetworkMemberDto,
} from './dto/hub-network-member.dto';
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
import { isPartnerNetworkRole } from '../common/role-labels';
import { UserActivityService } from '../user-activity/user-activity.service';
import { UserActivityAction } from '../user-activity/entities/user-activity-log.entity';
import { getRequestMeta } from '../user-activity/request-meta';
import {
  countCompletedRequiredCourses,
  isTrainingRequirementSatisfied,
} from '../common/course-completion';
import * as crypto from 'crypto';
import { Types } from 'mongoose';

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
    private readonly userActivityService: UserActivityService,
    private readonly partnerAgreementFiles: PartnerAgreementFilesService,
  ) { }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(
    @Body() createUserDto: CreateUserDto,
    @Req() req: Request,
    @GetUser() admin: UserDocument,
  ) {
    const user = await this.usersService.create(createUserDto);
    await this.afterManagedCreate(user, createUserDto, req, admin, 'admin');
    return user;
  }

  /**
   * Hub "Add user": Distributor / Representative / Promoter under the Hub's
   * own Partner ID. Gets the same onboarding email as an Admin-created partner.
   */
  @Post('hub/network-members')
  @Roles(UserRole.PARTNER)
  async createHubNetworkMember(
    @Body() dto: CreateHubNetworkMemberDto,
    @Req() req: Request,
    @GetUser() hub: UserDocument,
  ) {
    const user = await this.usersService.createHubNetworkMember(hub, dto);
    await this.afterManagedCreate(user, dto, req, hub, 'partner');
    return this.hubMemberView(user);
  }

  /** Hub edits / blocks its own Distributor / Representative / Promoter. */
  @Patch('hub/network-members/:id')
  @Roles(UserRole.PARTNER)
  async updateHubNetworkMember(
    @Param('id') id: string,
    @Body() dto: UpdateHubNetworkMemberDto,
    @GetUser() hub: UserDocument,
  ) {
    const user = await this.usersService.updateHubNetworkMember(hub, id, dto);
    return user ? this.hubMemberView(user) : null;
  }

  /** No password / token fields in Hub responses. */
  private hubMemberView(user: UserDocument) {
    const u: any = (user as any).toObject?.() ?? user;
    return {
      _id: String(u._id),
      role: u.role,
      partnerCode: u.partnerCode,
      referredByPartnerCode: u.referredByPartnerCode,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phoneNumber: u.phoneNumber,
      companyName: u.companyName,
      address: u.address,
      city: u.city,
      country: u.country,
      state: u.state,
      zipCode: u.zipCode,
      status: u.status,
      createdAt: u.createdAt,
    };
  }

  /** Activity log + onboarding email for an Admin- or Hub-created account. */
  private async afterManagedCreate(
    user: UserDocument,
    createUserDto: { password?: string; country?: string },
    req: Request,
    actor: UserDocument,
    portal: 'admin' | 'partner',
  ) {
    const meta = getRequestMeta(req);
    await this.userActivityService.log({
      userId: (user as any)._id.toString(),
      action: UserActivityAction.REGISTER,
      actorId: actor?._id?.toString(),
      portal,
      country: (user as any).country || createUserDto.country,
      ...meta,
      metadata: {
        method: portal === 'admin' ? 'admin_create' : 'hub_create',
        registrationType: portal === 'admin' ? 'admin' : 'hub',
        role: (user as any).role,
        email: (user as any).email,
        country: (user as any).country || createUserDto.country,
        partnerCode: (user as any).partnerCode,
        status: (user as any).status,
        actorEmail: actor?.email,
        actorRole: actor?.role,
      },
    });

    // Admin/Hub-created partner network accounts: bind Access Now token + send email.
    // Soft-fail so a mail outage never blocks account creation.
    if (
      isPartnerNetworkRole((user as any).role) &&
      createUserDto.password &&
      (user as any).email &&
      !(user as any).isSelfRegistered
    ) {
      const setupToken = crypto.randomBytes(32).toString('hex');
      const setupExpires = new Date();
      setupExpires.setDate(setupExpires.getDate() + 7); // 7 days to complete setup

      await this.usersService.setPartnerPasswordSetupToken(
        (user as any)._id.toString(),
        setupToken,
        setupExpires,
      );

      this.mailService
        .sendPartnerOnboardingCredentialsEmail((user as any).email, {
          ...((user as any).toObject?.() ?? user),
          plainPassword: createUserDto.password,
          passwordSetupToken: setupToken,
        })
        .catch((err) =>
          console.error(
            'Failed to send partner onboarding credentials email',
            err,
          ),
        );
    }
  }

  /** Optional agreement file for a new Rep / Promoter / Distributor (Add User). */
  @Post('admin-agreement')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('agreement', { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  uploadAdminAgreement(@UploadedFile() file: Express.Multer.File) {
    // Private B2 bucket; returns the key that POST /users stores.
    return this.partnerAgreementFiles.upload(file);
  }

  /** Signed link to the Admin-uploaded agreement (Edit User). */
  @Get(':id/admin-agreement-url')
  @Roles(UserRole.ADMIN)
  async getAdminAgreementUrl(@Param('id') id: string) {
    const user = await this.usersService.findOne(id);
    if (!user?.adminAgreementKey) {
      throw new BadRequestException('No uploaded agreement for this user.');
    }
    const url = await this.partnerAgreementFiles.signedUrl(
      user.adminAgreementKey,
    );
    if (!url) {
      throw new BadRequestException(
        'Could not open the agreement right now. Please try again.',
      );
    }
    return { url, fileName: user.adminAgreementFileName || null };
  }

  @Get('stats')
  @Roles(UserRole.ADMIN)
  getStats() {
    return this.usersService.getStats();
  }

  @Get('countries-summary')
  @Roles(UserRole.ADMIN)
  getCountriesSummary() {
    return this.usersService.getCountriesSummary();
  }

  @Get('deleted')
  @Roles(UserRole.ADMIN)
  findSoftDeleted() {
    return this.usersService.findSoftDeletedUsers();
  }

  // Full user list: Admin only. Portals read their own network via
  // GET /users/referred-shops.
  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.usersService.findAll();
  }


  @Get('referred-shops')
  @Roles(
    UserRole.MASTER_PARTNER,
    UserRole.REGIONAL_PARTNER,
    // UserRole.SUB_PROMOTER, // removed — migrated to Promoter
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

  /**
   * All Representatives (and Promoters for Shop Intro) available for
   * Admin / Hub Shop Intro + Operational Support assignment.
   * Not scoped to the viewer's Hub subtree — any rep may be assigned.
   */
  @Get('shop-assignment-options')
  @Roles(UserRole.ADMIN, UserRole.PARTNER)
  getShopAssignmentOptions() {
    return this.usersService.findShopAssignmentOptions();
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

  // Promoter linking is admin-only via POST users/admin/network/add-member.
  // Self-service search/add endpoints intentionally disabled.
  // @Get('network/search-promoter')
  // @Roles(UserRole.REGIONAL_PARTNER)
  // searchPromoter(...) { ... }
  // @Post('network/add-promoter')
  // @Roles(UserRole.REGIONAL_PARTNER)
  // addPromoter(...) { ... }

  @Get('partners-list')
  @Roles(UserRole.ADMIN, UserRole.MASTER_PARTNER)
  async getPartnersList() {
    return this.usersService.findAllPartners();
  }

  @Get('me/local-representative')
  getLocalRepresentative(@GetUser() user: UserDocument) {
    return this.usersService.getShopProfileNetworkContacts(user);
  }

  /** Operational Support shops + order counts for the logged-in Representative. */
  @Get('me/operational-support-summary')
  @Roles(UserRole.MASTER_PARTNER)
  getOperationalSupportSummary(@GetUser() user: UserDocument) {
    return this.usersService.getOperationalSupportSummary(user);
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
      'shopName',
      'companyName',
      'phoneNumber',
      'address',
      'streetAddress',
      'city',
      'state',
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
      'preferredLanguage',
      'businessHours',
    ];

    const updatePayload: any = {};
    for (const key of allowedFields) {
      if (profileData[key] !== undefined) {
        updatePayload[key] = profileData[key];
      }
    }

    // Hub-only: optional receive-only additional email (not for login).
    if (
      user.role === UserRole.PARTNER &&
      profileData.additionalEmail !== undefined
    ) {
      updatePayload.additionalEmail = profileData.additionalEmail;
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
    // UserRole.SUB_PROMOTER, // removed
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

  @Patch('referred-shops/:id/d-value-invoice')
  @Roles(UserRole.PARTNER, UserRole.DISTRIBUTOR, UserRole.ADMIN)
  updateShopDValueInvoice(
    @Param('id') id: string,
    @Body('enabled') enabled: boolean,
    @GetUser() user: UserDocument,
  ) {
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('enabled must be true or false');
    }
    return this.usersService.setShopDValueInvoiceEnabled(id, enabled, user);
  }

  @Patch('referred-shops/:id/pickup')
  @Roles(UserRole.PARTNER, UserRole.DISTRIBUTOR, UserRole.ADMIN)
  updateShopPickup(
    @Param('id') id: string,
    @Body('enabled') enabled: boolean,
    @GetUser() user: UserDocument,
  ) {
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('enabled must be true or false');
    }
    return this.usersService.setShopPickupEnabled(id, enabled, user);
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

  /**
   * Fields a non-Admin may send on PATCH /users/:id: shop actions from the
   * partner portal (certify, block, map, shop network & commission rates).
   * Own profile → PATCH /users/me/profile; Hub members →
   * PATCH /users/hub/network-members/:id. Everything else is Admin-only.
   */
  private static readonly NETWORK_SHOP_UPDATE_FIELDS = [
    'isCertified',
    'isVisibleOnMap',
    'status',
    'referredByPartnerCode',
    'shopIntroductionFirstOrderRatePercent',
    'operationalSupportRepresentativeCode',
    'operationalSupportRatePercent',
  ] as const;

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.DISTRIBUTOR, UserRole.PARTNER, UserRole.CERTIFIED_SHOP)
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @GetUser() currentUser: UserDocument,
  ) {
    if (currentUser.role === UserRole.ADMIN) {
      return this.usersService.update(id, updateUserDto, currentUser);
    }

    // Non-Admin: another user's shop only (network permission checks run in
    // UsersService.update), and only the shop-action fields.
    const target = Types.ObjectId.isValid(id)
      ? await this.usersService.findOne(id)
      : null;
    if (
      !target ||
      target.role !== UserRole.CERTIFIED_SHOP ||
      target._id.toString() === currentUser._id.toString()
    ) {
      throw new ForbiddenException('You do not have permission to update this user');
    }
    const payload: Record<string, unknown> = {};
    for (const field of UsersController.NETWORK_SHOP_UPDATE_FIELDS) {
      if (updateUserDto[field] !== undefined) payload[field] = updateUserDto[field];
    }
    if (
      payload.status !== undefined &&
      payload.status !== UserStatus.ACTIVE &&
      payload.status !== UserStatus.BLOCKED
    ) {
      throw new BadRequestException('Status must be active or blocked.');
    }
    if (Object.keys(payload).length === 0) {
      throw new BadRequestException('Nothing to update.');
    }
    return this.usersService.update(id, payload as UpdateUserDto, currentUser);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Post(':id/restore')
  @Roles(UserRole.ADMIN)
  restore(@Param('id') id: string) {
    return this.usersService.restore(id);
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

    const { completedCount, totalRequired } =
      countCompletedRequiredCourses(user);

    if (!isTrainingRequirementSatisfied(user)) {
      throw new BadRequestException(
        `You must complete all ${totalRequired} courses before uploading a certification video. (${completedCount}/${totalRequired})`,
      );
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
    const { completedCount, totalRequired } =
      countCompletedRequiredCourses(user);

    if (!isTrainingRequirementSatisfied(user)) {
      throw new BadRequestException(
        `You must complete all ${totalRequired} training courses before finalizing certification. (${completedCount}/${totalRequired})`,
      );
    }
    const updatedUser = await this.usersService.update(user._id.toString(), {
      isTrainingComplete: true,
    } as any, user);

    // Open a private 1-to-1 room with the shop's assigned chat partner when available
    let roomId: any = null;
    try {
      const room = await this.chatService.openDirectRoom(user);
      roomId = (room as any)?._id ?? null;
    } catch {
      roomId = null;
    }

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
          link: `/dashboard/partner/shops/${user._id}`,
        });
      }
    }

    // Send Training Complete Email Notification to user and certified@skygloss.com
    this.mailService.sendTrainingCompleteNotification(user).catch(err => {
      console.error('Failed to send training complete email:', err);
    });

    return {
      message: 'Training completion submitted successfully.',
      roomId,
    };
  }

}

