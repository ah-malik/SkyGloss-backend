import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ACTIVE_WITHDRAWAL_STATUSES,
  WithdrawalRequest,
  WithdrawalRequestDocument,
  WithdrawalStatus,
} from '../entities/withdrawal-request.entity';
import { CreateWithdrawalDto } from '../dto/create-withdrawal.dto';
import { CommissionsService } from './commissions.service';
import { BankDetailsService } from './bank-details.service';
import { WalletsService } from './wallets.service';
import { ApprovalAction, AuditService } from './audit.service';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/entities/user.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationsGateway } from '../../notifications/notifications.gateway';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { CommissionRecord, CommissionRecordDocument } from '../entities/commission-record.entity';
import { WITHDRAWAL_ELIGIBLE_ROLES } from '../payout-roles';

@Injectable()
export class WithdrawalsService {
  constructor(
    @InjectModel(WithdrawalRequest.name)
    private withdrawalModel: Model<WithdrawalRequestDocument>,
    @InjectModel(CommissionRecord.name)
    private commissionModel: Model<CommissionRecordDocument>,
    private commissionsService: CommissionsService,
    private bankDetailsService: BankDetailsService,
    private walletsService: WalletsService,
    private auditService: AuditService,
    private usersService: UsersService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
  ) {}

  private async pushNotification(data: {
    type: NotificationType;
    title: string;
    message: string;
    user: string;
    triggeredBy?: string;
    link?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const saved = await this.notificationsService.create(data);
      this.notificationsGateway.broadcastNotification(saved);
    } catch (err) {
      console.error('[WithdrawalsService] Notification failed', err);
    }
  }

