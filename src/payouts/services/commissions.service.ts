import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CommissionLifecycleStatus,
  CommissionRecord,
  CommissionRecordDocument,
} from '../entities/commission-record.entity';
import { computeCommissionAvailableAt } from '../commission-hold.config';
import { Order, OrderDocument, OrderStatus } from '../../orders/entities/order.entity';
import { ApprovalAction, AuditService } from './audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationsGateway } from '../../notifications/notifications.gateway';
import { NotificationType } from '../../notifications/entities/notification.entity';

@Injectable()
export class CommissionsService {
  private readonly logger = new Logger(CommissionsService.name);

  constructor(
    @InjectModel(CommissionRecord.name)
    private commissionModel: Model<CommissionRecordDocument>,
    @InjectModel(Order.name)
    private orderModel: Model<OrderDocument>,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
  ) {}

  async syncFromShippedOrder(orderId: string, shippedAt: Date): Promise<void> {
    const order = await this.orderModel.findById(orderId);
    if (!order?.commissions?.length) return;

    const availableAt = computeCommissionAvailableAt(shippedAt);

    for (const entry of order.commissions) {
      if (!entry.recipientUserId || entry.amount <= 0) continue;

      const existing = await this.commissionModel.findOne({
        orderId: order._id,
        recipientUserId: new Types.ObjectId(entry.recipientUserId),
        earningType: entry.earningType || 'Shop Introduction',
      });

      if (existing) continue;

      const record = await this.commissionModel.create({
        orderId: order._id,
        orderNumber: order.orderNumber,
        recipientUserId: new Types.ObjectId(entry.recipientUserId),
        recipientPartnerCode: entry.recipientPartnerCode,
        recipientRole: entry.recipientRole,
        earningType: entry.earningType || 'Shop Introduction',
        percentage: entry.percentage,
        amount: entry.amount,
        currency: order.baseCurrency || order.currency || 'USD',
        status: CommissionLifecycleStatus.PENDING_HOLD,
        shippedAt,
        availableAt,
        shopUserId: entry.shopId ? new Types.ObjectId(entry.shopId) : undefined,
        originalCurrency: entry.originalCurrency,
        exchangeRate: entry.exchangeRate,
        convertedUsdAmount: entry.convertedUsdAmount,
      });

      await this.auditService.logApproval({
        action: ApprovalAction.COMMISSION_CREATED,
        commissionRecordId: record._id as Types.ObjectId,
        metadata: {
          orderNumber: order.orderNumber,
          amount: entry.amount,
          availableAt,
        },
      });

      await this.auditService.logTransaction({
        userId: new Types.ObjectId(entry.recipientUserId),
        category: 'commission',
        title: `Commission pending — Order ${order.orderNumber}`,
        amount: entry.amount,
        direction: 'credit',
        referenceId: order.orderNumber,
        sourceDocumentId: record._id as Types.ObjectId,
        sourceCollection: 'CommissionRecord',
        snapshot: {
          status: CommissionLifecycleStatus.PENDING_HOLD,
          availableAt,
          earningType: entry.earningType,
        },
      });
    }

    // Keep embedded commissions pending until 30-day hold completes
    order.commissions = order.commissions.map((c) => ({
      ...c,
      status: 'pending' as const,
    }));
    order.markModified('commissions');
    await order.save();
  }

  async cancelCommissionsForOrder(orderId: string): Promise<void> {
    await this.commissionModel.updateMany(
      {
        orderId: new Types.ObjectId(orderId),
        status: {
          $in: [
            CommissionLifecycleStatus.PENDING_HOLD,
            CommissionLifecycleStatus.AVAILABLE,
          ],
        },
      },
      { status: CommissionLifecycleStatus.CANCELLED },
    );
  }

  async releaseAvailableCommissions(): Promise<number> {
    const now = new Date();
    const pending = await this.commissionModel.find({
      status: CommissionLifecycleStatus.PENDING_HOLD,
      availableAt: { $lte: now },
    });

    let released = 0;
    for (const record of pending) {
      record.status = CommissionLifecycleStatus.AVAILABLE;
      record.availableConfirmedAt = now;
      await record.save();
      released += 1;

      await this.syncOrderCommissionEarned(
        record.orderId.toString(),
        record.recipientUserId.toString(),
        record.earningType,
      );

      await this.auditService.logApproval({
        action: ApprovalAction.COMMISSION_AVAILABLE,
        commissionRecordId: record._id as Types.ObjectId,
        newStatus: CommissionLifecycleStatus.AVAILABLE,
      });

      await this.auditService.logTransaction({
        userId: record.recipientUserId,
        category: 'commission',
        title: `Commission available — Order ${record.orderNumber}`,
        amount: record.amount,
        direction: 'credit',
        referenceId: record.orderNumber,
        sourceDocumentId: record._id as Types.ObjectId,
        sourceCollection: 'CommissionRecord',
        snapshot: { status: CommissionLifecycleStatus.AVAILABLE },
      });

      await this.notificationsService
        .create({
          type: NotificationType.COMMISSION_AVAILABLE,
          title: 'Commission Available',
          message: `$${record.amount.toFixed(2)} from order ${record.orderNumber} is now available for withdrawal.`,
          user: record.recipientUserId.toString(),
          link: '/dashboard/partner/network?tab=earnings',
          metadata: { commissionRecordId: record._id, orderNumber: record.orderNumber },
        })
        .then((n) => this.notificationsGateway.broadcastNotification(n))
        .catch((err) => this.logger.error('Notification failed', err));
    }

    if (released > 0) {
      this.logger.log(`Released ${released} commission(s) to available`);
    }
    return released;
  }

