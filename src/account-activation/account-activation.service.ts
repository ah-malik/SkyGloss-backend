import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AccountActivationRequest,
  AccountActivationRequestDocument,
  AccountActivationStatus,
} from './entities/account-activation-request.entity';
import { SubmitAccountActivationDto } from './dto/submit-account-activation.dto';
import {
  isAccountActivationEligibleRole,
  requiresActivationBankDetails,
} from './account-activation.roles';
import {
  User,
  UserDocument,
  UserRole,
  UserStatus,
} from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { BankDetailsService } from '../payouts/services/bank-details.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { getRequiredCourseKeysForRole } from '../common/course-catalog';
import { COURSE_STEPS } from '../common/course-catalog';

@Injectable()
export class AccountActivationService implements OnModuleInit {
  constructor(
    @InjectModel(AccountActivationRequest.name)
    private readonly activationModel: Model<AccountActivationRequestDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly usersService: UsersService,
    private readonly bankDetailsService: BankDetailsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    // Grandfather existing Rep/Promoter who already finished training so
    // withdrawals and live state stay intact after this feature ships.
    try {
      const result = await this.userModel.updateMany(
        {
          role: {
            $in: [
              UserRole.MASTER_PARTNER,
              UserRole.REGIONAL_PARTNER,
              UserRole.DISTRIBUTOR,
            ],
          },
          isTrainingComplete: true,
          $or: [
            { isAccountActivated: { $exists: false } },
            { isAccountActivated: false },
          ],
        },
        { $set: { isAccountActivated: true } },
      );
      if (result.modifiedCount > 0) {
        console.log(
          `[AccountActivation] Grandfathered ${result.modifiedCount} existing activated partner accounts.`,
        );
      }
    } catch (err) {
      console.error('[AccountActivation] Grandfather backfill failed', err);
    }
  }

  private assertEligible(user: UserDocument) {
    if (!isAccountActivationEligibleRole(user.role)) {
      throw new ForbiddenException(
        'Account Activation is only available for Representatives, Promoters, and Distributors.',
      );
    }
  }

  private coursesComplete(user: UserDocument): boolean {
    const required = getRequiredCourseKeysForRole(user.role);
    if (!required.length) return true;
    const progress = user.courseProgress || new Map();
    let completed = 0;
    for (const key of required) {
      const requiredSteps = COURSE_STEPS[key] || 0;
      const steps =
        (progress instanceof Map
          ? progress.get(key)
          : (progress as any)?.[key]) || [];
      const count = Array.isArray(steps) ? steps.length : 0;
      if (requiredSteps > 0 && count >= requiredSteps) completed += 1;
      else if (
        Array.isArray(user.completedCourses) &&
        user.completedCourses.includes(key)
      ) {
        completed += 1;
      }
    }
    return completed >= required.length;
  }

  private formatRequest(doc: any) {
    const obj =
      typeof doc?.toObject === 'function' ? doc.toObject() : { ...doc };
    return {
      ...obj,
      id: obj._id?.toString?.() || obj._id,
      userId: obj.userId?._id
        ? {
            ...obj.userId,
            _id: obj.userId._id.toString(),
            id: obj.userId._id.toString(),
          }
        : obj.userId?.toString?.() || obj.userId,
      assignedHubId: obj.assignedHubId?.toString?.() || obj.assignedHubId,
      bankDetailsId: obj.bankDetailsId?.toString?.() || obj.bankDetailsId,
    };
  }

  async getMyStatus(userId: string) {
    const user = await this.usersService.findOne(userId);
    if (!user) throw new NotFoundException('User not found');
    this.assertEligible(user);

    const request = await this.activationModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();

    const hubs = await this.usersService.findOwningHubPartners(userId);
    const hub = hubs[0] || null;

    return {
      eligible: true,
      isAccountActivated: !!user.isAccountActivated,
      isTrainingComplete: !!user.isTrainingComplete,
      coursesComplete: this.coursesComplete(user),
      requiresBankDetails: requiresActivationBankDetails(user.role),
      canStartActivation:
        this.coursesComplete(user) && !user.isAccountActivated,
      hub: hub
        ? {
            id: hub._id.toString(),
            partnerCode: hub.partnerCode,
            firstName: hub.firstName,
            lastName: hub.lastName,
            city: hub.city,
            companyName: hub.companyName,
            shopName: hub.shopName,
          }
        : null,
      request: request ? this.formatRequest(request) : null,
    };
  }

