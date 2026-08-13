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
    user?: string;
    triggeredBy?: string;
    link?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!data.user) {
      console.error('[WithdrawalsService] Skipped notification without recipient user:', data.type);
      return;
    }
    try {
      const saved = await this.notificationsService.create(data);
      const payload = saved.toObject ? saved.toObject() : saved;
      this.notificationsGateway.broadcastNotification({
        ...payload,
        user: payload.user?.toString?.() ?? payload.user,
        triggeredBy: payload.triggeredBy?.toString?.() ?? payload.triggeredBy,
      });
    } catch (err) {
      console.error('[WithdrawalsService] Notification failed', err);
    }
  }

  private async notifyAllAdmins(data: {
    type: NotificationType;
    title: string;
    message: string;
    triggeredBy?: string;
    link?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const admins = await this.usersService.findAdminUsers();
    for (const admin of admins) {
      await this.pushNotification({
        ...data,
        user: admin._id.toString(),
      });
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

  async listWithdrawalHubs(userId: string) {
    return this.commissionsService.getAvailableByHub(userId);
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

    const hubBalances = await this.commissionsService.getAvailableByHub(userId);
    const hubsWithBalance = hubBalances.hubs.filter((h) => h.available > 0);
    if (hubsWithBalance.length > 1 && !dto.hubId) {
      throw new BadRequestException(
        'Please select a hub. Withdrawals cannot combine commissions from different hubs.',
      );
    }

    let sourceHub: {
      hubId: string;
      hubPartnerCode: string;
    } | null = null;
    let available = await this.getAvailableBalance(userId);

    if (dto.hubId) {
      const selected = hubBalances.hubs.find((h) => h.hubId === dto.hubId);
      if (!selected) {
        throw new BadRequestException(
          'Selected hub is not available for withdrawal.',
        );
      }
      sourceHub = {
        hubId: selected.hubId,
        hubPartnerCode: selected.hubPartnerCode,
      };
      available = selected.available;
    }

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
        sourceHub?.hubPartnerCode,
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
      ...(sourceHub
        ? {
            sourceHubId: new Types.ObjectId(sourceHub.hubId),
            sourceHubPartnerCode: sourceHub.hubPartnerCode,
          }
        : {}),
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

    await this.notifyStakeholdersOnSubmit(user, request);

    return this.enrichWithdrawal(request);
  }

  private requesterLabel(user: {
    firstName?: string;
    lastName?: string;
    partnerCode?: string;
  }): string {
    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    return name || user.partnerCode || 'Network member';
  }

  private async notifyStakeholdersOnSubmit(
    user: {
      _id: Types.ObjectId;
      role: UserRole;
      firstName?: string;
      lastName?: string;
      partnerCode?: string;
    },
    request: WithdrawalRequestDocument,
  ) {
    const label = this.requesterLabel(user);
    const amount = request.requestedAmount.toFixed(2);
    const statusNote =
      request.status === WithdrawalStatus.WAITING_BANK_DETAILS
        ? ' (awaiting bank details from requester)'
        : '';

    const hubUsers = await this.resolveReviewHubs(
      user._id.toString(),
      request.sourceHubId?.toString(),
    );
    for (const hub of hubUsers) {
      await this.pushNotification({
        type: NotificationType.WITHDRAWAL_SUBMITTED,
        title: 'Withdrawal Review Required',
        message: `${label} submitted a withdrawal of $${amount}.${statusNote}`,
        user: hub._id.toString(),
        triggeredBy: user._id.toString(),
        link: '/dashboard/partner/network?tab=earnings',
        metadata: {
          withdrawalRequestId: request._id,
          requestNumber: request.requestNumber,
        },
      });
    }

    await this.notifyAllAdmins({
      type: NotificationType.WITHDRAWAL_SUBMITTED,
      title: 'New Withdrawal Request',
      message: `${label} submitted withdrawal ${request.requestNumber} for $${amount}.${statusNote}`,
      triggeredBy: user._id.toString(),
      link: '/withdrawals',
      metadata: {
        withdrawalRequestId: request._id,
        requestNumber: request.requestNumber,
        status: request.status,
      },
    });
  }

  private async notifyAdminsPendingPayout(
    user: {
      firstName?: string;
      lastName?: string;
      partnerCode?: string;
    },
    request: WithdrawalRequestDocument,
  ) {
    const label = this.requesterLabel(user);
    await this.notifyAllAdmins({
      type: NotificationType.WITHDRAWAL_HUB_APPROVED,
      title: 'Withdrawal Ready for Admin Review',
      message: `${label}'s withdrawal ${request.requestNumber} ($${request.requestedAmount.toFixed(2)}) was approved by Hub and needs payout.`,
      triggeredBy: request.hubReviewerId?.toString(),
      link: '/withdrawals',
      metadata: {
        withdrawalRequestId: request._id,
        requestNumber: request.requestNumber,
      },
    });
  }

  async listMyWithdrawals(userId: string) {
    const items = await this.withdrawalModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .populate('sourceHubId', 'email partnerCode firstName lastName countries country')
      .lean();
    return items.map((w) => this.formatWithdrawal(w));
  }

  async getWithdrawalDetail(id: string, viewerId: string, viewerRole: UserRole) {
    const viewerIdStr = String(viewerId?.toString?.() ?? viewerId);
    const request = await this.withdrawalModel
      .findById(id)
      .populate('userId', 'firstName lastName email partnerCode role')
      .populate('hubReviewerId', 'firstName lastName email partnerCode')
      .populate('adminReviewerId', 'firstName lastName email')
      .lean();
    if (!request) throw new NotFoundException('Withdrawal not found');

    const requesterId = this.resolveRequesterId(request);
    const isOwner = requesterId === viewerIdStr;
    const isAdmin = viewerRole === UserRole.ADMIN;
    const isHub =
      viewerRole === UserRole.PARTNER &&
      (await this.isHubOwnerOfRequester(viewerIdStr, requesterId));

    if (!isOwner && !isAdmin && !isHub) {
      throw new ForbiddenException();
    }

    const history = await this.auditService.getWithdrawalHistory(id);
    const commissions = await this.commissionModel
      .find({ _id: { $in: request.commissionRecordIds } })
      .lean();

    let bankDetails: Record<string, unknown> | null = null;
    if (request.bankDetailsId) {
      const bankId = request.bankDetailsId.toString();
      bankDetails = isAdmin
        ? await this.bankDetailsService.getByIdForAdminReview(bankId)
        : await this.bankDetailsService.getByIdSafe(bankId);
    }

    return {
      ...this.formatWithdrawal(request),
      commissions,
      history,
      bankDetails,
    };
  }

  private resolveRequesterId(w: Record<string, any>): string {
    const requester = w.userId as { _id?: Types.ObjectId | string };
    return requester?._id?.toString?.() || String(w.userId || '');
  }

  private async isHubOwnerOfRequester(
    hubId: string,
    requesterId: string,
  ): Promise<boolean> {
    const owners = await this.usersService.findOwningHubPartners(requesterId);
    return owners.some((o) => o._id.toString() === hubId);
  }

  private resolveSourceHubId(w: Record<string, any>): string {
    const source = w.sourceHubId;
    if (!source) return '';
    if (typeof source === 'string') return source;
    if (source._id) return source._id.toString();
    if (typeof source.toString === 'function') {
      const asString = source.toString();
      if (asString && asString !== '[object Object]') return asString;
    }
    return String(source);
  }

  private async resolveReviewHubs(
    requesterId: string,
    sourceHubId?: string,
  ) {
    if (sourceHubId) {
      const hub = await this.usersService.findOne(sourceHubId);
      return hub?.role === UserRole.PARTNER ? [hub] : [];
    }
    return this.usersService.findOwningHubPartners(requesterId);
  }

  private async filterWithdrawalsForHub(
    hubId: string,
    withdrawals: Record<string, any>[],
  ): Promise<Record<string, any>[]> {
    const items: Record<string, any>[] = [];
    for (const w of withdrawals) {
      const sourceHubId = this.resolveSourceHubId(w);
      if (sourceHubId) {
        if (sourceHubId === hubId) items.push(w);
        continue;
      }
      const requesterId = this.resolveRequesterId(w);
      if (!requesterId) continue;
      if (await this.isHubOwnerOfRequester(hubId, requesterId)) {
        items.push(w);
      }
    }
    return items;
  }

  async listHubNetworkWithdrawals(hubUserId: string) {
    const hubId = String(hubUserId?.toString?.() ?? hubUserId);
    const hub = await this.usersService.findOne(hubId);
    if (!hub || hub.role !== UserRole.PARTNER) {
      throw new ForbiddenException('Hub access only');
    }

    const all = await this.withdrawalModel
      .find({})
      .sort({ createdAt: -1 })
      .populate('userId', 'firstName lastName email partnerCode role')
      .populate('hubReviewerId', 'firstName lastName email partnerCode')
      .lean();

    const items = await this.filterWithdrawalsForHub(hubId, all);
    return items.map((w) => this.formatWithdrawal(w));
  }

  async listHubPending(hubUserId: string) {
    const hubId = String(hubUserId?.toString?.() ?? hubUserId);
    const hub = await this.usersService.findOne(hubId);
    if (!hub || hub.role !== UserRole.PARTNER) {
      throw new ForbiddenException('Hub access only');
    }

    const allPending = await this.withdrawalModel
      .find({ status: WithdrawalStatus.WAITING_HUB_APPROVAL })
      .sort({ createdAt: 1 })
      .populate('userId', 'firstName lastName email partnerCode role')
      .lean();

    const items = await this.filterWithdrawalsForHub(hubId, allPending);
    for (const w of items) {
      await this.ensureHubNotifiedForPending(
        w,
        w.userId as { _id?: Types.ObjectId | string; firstName?: string; lastName?: string; partnerCode?: string },
      );
    }

    return items.map((w) => this.formatWithdrawal(w));
  }

  private async ensureHubNotifiedForPending(
    request: Record<string, any>,
    requester: { _id?: Types.ObjectId | string; firstName?: string; lastName?: string; partnerCode?: string },
  ) {
    const requestId = request._id?.toString?.();
    if (!requestId) return;

    const requesterId = requester?._id?.toString?.() || String(request.userId || '');
    const owners = await this.resolveReviewHubs(
      requesterId,
      this.resolveSourceHubId(request),
    );
    const label = this.requesterLabel(requester as any);
    const amount = Number(request.requestedAmount || 0).toFixed(2);

    for (const hub of owners) {
      const hubId = hub._id.toString();
      const exists = await this.notificationsService.existsWithdrawalNotification(
        requestId,
        hubId,
      );
      if (exists) continue;

      await this.pushNotification({
        type: NotificationType.WITHDRAWAL_SUBMITTED,
        title: 'Withdrawal Review Required',
        message: `${label} submitted a withdrawal of $${amount}.`,
        user: hubId,
        triggeredBy: requesterId,
        link: '/dashboard/partner/network?tab=earnings',
        metadata: {
          withdrawalRequestId: requestId,
          requestNumber: request.requestNumber,
        },
      });
    }
  }

  async listAdminPending() {
    const items = await this.withdrawalModel
      .find({ status: WithdrawalStatus.SENT_TO_ADMIN })
      .sort({ createdAt: 1 })
      .populate('userId', 'firstName lastName email partnerCode role')
      .populate('hubReviewerId', 'firstName lastName email partnerCode')
      .lean();
    return items.map((w) => this.formatWithdrawal(w));
  }

  async listAdminAll(status?: string) {
    const query: Record<string, unknown> = {};
    if (status === 'pending') {
      query.status = WithdrawalStatus.SENT_TO_ADMIN;
    } else if (status) {
      query.status = status;
    }

    const items = await this.withdrawalModel
      .find(query)
      .sort({ createdAt: -1 })
      .populate('userId', 'firstName lastName email partnerCode role')
      .populate('hubReviewerId', 'firstName lastName email partnerCode')
      .populate('adminReviewerId', 'firstName lastName email')
      .lean();
    return items.map((w) => this.formatWithdrawal(w));
  }

  async hubReview(
    withdrawalId: string,
    hubUserId: string,
    action: 'approve' | 'reject',
    note?: string,
  ) {
    const hubId = String(hubUserId?.toString?.() ?? hubUserId);
    const request = await this.withdrawalModel.findById(withdrawalId);
    if (!request) throw new NotFoundException('Withdrawal not found');

    if (request.status !== WithdrawalStatus.WAITING_HUB_APPROVAL) {
      throw new BadRequestException('Withdrawal is not awaiting hub approval');
    }

    const hub = await this.usersService.findOne(hubId);
    if (!hub || hub.role !== UserRole.PARTNER) {
      throw new ForbiddenException();
    }

    const sourceHubId = request.sourceHubId?.toString();
    if (sourceHubId) {
      if (sourceHubId !== hubId) {
        throw new ForbiddenException('This withdrawal belongs to a different hub');
      }
    } else {
      const inNetwork = await this.isHubOwnerOfRequester(
        hubId,
        request.userId.toString(),
      );
      if (!inNetwork && request.userId.toString() !== hubId) {
        throw new ForbiddenException('User is not in your network');
      }
    }

    if (action === 'reject') {
      request.status = WithdrawalStatus.REJECTED_BY_HUB;
      request.hubReviewerId = new Types.ObjectId(hubId);
      request.hubReviewedAt = new Date();
      request.hubReviewNote = note;
      await request.save();

      await this.commissionsService.unlockCommissions(request.commissionRecordIds);
      await this.auditService.logApproval({
        withdrawalRequestId: request._id as Types.ObjectId,
        action: ApprovalAction.HUB_REJECT,
        actorUserId: new Types.ObjectId(hubId),
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
        triggeredBy: hubId,
        link: '/dashboard/partner/network?tab=earnings',
      });

      return this.enrichWithdrawal(request);
    }

    // Approve
    request.status = WithdrawalStatus.HUB_APPROVED;
    request.hubReviewerId = new Types.ObjectId(hubId);
    request.hubReviewedAt = new Date();
    request.hubReviewNote = note;
    request.walletCreditedAt = new Date();
    await request.save();

    await this.walletsService.creditFromHubApproval(
      request.userId.toString(),
      request.requestedAmount,
      request._id.toString(),
      hubId,
    );

    request.status = WithdrawalStatus.SENT_TO_ADMIN;
    await request.save();

    await this.auditService.logApproval({
      withdrawalRequestId: request._id as Types.ObjectId,
      action: ApprovalAction.HUB_APPROVE,
      actorUserId: new Types.ObjectId(hubId),
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
      triggeredBy: hubId,
      link: '/dashboard/partner/network?tab=earnings',
    });

    const requester = await this.usersService.findOne(request.userId.toString());
    if (requester) {
      await this.notifyAdminsPendingPayout(requester as any, request);
    }

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
    if (user) await this.notifyStakeholdersOnSubmit(user as any, request);

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