  private async syncOrderCommissionEarned(
    orderId: string,
    recipientUserId: string,
    earningType: string,
  ): Promise<void> {
    const order = await this.orderModel.findById(orderId);
    if (!order?.commissions?.length) return;

    order.commissions = order.commissions.map((c) => {
      if (
        String(c.recipientUserId) === recipientUserId &&
        (c.earningType || 'Shop Introduction') === earningType
      ) {
        return { ...c, status: 'earned' as const };
      }
      return c;
    });
    order.markModified('commissions');
    await order.save();
  }

  async getSummary(userId: string) {
    const uid = new Types.ObjectId(userId);
    const records = await this.commissionModel.find({ recipientUserId: uid }).lean();

    const summary = {
      pendingHold: 0,
      available: 0,
      locked: 0,
      withdrawn: 0,
      cancelled: 0,
      totalEarned: 0,
      currency: 'USD',
    };

    for (const r of records) {
      summary.totalEarned += r.amount;
      switch (r.status) {
        case CommissionLifecycleStatus.PENDING_HOLD:
          summary.pendingHold += r.amount;
          break;
        case CommissionLifecycleStatus.AVAILABLE:
          summary.available += r.amount;
          break;
        case CommissionLifecycleStatus.LOCKED:
          summary.locked += r.amount;
          break;
        case CommissionLifecycleStatus.WITHDRAWN:
          summary.withdrawn += r.amount;
          break;
        case CommissionLifecycleStatus.CANCELLED:
          summary.cancelled += r.amount;
          break;
      }
    }

    for (const key of ['pendingHold', 'available', 'locked', 'withdrawn', 'cancelled', 'totalEarned'] as const) {
      summary[key] = Math.round(summary[key] * 100) / 100;
    }

    return summary;
  }

  async listForUser(
    userId: string,
    filters?: { status?: string; page?: number; limit?: number },
  ) {
    const query: Record<string, unknown> = {
      recipientUserId: new Types.ObjectId(userId),
    };
    if (filters?.status) query.status = filters.status;

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.commissionModel
        .find(query)
        .sort({ shippedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.commissionModel.countDocuments(query),
    ]);

    return { items, total, page, limit };
  }

  async lockCommissionsForWithdrawal(
    userId: string,
    amount: number,
  ): Promise<{ recordIds: Types.ObjectId[]; total: number }> {
    const available = await this.commissionModel
      .find({
        recipientUserId: new Types.ObjectId(userId),
        status: CommissionLifecycleStatus.AVAILABLE,
      })
      .sort({ availableAt: 1 });

    const selected: Types.ObjectId[] = [];
    let total = 0;
    const target = Math.round(amount * 100) / 100;

    for (const record of available) {
      if (total >= target) break;
      selected.push(record._id as Types.ObjectId);
      total = Math.round((total + record.amount) * 100) / 100;
      record.status = CommissionLifecycleStatus.LOCKED;
      await record.save();
    }

    if (total < target) {
      // Rollback locks
      await this.commissionModel.updateMany(
        { _id: { $in: selected } },
        { status: CommissionLifecycleStatus.AVAILABLE },
      );
      throw new Error('Insufficient available commission');
    }

    if (total > target) {
      // Commission records are indivisible — partial amount must match a exact sum
      await this.commissionModel.updateMany(
        { _id: { $in: selected } },
        { status: CommissionLifecycleStatus.AVAILABLE },
      );
      throw new Error(
        'Withdrawal amount must match your full available balance. Use "Withdraw full balance".',
      );
    }

    return { recordIds: selected, total };
  }

  async unlockCommissions(recordIds: Types.ObjectId[]): Promise<void> {
    await this.commissionModel.updateMany(
      {
        _id: { $in: recordIds },
        status: CommissionLifecycleStatus.LOCKED,
      },
      { status: CommissionLifecycleStatus.AVAILABLE, $unset: { withdrawalRequestId: 1 } },
    );
  }

  async markWithdrawn(recordIds: Types.ObjectId[], withdrawalRequestId: string): Promise<void> {
    await this.commissionModel.updateMany(
      { _id: { $in: recordIds } },
      {
        status: CommissionLifecycleStatus.WITHDRAWN,
        withdrawalRequestId: new Types.ObjectId(withdrawalRequestId),
      },
    );
  }

  async backfillFromExistingOrders(): Promise<number> {
    const shippedOrders = await this.orderModel.find({
      status: { $in: [OrderStatus.SHIPPED, OrderStatus.DELIVERED] },
      'commissions.0': { $exists: true },
    });

    let created = 0;
    for (const order of shippedOrders) {
      const shippedAt =
        (order as Order & { shippedAt?: Date }).shippedAt ||
        (order as Order & { updatedAt?: Date }).updatedAt ||
        new Date();
      const before = await this.commissionModel.countDocuments({ orderId: order._id });
      await this.syncFromShippedOrder(order._id.toString(), shippedAt);
      const after = await this.commissionModel.countDocuments({ orderId: order._id });
      created += after - before;

      // Release already-eligible
      await this.commissionModel.updateMany(
        {
          orderId: order._id,
          status: CommissionLifecycleStatus.PENDING_HOLD,
          availableAt: { $lte: new Date() },
        },
        {
          status: CommissionLifecycleStatus.AVAILABLE,
          availableConfirmedAt: new Date(),
        },
      );
    }
    return created;
  }
}
