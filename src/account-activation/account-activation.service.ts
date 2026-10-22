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
import { isTrainingRequirementSatisfied } from '../common/course-completion';
import { PartnerAgreementFilesService } from '../users/partner-agreement-files.service';

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
    private readonly partnerAgreementFiles: PartnerAgreementFilesService,
  ) {}

  async onModuleInit() {
    // Submitting a request sets isTrainingComplete, so partners that already
    // used the activation flow must not be grandfathered — Hub/Admin decides.
    let usersWithRequest: Types.ObjectId[] = [];
    try {
      usersWithRequest = await this.activationModel.distinct('userId');

      // Repair accounts the old backfill activated while their request was
      // still waiting for the Hub (Hub/Admin approval always moves the
      // request out of WAITING_HUB_APPROVAL, so this state is only the bug).
      const waitingUserIds = await this.activationModel.distinct('userId', {
        status: AccountActivationStatus.WAITING_HUB_APPROVAL,
      });
      if (waitingUserIds.length > 0) {
        const repaired = await this.userModel.updateMany(
          { _id: { $in: waitingUserIds }, isAccountActivated: true },
          { $set: { isAccountActivated: false } },
        );
        if (repaired.modifiedCount > 0) {
          console.log(
            `[AccountActivation] Reset ${repaired.modifiedCount} account(s) activated while their request was waiting for Hub approval.`,
          );
        }
      }
    } catch (err) {
      console.error('[AccountActivation] Pending-request repair failed', err);
      // Without the request list we cannot tell who is safe to grandfather.
      return;
    }

    // Grandfather existing Rep/Promoter who already finished training so
    // withdrawals and live state stay intact after this feature ships.
    try {
      const result = await this.userModel.updateMany(
        {
          _id: { $nin: usersWithRequest },
          role: {
            $in: [
              UserRole.MASTER_PARTNER,
              UserRole.REGIONAL_PARTNER,
              UserRole.DISTRIBUTOR,
            ],
          },
          isTrainingComplete: true,
          accountDeactivatedAt: { $exists: false },
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

    try {
      await this.backfillAccountActivatedAt();
    } catch (err) {
      console.error('[AccountActivation] accountActivatedAt backfill failed', err);
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
    return isTrainingRequirementSatisfied(user);
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

  private roleLabel(role?: string | null): string {
    return role === UserRole.MASTER_PARTNER
      ? 'Representative'
      : role === UserRole.REGIONAL_PARTNER
        ? 'Promoter'
        : 'Distributor';
  }

  private async markUserActivated(userId: Types.ObjectId | string) {
    await this.userModel.findByIdAndUpdate(userId, {
      $set: {
        isAccountActivated: true,
        isTrainingComplete: true,
        status: UserStatus.ACTIVE,
        // Certificate date (Assets → Your certificate).
        accountActivatedAt: new Date(),
      },
      $unset: { accountDeactivatedAt: 1 },
    });
  }

  /**
   * Partners activated before `accountActivatedAt` existed: take the date from
   * their approved request (Hub/Admin review), else from the user record.
   */
  private async backfillAccountActivatedAt() {
    const users = await this.userModel
      .find({
        isAccountActivated: true,
        accountActivatedAt: { $exists: false },
      })
      .select('_id updatedAt createdAt')
      .lean();
    if (users.length === 0) return;

    let filled = 0;
    for (const user of users) {
      const request = await this.activationModel
        .findOne({
          userId: user._id,
          status: {
            $in: [
              AccountActivationStatus.APPROVED_BY_HUB,
              AccountActivationStatus.APPROVED_BY_ADMIN,
            ],
          },
        })
        .sort({ createdAt: -1 })
        .select('hubReviewedAt adminReviewedAt updatedAt')
        .lean();
      const activatedAt =
        request?.hubReviewedAt ||
        request?.adminReviewedAt ||
        (request as any)?.updatedAt ||
        (user as any).updatedAt ||
        (user as any).createdAt ||
        new Date();
      await this.userModel.updateOne(
        { _id: user._id, accountActivatedAt: { $exists: false } },
        { $set: { accountActivatedAt: activatedAt } },
      );
      filled += 1;
    }
    if (filled > 0) {
      console.log(
        `[AccountActivation] Backfilled accountActivatedAt for ${filled} activated partner account(s).`,
      );
    }
  }

  /** Admin notifications must never block the partner's submission. */
  private async notifyAllAdmins(data: {
    type: NotificationType;
    title: string;
    message: string;
    triggeredBy?: string;
    link?: string;
  }) {
    try {
      const admins = await this.usersService.findAdminUsers();
      for (const admin of admins) {
        await this.notificationsService.create({
          ...data,
          user: admin._id.toString(),
        });
      }
    } catch (err) {
      console.error('[AccountActivation] Admin notification failed', err);
    }
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
      // Uploaded by Admin on create: replaces the agreement step.
      adminAgreement: user.adminAgreementKey
        ? {
            // Private B2 file: short-lived signed link (null if B2 is down).
            url: await this.partnerAgreementFiles.signedUrl(
              user.adminAgreementKey,
            ),
            fileName: user.adminAgreementFileName || null,
            uploadedAt: user.adminAgreementUploadedAt || null,
          }
        : null,
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
      ...(user.adminAgreementKey
        ? {
            adminAgreementKey: user.adminAgreementKey,
            adminAgreementFileName: user.adminAgreementFileName,
          }
        : dto.agreementDetails
          ? { agreementDetails: dto.agreementDetails }
          : {}),
      ...(bankDetailsId ? { bankDetailsId } : {}),
      submittedAt: now,
    });

    const requesterName =
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      user.email ||
      'A partner';
    const roleLabel = this.roleLabel(user.role);

    await this.notificationsService.create({
      type: NotificationType.ACCOUNT_ACTIVATION_SUBMITTED,
      title: 'Account Activation Request',
      message: `${requesterName} (${roleLabel}) submitted an Account Activation request.`,
      user: hub._id.toString(),
      triggeredBy: userId,
      link: '/dashboard/partner#activations',
    });

    await this.notifyAllAdmins({
      type: NotificationType.ACCOUNT_ACTIVATION_SUBMITTED,
      title: 'Account Activation Request',
      message: `${requesterName} (${roleLabel}) submitted an Account Activation request (Hub: ${hubName}).`,
      triggeredBy: userId,
      link: '/account-activations',
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

    await this.markUserActivated(request.userId);

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

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  private static readonly ADMIN_USER_FIELDS =
    'firstName lastName email phone partnerCode role city country companyName isAccountActivated';

  async adminList(status?: string) {
    const filter: Record<string, unknown> = {};
    if (
      status &&
      (Object.values(AccountActivationStatus) as string[]).includes(status)
    ) {
      filter.status = status;
    }

    const items = await this.activationModel
      .find(filter)
      .sort({ submittedAt: -1, createdAt: -1 })
      .populate('userId', AccountActivationService.ADMIN_USER_FIELDS)
      .lean();

    return items.map((item) => this.formatRequest(item));
  }

  async adminGetOne(requestId: string) {
    if (!Types.ObjectId.isValid(requestId)) {
      throw new NotFoundException('Activation request not found');
    }
    const request = await this.activationModel
      .findById(requestId)
      .populate('userId', AccountActivationService.ADMIN_USER_FIELDS)
      .populate('hubReviewerId', 'firstName lastName email partnerCode')
      .populate('adminReviewerId', 'firstName lastName email')
      .lean();
    if (!request) throw new NotFoundException('Activation request not found');
    return {
      ...this.formatRequest(request),
      ...(request.adminAgreementKey
        ? {
            adminAgreementUrl: await this.partnerAgreementFiles.signedUrl(
              request.adminAgreementKey,
            ),
          }
        : {}),
    };
  }

  /** Admin approves a pending request; the Hub no longer needs to act on it. */
  async adminApprove(requestId: string, adminUserId: string, note?: string) {
    if (!Types.ObjectId.isValid(requestId)) {
      throw new NotFoundException('Activation request not found');
    }

    // Atomic status transition so a simultaneous Hub review cannot double-apply.
    const request = await this.activationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(requestId),
        status: AccountActivationStatus.WAITING_HUB_APPROVAL,
      },
      {
        $set: {
          status: AccountActivationStatus.APPROVED_BY_ADMIN,
          adminReviewerId: new Types.ObjectId(adminUserId),
          adminReviewedAt: new Date(),
          adminReviewNote: note,
        },
      },
      { new: true },
    );
    if (!request) {
      const exists = await this.activationModel.exists({
        _id: new Types.ObjectId(requestId),
      });
      if (!exists) throw new NotFoundException('Activation request not found');
      throw new BadRequestException(
        'This activation request is no longer pending.',
      );
    }

    await this.markUserActivated(request.userId);
    await this.notifyAdminActivation(
      request.userId.toString(),
      adminUserId,
      request.assignedHubId?.toString(),
    );

    return this.adminGetOne(requestId);
  }

  /**
   * Admin activates a partner directly from the admin panel. A pending request
   * is approved if one exists; otherwise no request is required.
   */
  async adminActivateUser(userId: string, adminUserId: string, note?: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const user = await this.usersService.findOne(userId);
    if (!user) throw new NotFoundException('User not found');
    this.assertEligible(user);

    if (user.isAccountActivated) {
      throw new BadRequestException('This account is already activated.');
    }

    const pending = await this.activationModel.findOne({
      userId: new Types.ObjectId(userId),
      status: AccountActivationStatus.WAITING_HUB_APPROVAL,
    });
    if (pending) {
      const request = await this.adminApprove(
        pending._id.toString(),
        adminUserId,
        note,
      );
      return { userId, isAccountActivated: true, request };
    }

    await this.markUserActivated(userId);
    await this.notifyAdminActivation(userId, adminUserId);

    return { userId, isAccountActivated: true, request: null };
  }

  /**
   * Admin deactivates a partner's account from the admin panel. Withdrawals are
   * gated again until the account is re-activated by Admin or a new Hub approval.
   */
  async adminDeactivateUser(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const user = await this.usersService.findOne(userId);
    if (!user) throw new NotFoundException('User not found');
    this.assertEligible(user);

    if (!user.isAccountActivated) {
      throw new BadRequestException('This account is not activated.');
    }

    await this.userModel.findByIdAndUpdate(userId, {
      $set: { isAccountActivated: false, accountDeactivatedAt: new Date() },
    });

    return { userId, isAccountActivated: false };
  }

  private async notifyAdminActivation(
    partnerUserId: string,
    adminUserId: string,
    hubUserId?: string,
  ) {
    await this.notificationsService.create({
      type: NotificationType.ACCOUNT_ACTIVATION_APPROVED,
      title: 'Account Activated',
      message:
        'Your Account Activation was approved by SkyGloss Admin. You can now withdraw earnings.',
      user: partnerUserId,
      triggeredBy: adminUserId,
      link: '/dashboard/partner/earnings',
    });

    if (!hubUserId) return;
    const partner = await this.usersService.findOne(partnerUserId);
    const partnerName =
      [partner?.firstName, partner?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      partner?.email ||
      'A partner';
    await this.notificationsService.create({
      type: NotificationType.ACCOUNT_ACTIVATION_APPROVED,
      title: 'Account Activation Approved by Admin',
      message: `${partnerName} (${this.roleLabel(partner?.role)}) was activated by SkyGloss Admin. No Hub action is needed.`,
      user: hubUserId,
      triggeredBy: adminUserId,
      link: '/dashboard/partner#activations',
    });
  }
}