  async generateRequestNumber(): Promise<string> {
    const date = new Date();
    const prefix = `WR-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const count = await this.withdrawalModel.countDocuments({
      requestNumber: new RegExp(`^${prefix}`),
    });
    return `${prefix}-${String(count + 1).padStart(4, '0')}`;
  }

  async getAvailableBalance(userId: string): Promise<number> {
    const summary = await this.commissionsService.getSummary(userId);
    return summary.available;
  }

  async submitWithdrawal(userId: string, dto: CreateWithdrawalDto) {
    const user = await this.usersService.findOne(userId);
    if (!user) throw new NotFoundException('User not found');

    if (!(WITHDRAWAL_ELIGIBLE_ROLES as readonly UserRole[]).includes(user.role)) {
      throw new ForbiddenException('Hub accounts cannot request withdrawals. Manage network payout reviews instead.');
    }

    const active = await this.withdrawalModel.findOne({
      userId: new Types.ObjectId(userId),
      status: { $in: ACTIVE_WITHDRAWAL_STATUSES },
    });
    if (active) {
      throw new BadRequestException(
        'You already have an active withdrawal request. Please wait for it to complete.',
      );
    }

    const available = await this.getAvailableBalance(userId);
    const amount = Math.round(dto.amount * 100) / 100;
    if (amount <= 0 || amount > available) {
      throw new BadRequestException(
        `Invalid amount. Available balance: $${available.toFixed(2)}`,
      );
    }

    const bank = await this.bankDetailsService.getVerifiedPrimaryOrThrow(userId);
    const initialStatus = bank
      ? WithdrawalStatus.WAITING_HUB_APPROVAL
      : WithdrawalStatus.WAITING_BANK_DETAILS;

    let recordIds: Types.ObjectId[] = [];
    let lockedTotal = 0;

    try {
      const locked = await this.commissionsService.lockCommissionsForWithdrawal(
        userId,
        amount,
      );
      recordIds = locked.recordIds;
      lockedTotal = locked.total;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Insufficient available commission balance';
      throw new BadRequestException(message);
    }

    const request = await this.withdrawalModel.create({
      requestNumber: await this.generateRequestNumber(),
      userId: new Types.ObjectId(userId),
      userPartnerCode: user.partnerCode || '',
      userRole: user.role,
      requestedAmount: lockedTotal,
      currency: 'USD',
      status: initialStatus,
      commissionRecordIds: recordIds,
      bankDetailsId: bank?._id,
    });

    await this.commissionModel.updateMany(
      { _id: { $in: recordIds } },
      { withdrawalRequestId: request._id },
    );

    await this.auditService.logApproval({
      withdrawalRequestId: request._id as Types.ObjectId,
      action: ApprovalAction.WITHDRAWAL_SUBMIT,
      actorUserId: new Types.ObjectId(userId),
      actorRole: user.role,
      newStatus: initialStatus,
      metadata: { amount: lockedTotal, recordIds },
    });

    await this.auditService.logTransaction({
      userId: new Types.ObjectId(userId),
      category: 'withdrawal',
      title: `Withdrawal request ${request.requestNumber}`,
      amount: lockedTotal,
      direction: 'debit',
      referenceId: request.requestNumber,
      sourceDocumentId: request._id as Types.ObjectId,
      sourceCollection: 'WithdrawalRequest',
      snapshot: { status: initialStatus },
    });

    await this.notifyHubForReview(user, request);

    return this.enrichWithdrawal(request);
  }

  private async notifyHubForReview(
    user: { _id: Types.ObjectId; role: UserRole; firstName?: string; lastName?: string },
    request: WithdrawalRequestDocument,
  ) {
    const hubUsers = await this.findHubReviewersForUser(user._id.toString());
    for (const hub of hubUsers) {
      await this.pushNotification({
        type: NotificationType.WITHDRAWAL_SUBMITTED,
        title: 'Withdrawal Review Required',
        message: `${user.firstName || ''} ${user.lastName || ''} submitted a withdrawal of $${request.requestedAmount.toFixed(2)}.`,
        user: hub._id.toString(),
        triggeredBy: user._id.toString(),
        link: '/dashboard/partner/network?tab=earnings',
        metadata: { withdrawalRequestId: request._id },
      });
    }
  }

  private async findHubReviewersForUser(userId: string) {
    const user = await this.usersService.findOne(userId);
    if (!user) return [];

    if (user.role === UserRole.PARTNER) {
      // Hub's own withdrawals go to admin directly — no hub reviewer
      return [];
    }

    let current = user;
    const visited = new Set<string>();
    while (current?.referredByPartnerCode) {
      const code = current.referredByPartnerCode.trim().toUpperCase();
      if (visited.has(code)) break;
      visited.add(code);
      const parent = await this.usersService.findByPartnerCode(code);
      if (!parent) break;
      if (parent.role === UserRole.PARTNER) {
        return [parent];
      }
      current = parent;
    }
    return [];
  }

  async listMyWithdrawals(userId: string) {
    const items = await this.withdrawalModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();
    return items.map((w) => this.formatWithdrawal(w));
  }

  async getWithdrawalDetail(id: string, viewerId: string, viewerRole: UserRole) {
    const request = await this.withdrawalModel.findById(id).lean();
    if (!request) throw new NotFoundException('Withdrawal not found');

    const isOwner = request.userId.toString() === viewerId;
    const isAdmin = viewerRole === UserRole.ADMIN;
    const isHub =
      viewerRole === UserRole.PARTNER &&
      (await this.usersService.isUserInViewerNetwork(
        { _id: viewerId, role: viewerRole } as any,
        request.userId.toString(),
      ));

    if (!isOwner && !isAdmin && !isHub) {
      throw new ForbiddenException();
    }

    const history = await this.auditService.getWithdrawalHistory(id);
    const commissions = await this.commissionModel
      .find({ _id: { $in: request.commissionRecordIds } })
      .lean();

    return {
      ...this.formatWithdrawal(request),
      commissions,
      history,
    };
  }

  async listHubPending(hubUserId: string) {
    const hub = await this.usersService.findOne(hubUserId);
    if (!hub || hub.role !== UserRole.PARTNER) {
      throw new ForbiddenException('Hub access only');
    }

    const network = await this.usersService.findNetworkUsersForViewer(hub);
    const networkIds = [
      ...network.representatives,
      ...network.promoters,
      ...network.represented,
      ...network.distributors,
    ].map((u) => u._id);

    const items = await this.withdrawalModel
      .find({
        userId: { $in: networkIds },
        status: WithdrawalStatus.WAITING_HUB_APPROVAL,
      })
      .sort({ createdAt: 1 })
      .populate('userId', 'firstName lastName email partnerCode role')
      .lean();

    return items.map((w) => this.formatWithdrawal(w));
  }

  async listAdminPending() {
    const items = await this.withdrawalModel
      .find({ status: WithdrawalStatus.SENT_TO_ADMIN })
      .sort({ createdAt: 1 })
      .populate('userId', 'firstName lastName email partnerCode role')
      .lean();
    return items.map((w) => this.formatWithdrawal(w));
  }

  async hubReview(
    withdrawalId: string,
    hubUserId: string,
    action: 'approve' | 'reject',
    note?: string,
  ) {
    const request = await this.withdrawalModel.findById(withdrawalId);
    if (!request) throw new NotFoundException('Withdrawal not found');

    if (request.status !== WithdrawalStatus.WAITING_HUB_APPROVAL) {
      throw new BadRequestException('Withdrawal is not awaiting hub approval');
    }

    const hub = await this.usersService.findOne(hubUserId);
    if (!hub || hub.role !== UserRole.PARTNER) {
      throw new ForbiddenException();
    }

    const inNetwork = await this.usersService.isUserInViewerNetwork(
      hub as any,
      request.userId.toString(),
    );
    if (!inNetwork && request.userId.toString() !== hubUserId) {
      throw new ForbiddenException('User is not in your network');
    }

    if (action === 'reject') {
      request.status = WithdrawalStatus.REJECTED_BY_HUB;
      request.hubReviewerId = new Types.ObjectId(hubUserId);
      request.hubReviewedAt = new Date();
      request.hubReviewNote = note;
      await request.save();

      await this.commissionsService.unlockCommissions(request.commissionRecordIds);
      await this.auditService.logApproval({
        withdrawalRequestId: request._id as Types.ObjectId,
        action: ApprovalAction.HUB_REJECT,
        actorUserId: new Types.ObjectId(hubUserId),
        actorRole: hub.role,
        previousStatus: WithdrawalStatus.WAITING_HUB_APPROVAL,
        newStatus: WithdrawalStatus.REJECTED_BY_HUB,
        note,
      });

      await this.pushNotification({
        type: NotificationType.WITHDRAWAL_HUB_REJECTED,
        title: 'Withdrawal Rejected',
        message: `Your withdrawal ${request.requestNumber} was rejected by your Hub.${note ? ` Note: ${note}` : ''}`,
        user: request.userId.toString(),
        triggeredBy: hubUserId,
        link: '/dashboard/partner/network?tab=earnings',
      });

      return this.enrichWithdrawal(request);
    }

    // Approve
    request.status = WithdrawalStatus.HUB_APPROVED;
    request.hubReviewerId = new Types.ObjectId(hubUserId);
    request.hubReviewedAt = new Date();
    request.hubReviewNote = note;
    request.walletCreditedAt = new Date();
    await request.save();

    await this.walletsService.creditFromHubApproval(
      request.userId.toString(),
      request.requestedAmount,
      request._id.toString(),
      hubUserId,
    );

    request.status = WithdrawalStatus.SENT_TO_ADMIN;
    await request.save();

    await this.auditService.logApproval({
      withdrawalRequestId: request._id as Types.ObjectId,
      action: ApprovalAction.HUB_APPROVE,
      actorUserId: new Types.ObjectId(hubUserId),
      actorRole: hub.role,
      previousStatus: WithdrawalStatus.WAITING_HUB_APPROVAL,
      newStatus: WithdrawalStatus.SENT_TO_ADMIN,
      note,
    });

    await this.pushNotification({
      type: NotificationType.WITHDRAWAL_HUB_APPROVED,
      title: 'Withdrawal Approved by Hub',
      message: `Your withdrawal ${request.requestNumber} was approved and sent to Admin for payout.`,
      user: request.userId.toString(),
      triggeredBy: hubUserId,
      link: '/dashboard/partner/network?tab=earnings',
    });

    return this.enrichWithdrawal(request);
  }

  async adminReview(
    withdrawalId: string,
    adminUserId: string,
    action: 'approve' | 'reject',
    note?: string,
  ) {
    const request = await this.withdrawalModel.findById(withdrawalId);
    if (!request) throw new NotFoundException('Withdrawal not found');

    if (request.status !== WithdrawalStatus.SENT_TO_ADMIN) {
      throw new BadRequestException('Withdrawal is not awaiting admin approval');
    }

    if (action === 'reject') {
      request.status = WithdrawalStatus.REJECTED_BY_ADMIN;
      request.adminReviewerId = new Types.ObjectId(adminUserId);
      request.adminReviewedAt = new Date();
      request.adminReviewNote = note;
      await request.save();

      await this.walletsService.reverseHubCredit(
        request.userId.toString(),
        request.requestedAmount,
        request._id.toString(),
        adminUserId,
      );
      await this.commissionsService.unlockCommissions(request.commissionRecordIds);

      await this.auditService.logApproval({
        withdrawalRequestId: request._id as Types.ObjectId,
        action: ApprovalAction.ADMIN_REJECT,
        actorUserId: new Types.ObjectId(adminUserId),
        actorRole: UserRole.ADMIN,
        newStatus: WithdrawalStatus.REJECTED_BY_ADMIN,
        note,
      });

      await this.pushNotification({
        type: NotificationType.WITHDRAWAL_ADMIN_REJECTED,
        title: 'Withdrawal Rejected',
        message: `Your withdrawal ${request.requestNumber} was rejected by Admin.${note ? ` Note: ${note}` : ''}`,
        user: request.userId.toString(),
        triggeredBy: adminUserId,
      });

      return this.enrichWithdrawal(request);
    }

    // Approve → simulate Wise transfer (integrate Wise API when configured)
    request.status = WithdrawalStatus.ADMIN_APPROVED;
    request.adminReviewerId = new Types.ObjectId(adminUserId);
    request.adminReviewedAt = new Date();
    request.adminReviewNote = note;
    await request.save();

    request.status = WithdrawalStatus.PAYMENT_PROCESSING;
    request.wiseTransferReference = `WISE-${Date.now()}`;
    await request.save();

    await this.walletsService.debitFromAdminPayout(
      request.userId.toString(),
      request.requestedAmount,
      request._id.toString(),
      adminUserId,
    );

    await this.commissionsService.markWithdrawn(
      request.commissionRecordIds,
      request._id.toString(),
    );

    request.status = WithdrawalStatus.COMPLETED;
    request.walletDebitedAt = new Date();
    request.completedAt = new Date();
    await request.save();

    await this.auditService.logApproval({
      withdrawalRequestId: request._id as Types.ObjectId,
      action: ApprovalAction.ADMIN_APPROVE,
      actorUserId: new Types.ObjectId(adminUserId),
      actorRole: UserRole.ADMIN,
      newStatus: WithdrawalStatus.COMPLETED,
      note,
    });

    await this.auditService.logApproval({
      withdrawalRequestId: request._id as Types.ObjectId,
      action: ApprovalAction.PAYMENT_COMPLETED,
      actorUserId: new Types.ObjectId(adminUserId),
      metadata: { wiseReference: request.wiseTransferReference },
    });

    await this.auditService.logTransaction({
      userId: request.userId,
      category: 'payout',
      title: `Payout completed — ${request.requestNumber}`,
      amount: request.requestedAmount,
      direction: 'debit',
      referenceId: request.requestNumber,
      sourceDocumentId: request._id as Types.ObjectId,
      sourceCollection: 'WithdrawalRequest',
    });

    await this.pushNotification({
      type: NotificationType.WITHDRAWAL_COMPLETED,
      title: 'Payout Completed',
      message: `$${request.requestedAmount.toFixed(2)} has been transferred to your bank account.`,
      user: request.userId.toString(),
      triggeredBy: adminUserId,
      link: '/dashboard/partner/network?tab=earnings',
    });

    return this.enrichWithdrawal(request);
  }

  async attachBankAndResume(withdrawalId: string, userId: string) {
    const request = await this.withdrawalModel.findById(withdrawalId);
    if (!request || request.userId.toString() !== userId) {
      throw new NotFoundException();
    }
    if (request.status !== WithdrawalStatus.WAITING_BANK_DETAILS) {
      throw new BadRequestException('Withdrawal does not need bank details');
    }

    const bank = await this.bankDetailsService.getVerifiedPrimaryOrThrow(userId);
    if (!bank) {
      throw new BadRequestException('Please add verified bank details first');
    }

    request.bankDetailsId = bank._id as Types.ObjectId;
    request.status = WithdrawalStatus.WAITING_HUB_APPROVAL;
    await request.save();

    const user = await this.usersService.findOne(userId);
    if (user) await this.notifyHubForReview(user as any, request);

    return this.enrichWithdrawal(request);
  }

  private formatWithdrawal(w: Record<string, any>) {
    return {
      ...w,
      id: w._id?.toString?.() || w.id,
      statusLabel: this.statusLabel(w.status),
    };
  }

  private statusLabel(status: WithdrawalStatus): string {
    const labels: Record<string, string> = {
      waiting_bank_details: 'Waiting for Bank Details',
      waiting_hub_approval: 'Waiting for Hub Approval',
      rejected_by_hub: 'Rejected by Hub',
      hub_approved: 'Hub Approved',
      sent_to_admin: 'Sent to Admin',
      admin_approved: 'Admin Approved',
      rejected_by_admin: 'Rejected by Admin',
      payment_processing: 'Payment Processing',
      completed: 'Completed',
      failed: 'Failed',
    };
    return labels[status] || status;
  }

  private enrichWithdrawal(doc: WithdrawalRequestDocument) {
    const obj = doc.toObject ? doc.toObject() : doc;
    return this.formatWithdrawal(obj);
  }
}
