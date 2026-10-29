import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../../orders/entities/order.entity';
import { UserDocument } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { canViewerSeeOrderPlacerRole } from '../../common/user-hierarchy';
import {
  ACTIVE_WITHDRAWAL_STATUSES,
  WithdrawalRequest,
  WithdrawalRequestDocument,
  WithdrawalStatus,
} from '../entities/withdrawal-request.entity';
import { getCommissionHoldMs } from '../commission-hold.config';
import { roundMoney } from '../../common/order-monetary';
import {
  HUB_PRODUCT_COMMISSION_FROM,
  HUB_PRODUCT_COMMISSION_RATE,
  HUB_PRODUCT_COMMISSION_SOURCE,
  HubCommissionOrder,
  isHubProductCommissionUser,
  summarizeHubProductCommission,
} from '../hub-product-commission.logic';

export type HubProductCommissionSummary = {
  eligible: true;
  currency: 'USD';
  ratePercent: number;
  from: string;
  /** All paid / shipped / delivered orders since `from`. */
  earned: number;
  /** Can be withdrawn now (released − in request − paid out). */
  available: number;
  /** Shipped, inside the 15-day hold. */
  onHold: number;
  /** Paid, not shipped yet. */
  awaitingShipment: number;
  /** Withdrawal requests not finished yet. */
  inRequest: number;
  /** Completed payouts. */
  paidOut: number;
};

@Injectable()
export class HubProductCommissionService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(WithdrawalRequest.name)
    private readonly withdrawalModel: Model<WithdrawalRequestDocument>,
    private readonly usersService: UsersService,
  ) {}

  isEligible(user?: { role?: string; email?: string } | null): boolean {
    return isHubProductCommissionUser(user);
  }

  assertEligible(user?: { role?: string; email?: string } | null): void {
    if (!this.isEligible(user)) {
      throw new ForbiddenException(
        'Hub accounts cannot request withdrawals. Manage network payout reviews instead.',
      );
    }
  }

  /**
   * The Hub's network orders as the Earnings page lists them
   * (OrdersService.getNetworkOrders rules: own orders + lower-role placers).
   * Duplicated here because PayoutsModule cannot import OrdersModule.
   */
  private async getCommissionOrders(hub: UserDocument): Promise<HubCommissionOrder[]> {
    const network = await this.usersService.findNetworkUsersForViewer(hub);
    const ids = new Set<string>([String(hub._id)]);
    const add = (u?: { _id?: unknown }) => {
      if (u?._id) ids.add(String(u._id));
    };
    network.shops.forEach(add);
    network.promoters.forEach(add);
    network.subPromoters?.forEach(add);
    network.representatives.forEach(add);
    network.represented?.forEach(add);
    network.distributors.forEach(add);
    network.partners?.forEach(add);
    for (const id of await this.usersService.findOperationalSupportShopIds(hub)) {
      ids.add(id);
    }

    const orders = await this.orderModel
      .find({
        user: { $in: Array.from(ids).map((id) => new Types.ObjectId(id)) },
        status: {
          $in: [OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.DELIVERED],
        },
        createdAt: { $gte: HUB_PRODUCT_COMMISSION_FROM },
      } as any)
      .populate('user', 'role')
      .select(
        'status items orderNumber totalAmount originalAmount baseCurrencyAmount shippingFee vatAmount shippedAt updatedAt user',
      )
      .lean()
      .exec();

    const hubId = String(hub._id);
    return orders.filter((order: any) => {
      const placer = order.user as { _id?: unknown; role?: string } | null;
      if (!placer) return false;
      if (String(placer._id) === hubId) return true;
      return canViewerSeeOrderPlacerRole(hub.role, placer.role);
    }) as HubCommissionOrder[];
  }

  async getSummary(hub: UserDocument): Promise<HubProductCommissionSummary> {
    this.assertEligible(hub);
    const [orders, withdrawals] = await Promise.all([
      this.getCommissionOrders(hub),
      this.withdrawalModel
        .find({ userId: hub._id, source: HUB_PRODUCT_COMMISSION_SOURCE })
        .select('status requestedAmount')
        .lean(),
    ]);

    const totals = summarizeHubProductCommission(
      orders,
      new Date(),
      getCommissionHoldMs(),
    );
    let inRequest = 0;
    let paidOut = 0;
    for (const w of withdrawals) {
      const amount = Number(w.requestedAmount) || 0;
      if (w.status === WithdrawalStatus.COMPLETED) {
        paidOut = roundMoney(paidOut + amount);
      } else if (ACTIVE_WITHDRAWAL_STATUSES.includes(w.status)) {
        inRequest = roundMoney(inRequest + amount);
      }
    }

    return {
      eligible: true,
      currency: 'USD',
      ratePercent: HUB_PRODUCT_COMMISSION_RATE * 100,
      from: HUB_PRODUCT_COMMISSION_FROM.toISOString().slice(0, 10),
      earned: totals.earned,
      available: Math.max(0, roundMoney(totals.released - inRequest - paidOut)),
      onHold: totals.onHold,
      awaitingShipment: totals.awaitingShipment,
      inRequest,
      paidOut,
    };
  }
}
