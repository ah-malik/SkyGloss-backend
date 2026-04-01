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
import { UserRole, UserDocument } from './entities/user.entity';
import { GetUser } from '../common/decorators/get-user.decorator';
import { Request } from 'express';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly chatService: ChatService,
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
  )
  findAll() {
    return this.usersService.findAll();
  }

  @Get('referred-shops')
  @Roles(UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER)
  async getReferredShops(@GetUser() user: UserDocument) {
    return this.usersService.findReferredShops(user.partnerCode || '');
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
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
      UNDERSTANDING_SKYGLOSS: 9,
      FUSION: 13,
      RESIN_FILM: 4,
      SHINE: 3,
      MATTE: 3,
      SEAL: 3,
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

    if (completedCount < 6) {
      throw new BadRequestException('You must complete all 6 courses before uploading a certification video.');
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

    const updatedUser = await this.usersService.update(user._id.toString(), {
      isTrainingComplete: true,
    } as any);

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

    // Try finding Partner to notify them separately, if a logic layer exists
    if (user.referredByPartnerCode) {
         // Optionally send targeted websocket event logic here if expanded
    }

    return { message: 'Training completion submitted successfully.', roomId: (existingRoom as any)._id };
  }
}
