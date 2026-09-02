import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { Order, OrderDocument, OrderStatus } from '../../orders/entities/order.entity';
import {
  OrderCommissionTransfer,
  OrderCommissionTransferDocument,
  OrderCommissionTransferStatus,
} from '../entities/order-commission-transfer.entity';
import {
  StripeWisePayout,
  StripeWisePayoutDocument,
} from '../entities/stripe-wise-payout.entity';
import {
  buildOrderCommissionIdempotencyKey,
  extractCommissionLines,
  isRetryableTransferStatus,
  mapStripePayoutToTransferStatus,
  sumCommissionLines,
  summarizeCommissionTypes,
  transferStatusLabel,
} from '../order-commission-transfer.logic';
import { resolveShopOrderStripeAccountKey, resolveStripeApiVersion } from '../stripe-wise-payouts.logic';
import { User, UserDocument, UserRole } from '../../users/entities/user.entity';
import { SYSTEM_BASE_CURRENCY } from '../../common/order-monetary';
import { isRegistrationOrder } from '../../common/order-totals';
import {
  isStripeAccountKey,
  normalizeCurrency,
  StripeAccountKey,
} from '../stripe-wise-payouts.logic';
import { StripeWisePayoutsService } from './stripe-wise-payouts.service';

const USA_COUNTRIES = new Set([
  'united states',
  'usa',
  'us',
  'united states of america',
]);

@Injectable()
export class OrderCommissionTransferService implements OnModuleInit {
  private readonly logger = new Logger(OrderCommissionTransferService.name);
  private processing = false;
  private syncing = false;
  private stripe?: Stripe;
  private usaStripe?: Stripe;
  private europeStripe?: Stripe;
  private systemAdminId?: Types.ObjectId;

  constructor(
    @InjectModel(OrderCommissionTransfer.name)
    private readonly transferModel: Model<OrderCommissionTransferDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(StripeWisePayout.name)
    private readonly payoutModel: Model<StripeWisePayoutDocument>,
    private readonly config: ConfigService,
    private readonly stripeWisePayouts: StripeWisePayoutsService,
  ) {
    const stripeSecretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    const usaStripeSecretKey = this.config.get<string>('USA_STRIPE_SECRET_KEY');
    const europeStripeSecretKey = this.config.get<string>('EUROPE_STRIPE_SECRET_KEY');
    const getEnv = (key: string) => this.config.get<string>(key);
    if (stripeSecretKey) {
      this.stripe = new Stripe(stripeSecretKey, {
        apiVersion: resolveStripeApiVersion('global', getEnv) as Stripe.LatestApiVersion,
      });
    }
    if (usaStripeSecretKey) {
      this.usaStripe = new Stripe(usaStripeSecretKey, {
        apiVersion: resolveStripeApiVersion('usa', getEnv) as Stripe.LatestApiVersion,
      });
    }
    if (europeStripeSecretKey) {
      this.europeStripe = new Stripe(europeStripeSecretKey, {
        apiVersion: resolveStripeApiVersion('europe', getEnv) as Stripe.LatestApiVersion,
      });
    }
  }

  async onModuleInit(): Promise<void> {
    await this.resolveSystemAdminId();
    void this.processPendingTransfers();
  }

  private async resolveSystemAdminId(): Promise<void> {
    const configured = this.config.get<string>('AUTO_COMMISSION_ADMIN_USER_ID');
    if (configured && Types.ObjectId.isValid(configured)) {
      this.systemAdminId = new Types.ObjectId(configured);
      return;
    }
    const admin = await this.userModel
      .findOne({ role: UserRole.ADMIN })
      .select('_id')
      .lean()
      .exec();
    if (admin?._id) {
      this.systemAdminId = new Types.ObjectId(String(admin._id));
    }
  }

  isAutoTransferEnabled(): boolean {
    const raw = this.config.get<string>('AUTO_COMMISSION_STRIPE_TO_WISE');
    if (raw == null || raw === '') return true;
    return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
  }