  async submit(userId: string, dto: SubmitAccountActivationDto) {
    const user = await this.usersService.findOne(userId);
    if (!user) throw new NotFoundException('User not found');
    this.assertEligible(user);

    if (user.isAccountActivated) {
      throw new BadRequestException('Your account is already activated.');
    }

    if (!this.coursesComplete(user) && !user.isTrainingComplete) {
      throw new BadRequestException(
        'Complete all required courses before submitting Account Activation.',
      );
    }

    if (!dto.agreementAccepted) {
      throw new BadRequestException('You must accept the agreement to continue.');
    }

    const needsBank = requiresActivationBankDetails(user.role);
    if (needsBank) {
      if (!dto.accountHolderName?.trim() || !dto.country?.trim()) {
        throw new BadRequestException(
          'Account holder name and country are required.',
        );
      }
      if (
        !dto.iban &&
        !dto.accountNumber &&
        !Object.keys(dto.extraDetails || {}).length
      ) {
        throw new BadRequestException(
          'Account number, IBAN, or required bank fields are needed.',
        );
      }
    }

    const existingPending = await this.activationModel.findOne({
      userId: new Types.ObjectId(userId),
      status: AccountActivationStatus.WAITING_HUB_APPROVAL,
    });
    if (existingPending) {
      throw new BadRequestException(
        'You already have an activation request waiting for Hub approval.',
      );
    }

    const hubs = await this.usersService.findOwningHubPartners(userId);
    const hub = hubs[0];
    if (!hub) {
      throw new BadRequestException(
        'No assigned Hub found. Contact support before activating.',
      );
    }

    let bankDetailsId: Types.ObjectId | undefined;
    if (needsBank) {
      const bank = await this.bankDetailsService.upsertPrimary(userId, {
        accountHolderName: dto.accountHolderName!,
        bankName: dto.bankName,
        iban: dto.iban,
        accountNumber: dto.accountNumber,
        routingNumber: dto.routingNumber,
        sortCode: dto.sortCode,
        swiftBic: dto.swiftBic,
        extraDetails: dto.extraDetails,
        country: dto.country!,
        currency: dto.currency,
      });
      bankDetailsId = bank._id as Types.ObjectId;
    }

    if (!user.isTrainingComplete) {
      await this.usersService.update(
        userId,
        { isTrainingComplete: true } as any,
        user,
      );
    }

    const hubName =
      [hub.firstName, hub.lastName].filter(Boolean).join(' ').trim() ||
      hub.companyName ||
      hub.shopName ||
      hub.city ||
      'Your hub';

    const now = new Date();
    const request = await this.activationModel.create({
      userId: new Types.ObjectId(userId),
      userPartnerCode: user.partnerCode,
      userRole: user.role,
      status: AccountActivationStatus.WAITING_HUB_APPROVAL,
      assignedHubId: hub._id,
      assignedHubPartnerCode: hub.partnerCode,
      assignedHubName: hubName,
      agreementAccepted: true,
      agreementAcceptedAt: now,
      ...(bankDetailsId ? { bankDetailsId } : {}),
      submittedAt: now,
    });

    const requesterName =
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      user.email ||
      'A partner';
    const roleLabel =
      user.role === UserRole.MASTER_PARTNER
        ? 'Representative'
        : user.role === UserRole.REGIONAL_PARTNER
          ? 'Promoter'
          : 'Distributor';

    await this.notificationsService.create({
      type: NotificationType.ACCOUNT_ACTIVATION_SUBMITTED,
      title: 'Account Activation Request',
      message: `${requesterName} (${roleLabel}) submitted an Account Activation request.`,
      user: hub._id.toString(),
      triggeredBy: userId,
      link: '/dashboard/partner#activations',
    });

    return this.formatRequest(request);
  }

  async listHubPending(hubUserId: string) {
    const hub = await this.usersService.findOne(hubUserId);
    if (!hub || hub.role !== UserRole.PARTNER) {
      throw new ForbiddenException('Only Hubs can review activation requests.');
    }

    const items = await this.activationModel
      .find({
        assignedHubId: new Types.ObjectId(hubUserId),
        status: AccountActivationStatus.WAITING_HUB_APPROVAL,
      })
      .sort({ submittedAt: 1, createdAt: 1 })
      .populate(
        'userId',
        'firstName lastName email partnerCode role city country companyName',
      )
      .lean();

    return items.map((item) => this.formatRequest(item));
  }

  async hubReview(
    requestId: string,
    hubUserId: string,
    action: 'approve' | 'reject',
    note?: string,
  ) {
    const hub = await this.usersService.findOne(hubUserId);
    if (!hub || hub.role !== UserRole.PARTNER) {
      throw new ForbiddenException('Only Hubs can review activation requests.');
    }

    const request = await this.activationModel.findById(requestId);
    if (!request) throw new NotFoundException('Activation request not found');

    if (request.status !== AccountActivationStatus.WAITING_HUB_APPROVAL) {
      throw new BadRequestException(
        'This activation request is not awaiting Hub approval.',
      );
    }

    if (request.assignedHubId.toString() !== hubUserId.toString()) {
      throw new ForbiddenException(
        'This activation request is assigned to a different Hub.',
      );
    }

    const now = new Date();
    request.hubReviewerId = new Types.ObjectId(hubUserId);
    request.hubReviewedAt = now;
    request.hubReviewNote = note;

    if (action === 'reject') {
      request.status = AccountActivationStatus.REJECTED_BY_HUB;
      await request.save();

      await this.notificationsService.create({
        type: NotificationType.ACCOUNT_ACTIVATION_REJECTED,
        title: 'Account Activation Rejected',
        message: `Your Account Activation was rejected by your Hub.${note ? ` Note: ${note}` : ''}`,
        user: request.userId.toString(),
        triggeredBy: hubUserId,
        link: '/dashboard/partner/activation',
      });

      return this.formatRequest(request);
    }

    request.status = AccountActivationStatus.APPROVED_BY_HUB;
    await request.save();

    await this.userModel.findByIdAndUpdate(request.userId, {
      $set: {
        isAccountActivated: true,
        isTrainingComplete: true,
        status: UserStatus.ACTIVE,
      },
    });

    await this.notificationsService.create({
      type: NotificationType.ACCOUNT_ACTIVATION_APPROVED,
      title: 'Account Activated',
      message:
        'Your Hub approved your Account Activation. You can now withdraw earnings.',
      user: request.userId.toString(),
      triggeredBy: hubUserId,
      link: '/dashboard/partner/earnings',
    });

    return this.formatRequest(request);
  }
}
