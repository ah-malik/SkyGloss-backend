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
import { User, UserDocument } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { normalizePartnerCode } from '../../common/partner-code';
import { GLOBAL_HUB_PARTNER_CODE } from '../../common/global-hub';
import { normalizeHubCountries } from '../../common/hub-countries';
import { isShopParentLinkRole } from '../../common/user-hierarchy';
import {
  canonicalEarningType,
  missingCommissionAmount,
  uniqueSplitEarningType,
} from '../commission-split';

export type WithdrawalHubBalance = {
  hubId: string;
  hubPartnerCode: string;
  email: string;
  firstName: string;
  lastName: string;
  countries: string[];
  available: number;
  role: string;
};

@Injectable()
export class CommissionsService {
  private readonly logger = new Logger(CommissionsService.name);

  constructor(
    @InjectModel(CommissionRecord.name)
    private commissionModel: Model<CommissionRecordDocument>,
    @InjectModel(Order.name)
    private orderModel: Model<OrderDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private usersService: UsersService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
  ) {}

  async syncFromShippedOrder(orderId: string, shippedAt: Date): Promise<void> {
    const order = await this.orderModel
      .findById(orderId)
      .populate(
        'user',
        'hubPartnerCode country parentLinkAssignedAt previousParentPartnerCode role',
      );
    if (!order?.commissions?.length) return;

    const actingParentPartnerCode =
      await this.usersService.resolveActingParentForOrder({
        actingParentPartnerCode: (order as any).actingParentPartnerCode,
        createdAt: (order as any).createdAt,
        user: order.user as {
          hubPartnerCode?: string;
          country?: string;
          parentLinkAssignedAt?: Date;
          previousParentPartnerCode?: string;
        },
      });
    if (
      actingParentPartnerCode &&
      !normalizePartnerCode((order as any).actingParentPartnerCode)
    ) {
      (order as any).actingParentPartnerCode = actingParentPartnerCode;
    }

    const availableAt = computeCommissionAvailableAt(shippedAt);

    for (const entry of order.commissions) {
      if (!entry.recipientUserId || entry.amount <= 0) continue;

      const existing = await this.commissionModel.findOne({
        orderId: order._id,
        recipientUserId: new Types.ObjectId(entry.recipientUserId),
        earningType: entry.earningType || 'Shop Introduction',
      });

      if (existing) {
        // Keep PENDING_HOLD rows aligned with locked order.commissions
        // (e.g. legacy Shop Intro 20% repaired back to 10% after ship).
        if (
          existing.status === CommissionLifecycleStatus.PENDING_HOLD &&
          (Number(existing.percentage) !== Number(entry.percentage) ||
            Math.abs(Number(existing.amount) - Number(entry.amount)) >= 0.02)
        ) {
          existing.percentage = entry.percentage;
          existing.amount = entry.amount;
          existing.recipientPartnerCode = entry.recipientPartnerCode;
          existing.originalCurrency = entry.originalCurrency;
          existing.exchangeRate = entry.exchangeRate;
          existing.convertedUsdAmount = entry.convertedUsdAmount;
          if (
            !existing.actingParentPartnerCode &&
            actingParentPartnerCode
          ) {
            existing.actingParentPartnerCode = actingParentPartnerCode;
          }
          await existing.save();
          this.logger.log(
            `Updated PENDING_HOLD commission ${existing._id} for order ${order.orderNumber}: ${entry.percentage}% / $${entry.amount}`,
          );
        } else if (
          !existing.actingParentPartnerCode &&
          actingParentPartnerCode
        ) {
          existing.actingParentPartnerCode = actingParentPartnerCode;
          await existing.save();
        }
        continue;
      }

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
        actingParentPartnerCode,
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
    await this.releaseAvailableCommissions();
    await this.repairOrphanedPartialAmounts(userId);

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

  /**
   * Withdraw Funds picker: group available commissions by the Parent Link
   * that owned the shop when that commission was earned — never the shop's
   * current Parent Link. Existing balances are not moved on Parent Link change.
   */
  async getAvailableByHub(userId: string): Promise<{
    hubs: WithdrawalHubBalance[];
    currency: string;
  }> {
    await this.releaseAvailableCommissions();
    await this.repairOrphanedPartialAmounts(userId);

    const uid = new Types.ObjectId(userId);
    const availableRecords = await this.commissionModel
      .find({
        recipientUserId: uid,
        status: CommissionLifecycleStatus.AVAILABLE,
      })
      .select('_id amount shopUserId orderId actingParentPartnerCode')
      .lean();

    const recordHubMap = await this.resolveHubCodesForRecords(availableRecords);
    const availableByHub = new Map<string, number>();
    for (const record of availableRecords) {
      const code =
        recordHubMap.get(String(record._id)) || GLOBAL_HUB_PARTNER_CODE;
      availableByHub.set(
        code,
        Math.round(((availableByHub.get(code) || 0) + record.amount) * 100) /
          100,
      );
    }

    const hubsById = new Map<string, WithdrawalHubBalance>();
    for (const [code, amount] of availableByHub.entries()) {
      if (amount <= 0) continue;
      const hub = await this.usersService.findByPartnerCode(code);
      if (!hub || !isShopParentLinkRole(hub.role)) continue;
      const hubId = hub._id.toString();
      const existing = hubsById.get(hubId);
      if (existing) {
        existing.available =
          Math.round((existing.available + amount) * 100) / 100;
        continue;
      }
      const countries = normalizeHubCountries(
        hub.countries?.length
          ? hub.countries
          : hub.country
            ? [hub.country]
            : [],
      );
      hubsById.set(hubId, {
        hubId,
        hubPartnerCode: normalizePartnerCode(hub.partnerCode) || code,
        email: hub.email || '',
        firstName: hub.firstName || '',
        lastName: hub.lastName || '',
        countries,
        available: Math.round(amount * 100) / 100,
        role: hub.role,
      });
    }

    const hubs = Array.from(hubsById.values());
    hubs.sort((a, b) => {
      if (b.available !== a.available) return b.available - a.available;
      return (a.email || a.hubPartnerCode).localeCompare(
        b.email || b.hubPartnerCode,
      );
    });

    return { hubs, currency: 'USD' };
  }

  async resolveActingParentCodesForRecords(
    records: Array<{
      _id?: unknown;
      shopUserId?: Types.ObjectId;
      orderId?: Types.ObjectId;
      actingParentPartnerCode?: string;
    }>,
  ): Promise<Map<string, string>> {
    return this.resolveHubCodesForRecords(records);
  }

  private async resolveHubCodesForRecords(
    records: Array<{
      _id?: unknown;
      shopUserId?: Types.ObjectId;
      orderId?: Types.ObjectId;
      actingParentPartnerCode?: string;
    }>,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!records.length) return result;

    const unresolved: Array<{
      recordId: string;
      shopUserId?: string;
      orderId?: string;
    }> = [];

    for (const record of records) {
      const recordId = (record._id as { toString(): string })?.toString?.();
      if (!recordId) continue;
      const stamped = normalizePartnerCode(record.actingParentPartnerCode);
      if (stamped) {
        result.set(recordId, stamped);
        continue;
      }
      unresolved.push({
        recordId,
        shopUserId: record.shopUserId?.toString(),
        orderId: record.orderId?.toString(),
      });
    }

    if (!unresolved.length) return result;

    const orderIds = [
      ...new Set(unresolved.map((r) => r.orderId).filter(Boolean)),
    ] as string[];
    const orders = orderIds.length
      ? await this.orderModel
          .find({ _id: { $in: orderIds } })
          .select('actingParentPartnerCode createdAt user')
          .populate(
            'user',
            'hubPartnerCode country parentLinkAssignedAt previousParentPartnerCode',
          )
          .lean()
      : [];
    const orderById = new Map(orders.map((order) => [String(order._id), order]));

    const shopIds = new Set<string>();
    for (const item of unresolved) {
      if (item.shopUserId) shopIds.add(item.shopUserId);
      const order = item.orderId ? orderById.get(item.orderId) : undefined;
      const orderUser = order?.user as
        | { _id?: { toString(): string } }
        | string
        | undefined;
      const orderShopId =
        typeof orderUser === 'object' && orderUser?._id
          ? String(orderUser._id)
          : orderUser
            ? String(orderUser)
            : '';
      if (orderShopId) shopIds.add(orderShopId);
    }

    const shops = shopIds.size
      ? await this.userModel
          .find({ _id: { $in: Array.from(shopIds) } })
          .select(
            'hubPartnerCode country parentLinkAssignedAt previousParentPartnerCode',
          )
          .lean()
      : [];
    const shopById = new Map(
      shops.map((shop) => [String(shop._id), shop]),
    );

    for (const item of unresolved) {
      const order = item.orderId ? orderById.get(item.orderId) : undefined;
      const orderUser = order?.user as
        | {
            _id?: { toString(): string };
            hubPartnerCode?: string;
            country?: string;
            parentLinkAssignedAt?: Date;
            previousParentPartnerCode?: string;
          }
        | string
        | undefined;
      const shopId =
        item.shopUserId ||
        (typeof orderUser === 'object' && orderUser?._id
          ? String(orderUser._id)
          : orderUser
            ? String(orderUser)
            : '');
      const shop =
        typeof orderUser === 'object'
          ? orderUser
          : shopById.get(shopId);

      const code = await this.usersService.resolveActingParentForOrder({
        actingParentPartnerCode: (order as { actingParentPartnerCode?: string })
          ?.actingParentPartnerCode,
        createdAt: (order as { createdAt?: Date })?.createdAt,
        user: shop,
      });
      result.set(item.recordId, code || GLOBAL_HUB_PARTNER_CODE);
    }

    return result;
  }

  async listForUser(
    userId: string,
    filters?: { status?: string; page?: number; limit?: number },
  ) {
    await this.releaseAvailableCommissions();

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
    hubPartnerCode?: string,
  ): Promise<{ recordIds: Types.ObjectId[]; total: number }> {
    await this.repairOrphanedPartialAmounts(userId);
    const available = await this.commissionModel
      .find({
        recipientUserId: new Types.ObjectId(userId),
        status: CommissionLifecycleStatus.AVAILABLE,
      })
      .sort({ availableAt: 1 });

    let eligible = available;
    const hubMap = await this.resolveHubCodesForRecords(available);
    const targetHub = normalizePartnerCode(hubPartnerCode);
    if (targetHub) {
      eligible = available.filter(
        (record) => hubMap.get(record._id.toString()) === targetHub,
      );
    }

    for (const record of eligible) {
      const resolved = hubMap.get(record._id.toString());
      if (resolved && !normalizePartnerCode(record.actingParentPartnerCode)) {
        record.actingParentPartnerCode = resolved;
      }
    }

    const target = Math.round(amount * 100) / 100;
    if (target <= 0) {
      throw new Error('Invalid withdrawal amount');
    }

    let runningTotal = 0;
    const plan: Array<{
      record: CommissionRecordDocument;
      mode: 'full' | 'partial';
      lockAmount?: number;
    }> = [];

    for (const record of eligible) {
      if (runningTotal >= target) break;

      const recordAmount = Math.round(record.amount * 100) / 100;
      if (recordAmount <= 0) continue;

      if (runningTotal + recordAmount <= target) {
        plan.push({ record, mode: 'full' });
        runningTotal = Math.round((runningTotal + recordAmount) * 100) / 100;
        continue;
      }

      const need = Math.round((target - runningTotal) * 100) / 100;
      if (need > 0) {
        plan.push({ record, mode: 'partial', lockAmount: need });
        runningTotal = target;
      }
      break;
    }

    if (runningTotal < target) {
      throw new Error('Insufficient available commission balance');
    }

    const selected: Types.ObjectId[] = [];
    try {
      for (const step of plan) {
        if (step.mode === 'full') {
          step.record.status = CommissionLifecycleStatus.LOCKED;
          await step.record.save();
          selected.push(step.record._id as Types.ObjectId);
        } else {
          const lockedId = await this.splitAndLockRecord(
            step.record,
            step.lockAmount as number,
          );
          selected.push(lockedId);
        }
      }
      return { recordIds: selected, total: target };
    } catch (err) {
      await this.unlockCommissions(selected);
      throw err;
    }
  }

  private async splitAndLockRecord(
    record: CommissionRecordDocument,
    lockAmount: number,
  ): Promise<Types.ObjectId> {
    const lock = Math.round(lockAmount * 100) / 100;
    const remainder = Math.round((record.amount - lock) * 100) / 100;

    if (lock <= 0 || lock > record.amount) {
      throw new Error('Invalid partial commission lock amount');
    }

    if (remainder <= 0) {
      record.status = CommissionLifecycleStatus.LOCKED;
      await record.save();
      return record._id as Types.ObjectId;
    }

    const originalAmount = record.amount;
    record.amount = remainder;
    await record.save();

    try {
      const splitId = new Types.ObjectId();
      const partial = await this.commissionModel.create({
        _id: splitId,
        orderId: record.orderId,
        orderNumber: record.orderNumber,
        recipientUserId: record.recipientUserId,
        recipientPartnerCode: record.recipientPartnerCode,
        recipientRole: record.recipientRole,
        earningType: uniqueSplitEarningType(
          record.earningType,
          splitId.toHexString(),
        ),
        percentage: record.percentage,
        amount: lock,
        currency: record.currency,
        status: CommissionLifecycleStatus.LOCKED,
        shippedAt: record.shippedAt,
        availableAt: record.availableAt,
        availableConfirmedAt: record.availableConfirmedAt,
        shopUserId: record.shopUserId,
        actingParentPartnerCode: record.actingParentPartnerCode,
        originalCurrency: record.originalCurrency,
        exchangeRate: record.exchangeRate,
        convertedUsdAmount: record.convertedUsdAmount,
        splitFromRecordId: record._id as Types.ObjectId,
      });

      return partial._id as Types.ObjectId;
    } catch (err) {
      record.amount = originalAmount;
      await record.save();
      throw err;
    }
  }

  /** Restore amount lost when a partial lock shrank the parent but the split insert failed. */
  private async repairOrphanedPartialAmounts(userId: string): Promise<void> {
    const uid = new Types.ObjectId(userId);
    const records = await this.commissionModel.find({
      recipientUserId: uid,
      status: { $ne: CommissionLifecycleStatus.CANCELLED },
    });
    const originals = records.filter(
      (record) =>
        !record.splitFromRecordId &&
        record.status === CommissionLifecycleStatus.AVAILABLE,
    );
    if (!originals.length) return;

    const orders = await this.orderModel
      .find({ _id: { $in: originals.map((record) => record.orderId) } })
      .select('_id commissions');
    const orderById = new Map(orders.map((order) => [String(order._id), order]));

    for (const original of originals) {
      const canonical = canonicalEarningType(original.earningType);
      const relatedAmounts = records
        .filter(
          (record) =>
            String(record.orderId) === String(original.orderId) &&
            canonicalEarningType(record.earningType) === canonical,
        )
        .map((record) => record.amount);
      const order = orderById.get(String(original.orderId));
      const entry = (order?.commissions || []).find(
        (commission) =>
          String(commission.recipientUserId) ===
            String(original.recipientUserId) &&
          canonicalEarningType(commission.earningType || 'Shop Introduction') ===
            canonical,
      );
      if (!entry) continue;
      const missing = missingCommissionAmount(entry.amount, relatedAmounts);
      if (missing <= 0) continue;
      original.amount = Math.round((original.amount + missing) * 100) / 100;
      await original.save();
      this.logger.warn(
        `Restored $${missing.toFixed(2)} on commission ${original._id} after a failed partial withdrawal lock`,
      );
    }
  }

  async unlockCommissions(recordIds: Types.ObjectId[]): Promise<void> {
    for (const id of recordIds) {
      const record = await this.commissionModel.findById(id);
      if (!record || record.status !== CommissionLifecycleStatus.LOCKED) {
        continue;
      }

      if (record.splitFromRecordId) {
        const parent = await this.commissionModel.findById(record.splitFromRecordId);
        if (parent) {
          parent.amount =
            Math.round((parent.amount + record.amount) * 100) / 100;
          await parent.save();
        }
        await record.deleteOne();
        continue;
      }

      record.status = CommissionLifecycleStatus.AVAILABLE;
      record.withdrawalRequestId = undefined;
      await record.save();
    }
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