  async enqueueFromPaidOrder(
    orderId: string,
    context?: {
      stripeAccountKey?: StripeAccountKey;
      stripePaymentId?: string;
    },
  ): Promise<OrderCommissionTransferDocument | null> {
    const order = await this.orderModel.findById(orderId).exec();
    if (!order) return null;
    if (order.status !== OrderStatus.PAID) {
      this.logger.debug(
        `Order ${order.orderNumber} is not PAID (${order.status}); skipping commission transfer.`,
      );
      return null;
    }
    if (isRegistrationOrder(order)) return null;
    if (!order.stripeSessionId) {
      this.logger.debug(
        `Order ${order.orderNumber} has no Stripe session; skipping commission transfer.`,
      );
      return null;
    }

    const commissionLines = extractCommissionLines(order.commissions);
    const commissionAmount = sumCommissionLines(commissionLines);
    if (commissionAmount <= 0) {
      this.logger.debug(
        `Order ${order.orderNumber} has no commission to transfer; skipping.`,
      );
      return null;
    }

    const stripeAccountKey =
      context?.stripeAccountKey ||
      (await this.resolveStripeAccountKey(order));
    const stripePaymentId =
      context?.stripePaymentId ||
      (await this.resolveStripePaymentId(order, stripeAccountKey));

    const idempotencyKey = buildOrderCommissionIdempotencyKey(orderId);
    const transferCurrency = SYSTEM_BASE_CURRENCY;
    const existing = await this.transferModel
      .findOne({ orderId: new Types.ObjectId(orderId) })
      .exec();
    if (existing) {
      if (
        !existing.stripePaymentId &&
        stripePaymentId &&
        existing.status === 'pending'
      ) {
        existing.stripePaymentId = stripePaymentId;
        await existing.save();
      }
      return existing;
    }

    const orderAmount = Number(order.totalAmount ?? 0);
    try {
      const created = await this.transferModel.create({
        orderId: new Types.ObjectId(orderId),
        orderNumber: order.orderNumber,
        orderAmount: Number.isFinite(orderAmount) ? orderAmount : 0,
        commissionAmount,
        commissionLines,
        commissionTypesSummary: summarizeCommissionTypes(commissionLines),
        currency: transferCurrency,
        orderCurrency: normalizeCurrency(order.currency) || transferCurrency,
        stripePaymentId,
        stripeAccountKey,
        status: 'pending',
        idempotencyKey,
        snapshot: {
          commissionLineCount: commissionLines.length,
          commissionTypes: summarizeCommissionTypes(commissionLines),
        },
      });
      this.logger.log(
        `Queued commission transfer for order ${order.orderNumber}: ${commissionAmount} ${created.currency}`,
      );
      if (this.isAutoTransferEnabled()) {
        void this.processTransfer(created).catch((err) =>
          this.logger.warn(
            `Immediate commission transfer attempt failed for ${order.orderNumber}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
      }
      return created;
    } catch (err: any) {
      if (err?.code === 11000) {
        return this.transferModel
          .findOne({ orderId: new Types.ObjectId(orderId) })
          .exec();
      }
      throw err;
    }
  }

  async listTransfers(params?: {
    page?: number;
    limit?: number;
    status?: OrderCommissionTransferStatus;
  }) {
    const page = Math.max(1, params?.page ?? 1);
    const limit = Math.min(100, Math.max(1, params?.limit ?? 30));
    const filter: Record<string, unknown> = {};
    if (params?.status) filter.status = params.status;

    const [items, total] = await Promise.all([
      this.transferModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.transferModel.countDocuments(filter).exec(),
    ]);

    return {
      items: items.map((item) => this.toPublicTransfer(item)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      autoTransferEnabled: this.isAutoTransferEnabled(),
    };
  }

  async getTransfer(id: string) {
    const item = await this.transferModel.findById(id).exec();
    if (!item) {
      throw new BadRequestException('Commission transfer not found.');
    }
    await this.syncTransferFromPayout(item);
    return this.toPublicTransfer(item);
  }

  async retryTransfer(id: string) {
    const item = await this.transferModel.findById(id).exec();
    if (!item) {
      throw new BadRequestException('Commission transfer not found.');
    }
    if (!isRetryableTransferStatus(item.status)) {
      throw new BadRequestException(
        `Transfer is ${transferStatusLabel(item.status)} and cannot be retried.`,
      );
    }
    item.retryCount = (item.retryCount || 0) + 1;
    item.idempotencyKey = buildOrderCommissionIdempotencyKey(
      String(item.orderId),
      item.retryCount,
    );
    item.status = 'pending';
    item.errorReason = undefined;
    await item.save();
    await this.processTransfer(item);
    return this.toPublicTransfer(item);
  }

  @Cron('*/2 * * * *')
  async processPendingTransfers(): Promise<void> {
    if (!this.isAutoTransferEnabled()) return;
    if (this.processing) return;
    this.processing = true;
    try {
      const pending = await this.transferModel
        .find({ status: 'pending' })
        .sort({ createdAt: 1 })
        .limit(25)
        .exec();
      for (const item of pending) {
        try {
          await this.processTransfer(item);
        } catch (err) {
          this.logger.warn(
            `Commission transfer cron failed for ${item.orderNumber}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } finally {
      this.processing = false;
    }
  }

  @Cron('*/2 * * * *')
  async syncOpenTransfers(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const open = await this.transferModel
        .find({ status: 'processing' })
        .sort({ updatedAt: 1 })
        .limit(50)
        .exec();
      for (const item of open) {
        try {
          await this.syncTransferFromPayout(item);
        } catch (err) {
          this.logger.warn(
            `Commission transfer sync failed for ${item.orderNumber}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  private async processTransfer(
    transfer: OrderCommissionTransferDocument,
  ): Promise<void> {
    if (!this.isAutoTransferEnabled()) return;
    if (!['pending', 'failed'].includes(transfer.status)) return;

    if (!this.systemAdminId) {
      await this.resolveSystemAdminId();
    }
    if (!this.systemAdminId) {
      transfer.errorReason =
        'No admin user configured for automated Stripe→Wise transfers.';
      await transfer.save();
      return;
    }

    if (transfer.stripeWisePayoutId && transfer.retryCount === 0) {
      await this.syncTransferFromPayout(transfer);
      if (transfer.status === 'processing' || transfer.status === 'completed') {
        return;
      }
      if (transfer.status === 'failed') {
        return;
      }
    }

    const payoutIdempotencyKey =
      transfer.retryCount > 0
        ? buildOrderCommissionIdempotencyKey(
            String(transfer.orderId),
            transfer.retryCount,
          )
        : transfer.idempotencyKey;

    if (transfer.commissionAmount <= 0) {
      transfer.errorReason = 'No commission amount to transfer.';
      await transfer.save();
      return;
    }

    try {
      const payout = await this.stripeWisePayouts.createAutomatedPayout({
        adminId: String(this.systemAdminId),
        amount: transfer.commissionAmount,
        currency: transfer.currency,
        stripeAccountKey: transfer.stripeAccountKey,
        idempotencyKey: payoutIdempotencyKey,
        metadata: {
          skygloss_kind: 'order_commission',
          skygloss_order_id: String(transfer.orderId),
          skygloss_order_number: transfer.orderNumber,
          skygloss_transfer_id: String(transfer._id),
        },
      });

      transfer.stripeWisePayoutId = new Types.ObjectId(String(payout.id));
      transfer.stripePayoutId = payout.stripePayoutId ?? undefined;
      transfer.stripeOutboundPaymentId = payout.stripeOutboundPaymentId ?? undefined;
      transfer.wiseTransferId = payout.wiseTransactionId ?? undefined;
      transfer.status = mapStripePayoutToTransferStatus(
        payout.status,
        payout.wiseStatus,
      );
      if (transfer.status === 'completed') {
        transfer.transferDate = payout.wiseMatchedAt
          ? new Date(payout.wiseMatchedAt)
          : new Date();
      }
      transfer.errorReason =
        transfer.status === 'failed'
          ? payout.failureMessage || 'Stripe→Wise transfer failed.'
          : undefined;
      await transfer.save();
    } catch (err) {
      const message =
        err instanceof BadRequestException
          ? String(err.message)
          : err instanceof Error
            ? err.message
            : 'Transfer failed.';
      const isBalanceIssue = /insufficient|exceeds.*balance/i.test(message);
      transfer.status = isBalanceIssue ? 'pending' : 'failed';
      transfer.errorReason = message;
      await transfer.save();
      if (!isBalanceIssue) {
        throw err;
      }
    }
  }

  private async syncTransferFromPayout(
    transfer: OrderCommissionTransferDocument,
  ): Promise<void> {
    if (!transfer.stripeWisePayoutId) return;
    const payout = await this.payoutModel
      .findById(transfer.stripeWisePayoutId)
      .exec();
    if (!payout) return;

    await this.stripeWisePayouts.refreshPayoutForAutomation(payout);

    transfer.stripePayoutId = payout.stripePayoutId;
    transfer.stripeOutboundPaymentId = payout.stripeOutboundPaymentId;
    transfer.wiseTransferId = payout.wiseTransactionId;
    transfer.status = mapStripePayoutToTransferStatus(
      payout.status,
      payout.wiseStatus,
    );
    if (transfer.status === 'completed') {
      transfer.transferDate =
        payout.wiseMatchedAt || payout.stripePaidAt || transfer.transferDate;
      transfer.errorReason = undefined;
    } else if (transfer.status === 'failed') {
      transfer.errorReason =
        payout.failureMessage || transfer.errorReason || 'Transfer failed.';
    } else {
      transfer.errorReason = undefined;
    }
    await transfer.save();
  }

  private async resolveStripeAccountKey(
    order: OrderDocument,
  ): Promise<StripeAccountKey> {
    const userId =
      typeof order.user === 'object' && order.user !== null && '_id' in order.user
        ? String((order.user as any)._id)
        : String(order.user);
    const user = await this.userModel.findById(userId).select('country').lean();
    return resolveShopOrderStripeAccountKey(
      order.shippingAddress?.country,
      user?.country,
    );
  }

  private stripeFor(key: StripeAccountKey): Stripe | undefined {
    if (key === 'usa') return this.usaStripe;
    if (key === 'europe') return this.europeStripe;
    return this.stripe;
  }

  private async resolveStripePaymentId(
    order: OrderDocument,
    stripeAccountKey: StripeAccountKey,
  ): Promise<string | undefined> {
    if (!order.stripeSessionId) return undefined;
    const stripe = this.stripeFor(stripeAccountKey);
    if (!stripe) return order.stripeSessionId;
    try {
      const session = await stripe.checkout.sessions.retrieve(
        order.stripeSessionId,
      );
      if (session.payment_intent) {
        return typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent.id;
      }
      return session.id;
    } catch (err) {
      this.logger.warn(
        `Could not resolve Stripe payment id for order ${order.orderNumber}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return order.stripeSessionId;
    }
  }

  private toPublicTransfer(item: OrderCommissionTransferDocument) {
    return {
      id: String(item._id),
      orderId: String(item.orderId),
      orderNumber: item.orderNumber,
      orderAmount: item.orderAmount,
      orderCurrency: item.orderCurrency || item.currency,
      commissionAmount: item.commissionAmount,
      wiseAmount: item.commissionAmount,
      commissionLines: item.commissionLines || [],
      commissionTypesSummary: item.commissionTypesSummary || '—',
      currency: item.currency,
      stripePaymentId: item.stripePaymentId,
      stripeAccountKey: item.stripeAccountKey,
      stripeWisePayoutId: item.stripeWisePayoutId
        ? String(item.stripeWisePayoutId)
        : undefined,
      stripePayoutId: item.stripePayoutId,
      stripeOutboundPaymentId: item.stripeOutboundPaymentId,
      wiseTransferId: item.wiseTransferId,
      status: item.status,
      statusLabel: transferStatusLabel(item.status),
      errorReason: item.errorReason,
      transferDate: item.transferDate,
      retryCount: item.retryCount || 0,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
