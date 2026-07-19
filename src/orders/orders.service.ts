import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from './entities/order.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationType } from '../notifications/entities/notification.entity';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { UserDocument, UserRole, UserStatus } from '../users/entities/user.entity';
import { normalizePartnerCode } from '../common/partner-code';
import { ProductGroup, ProductGroupDocument } from '../product-groups/entities/product-group.entity';
import { RegistrationFeesService } from '../registration-fees/registration-fees.service';
import { calculateShippingFee, getShippingRegion, SHIPPING_FEE_AMOUNT } from '../common/shipping-config';
import {
  getItemsSubtotal,
  isRegistrationOrder,
  registrationOrderExclusionFilter,
  shouldHideShopRegistrationFromViewer,
} from '../common/order-totals';
import {
  formatRoleLabel,
  getRegistrationFeeDescription,
  getRegistrationFeeName,
} from '../common/role-labels';
import { PdfService } from '../pdf/pdf.service';
import {
  calculateRepresentativeCommissionEntries,
  CommissionRecipient,
  normalizePartnerDevelopmentRatePercent,
  normalizeShopIntroductionFirstOrderRatePercent,
  resolveCommissionOrderAmounts,
  resolveCommissionRatePercent,
  resolveFirstOrderPoolSplit,
} from '../common/commission-distribution';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import {
  buildLockedMonetaryFields,
  recalculateBaseWithLockedRate,
  roundMoney,
  SALES_REPORT_STATUSES,
  SYSTEM_BASE_CURRENCY,
  EFFECTIVE_BASE_AMOUNT_EXPR,
  EFFECTIVE_ORIGINAL_AMOUNT_EXPR,
  EFFECTIVE_ORIGINAL_CURRENCY_EXPR,
} from '../common/order-monetary';
import {
  canViewerSeeOrderPlacerRole,
  filterCommissionsForViewerWithSplitContext,
  shouldIncludeViewerInNetworkOrders,
} from '../common/user-hierarchy';
import {
  formatRegistrationOrderNumber,
  formatShopOrderNumber,
  getNextRegistrationOrderSequence,
  getNextShopOrderSequenceForFlow,
  getShopOrderPrefix,
  type ShopOrderFlow,
} from '../common/order-number';
import { normalizeCurrencyCode } from '../common/currency-codes';
import { normalizeOrderItemType } from '../common/order-type';
import { CouponsService } from '../coupons/coupons.service';

const USA_COUNTRIES = ['united states', 'usa', 'us', 'united states of america'];
const PENDING_PAYMENT_CANCEL_DAYS = 3;
const PAYMENT_REMINDER_INTERVALS_MS = [
  24 * 60 * 60 * 1000,
  48 * 60 * 60 * 1000,
];

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);
  private stripe: Stripe;
  private usaStripe: Stripe;

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(ProductGroup.name) private productGroupModel: Model<ProductGroupDocument>,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
    private usersService: UsersService,
    private mailService: MailService,
    private registrationFeesService: RegistrationFeesService,
    @Inject(forwardRef(() => PdfService))
    private pdfService: PdfService,
    private exchangeRatesService: ExchangeRatesService,
    private couponsService: CouponsService,
  ) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    const usaStripeSecretKey = this.configService.get<string>('USA_STRIPE_SECRET_KEY');
    const stripeApiVersion =
      this.configService.get<string>('STRIPE_API_VERSION') || '2022-11-15';

    if (!stripeSecretKey) {
      console.warn('STRIPE_SECRET_KEY is not defined');
      this.stripe = undefined as any;
    } else {
      this.stripe = new Stripe(stripeSecretKey, {
        apiVersion: stripeApiVersion as Stripe.LatestApiVersion,
      });
    }

    if (!usaStripeSecretKey) {
      console.warn('USA_STRIPE_SECRET_KEY is not defined');
      this.usaStripe = undefined as any;
    } else {
      this.usaStripe = new Stripe(usaStripeSecretKey, {
        apiVersion: stripeApiVersion as Stripe.LatestApiVersion,
      });
    }
  }

  async onModuleInit() {
    await this.exchangeRatesService.refreshRatesFromMarket();
    await this.repairBrokenFxOrders();
  }

  /** Fix orders where FX rate was rounded to 0 or non-USD was treated as 1:1 USD. */
  private async repairBrokenFxOrders(): Promise<void> {
    const candidates = await this.orderModel
      .find({
        $or: [
          { exchangeRateAtOrderTime: 0 },
          {
            exchangeRateAtOrderTime: 1,
            $expr: {
              $ne: [
                { $toUpper: { $ifNull: ['$originalCurrency', '$currency'] } },
                'USD',
              ],
            },
          },
          {
            baseCurrencyAmount: 0,
            totalAmount: { $gt: 0 },
            $expr: {
              $ne: [
                { $toUpper: { $ifNull: ['$originalCurrency', '$currency'] } },
                'USD',
              ],
            },
          },
          {
            totalAmount: { $gt: 0 },
            currency: { $nin: ['USD', 'usd'] },
            $or: [
              { originalCurrency: { $exists: false } },
              { exchangeRateAtOrderTime: { $exists: false } },
              { baseCurrencyAmount: { $exists: false } },
            ],
          },
        ],
      })
      .limit(1000)
      .exec();

    let repaired = 0;
    for (const order of candidates) {
      const currency = (
        order.originalCurrency ||
        order.currency ||
        ''
      ).toUpperCase();
      if (!currency || currency === SYSTEM_BASE_CURRENCY) continue;

      const amount = order.originalAmount ?? order.totalAmount;
      if (!amount || amount <= 0) continue;

      try {
        const createdAt = (order as OrderDocument & { createdAt?: Date }).createdAt;
        const orderDate = createdAt ? new Date(createdAt) : new Date();
        const rate = await this.exchangeRatesService.getRateToBaseForDate(
          currency,
          orderDate,
        );
        if (rate <= 0) continue;

        const fields = buildLockedMonetaryFields(amount, currency, rate);
        if (
          order.exchangeRateAtOrderTime === fields.exchangeRateAtOrderTime &&
          order.baseCurrencyAmount === fields.baseCurrencyAmount
        ) {
          continue;
        }

        await this.orderModel.updateOne({ _id: order._id }, { $set: fields });
        repaired++;
      } catch (err) {
        this.logger.warn(
          `Could not repair FX fields for order ${order.orderNumber}:`,
          err,
        );
      }
    }

    if (repaired > 0) {
      this.logger.log(`Repaired FX fields on ${repaired} order(s)`);
    }
  }

  async getCurrencyForUser(user: any): Promise<string> {
    const userCountry = (user?.country || '').toLowerCase().trim();
    let orderCurrency = 'usd';

    if (user && user.productGroup) {
      const explicitGroup = await this.productGroupModel.findById(user.productGroup);
      if (explicitGroup && explicitGroup.currency) {
        orderCurrency = explicitGroup.currency.toLowerCase();
      }
    } else {
      const groups = await this.productGroupModel.find({ isActive: { $ne: false } }).exec();
      const countryMatch = groups.find(
        g => (Array.isArray(g.countries) && g.countries.map(c => c.toLowerCase()).includes(userCountry)) || 
             (g.country && g.country.toLowerCase() === userCountry)
      );
      
      if (countryMatch && countryMatch.currency) {
        orderCurrency = countryMatch.currency.toLowerCase();
      } else {
        const defaultGroup = groups.find(g => g.isDefault);
        if (defaultGroup && defaultGroup.currency) {
          orderCurrency = defaultGroup.currency.toLowerCase();
        }
      }
    }
    return normalizeCurrencyCode(orderCurrency);
  }

  private async buildMonetaryFieldsForNewOrder(
    totalAmount: number,
    currency: string,
  ) {
    // Lock today's DB rate at checkout — becomes the permanent order-date FX.
    const rate = await this.exchangeRatesService.getRateToBase(currency);
    return buildLockedMonetaryFields(totalAmount, currency, rate);
  }

  private buildAmountUpdateWithLockedRate(
    existingOrder: OrderDocument | null | undefined,
    newTotal: number,
  ) {
    if (
      existingOrder?.exchangeRateAtOrderTime != null &&
      existingOrder.exchangeRateAtOrderTime > 0
    ) {
      return recalculateBaseWithLockedRate(
        newTotal,
        existingOrder.exchangeRateAtOrderTime,
      );
    }
    return {
      totalAmount: newTotal,
      originalAmount: newTotal,
    };
  }

  private async computeSalesReport(matchFilter: Record<string, unknown> = {}) {
    const statusMatch = {
      status: { $in: [...SALES_REPORT_STATUSES] },
      ...matchFilter,
    };

    const [totalRevenueResult, currencyGroups, dailySales] = await Promise.all([
      this.orderModel.aggregate([
        { $match: statusMatch },
        { $group: { _id: null, total: { $sum: EFFECTIVE_BASE_AMOUNT_EXPR } } },
      ]),
      this.orderModel.aggregate([
        { $match: statusMatch },
        {
          $group: {
            _id: EFFECTIVE_ORIGINAL_CURRENCY_EXPR,
            orderCount: { $sum: 1 },
            originalTotal: { $sum: EFFECTIVE_ORIGINAL_AMOUNT_EXPR },
            baseTotal: { $sum: EFFECTIVE_BASE_AMOUNT_EXPR },
          },
        },
      ]),
      this.orderModel.aggregate([
        {
          $match: {
            ...statusMatch,
            createdAt: {
              $gte: (() => {
                const d = new Date();
                d.setDate(d.getDate() - 7);
                d.setHours(0, 0, 0, 0);
                return d;
              })(),
            },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            sales: { $sum: EFFECTIVE_BASE_AMOUNT_EXPR },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const totalRevenue = totalRevenueResult[0]?.total || 0;

    const currencyBreakdown = currencyGroups
      .filter((group) => group.orderCount > 0 && group._id)
      .map((group) => ({
        currency: String(group._id).toUpperCase(),
        orderCount: group.orderCount,
        originalTotal: group.originalTotal,
        baseTotal: group.baseTotal,
      }))
      .sort(
        (a, b) =>
          b.originalTotal - a.originalTotal ||
          a.currency.localeCompare(b.currency),
      );

    const chartData: { date: string; sales: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const found = dailySales.find((day) => day._id === dateStr);
      chartData.push({
        date: dateStr,
        sales: found ? found.sales : 0,
      });
    }

    return {
      totalRevenue,
      baseCurrency: SYSTEM_BASE_CURRENCY,
      currencyBreakdown,
      chartData,
    };
  }

  async createDistributorFeeCheckoutSession(userId: string, email: string, additionalMetadata: any = {}) {
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured on the server.');
    }

    let baseUrl = (this.configService.get<string>('FRONTEND_URL') || '').replace(/\/+$/, '');
    if (process.env.NODE_ENV === 'production' || !baseUrl) {
      baseUrl = 'https://portal.skygloss.com';
    }

    const type = additionalMetadata.type || 'partner_registration';
    const country = additionalMetadata.country || '';
    const success_path =
      additionalMetadata.successPath ||
      (type === 'shop_registration' ? '/login/shop?payment_success=true' : '/login/partner?payment_success=true');
    const cancel_path =
      additionalMetadata.cancelPath ||
      (type === 'shop_registration' ? '/register/shop?payment_canceled=true' : '/register/partner?payment_canceled=true');

    // PRICING LOGIC
    let currency = 'usd';
    let unit_amount = 25000; // Default $250.00 USD
    let tax_amount = 0;

    const feeGroup = await this.registrationFeesService.findByCountry(country);
    if (feeGroup) {
      currency = feeGroup.currency.toLowerCase();
      unit_amount = Math.round(feeGroup.feeAmount * 100);
      tax_amount = Math.round((feeGroup.taxAmount || 0) * 100);
    }

    const totalBeforeDiscount = unit_amount + tax_amount;
    const registrationDiscountCents = additionalMetadata.registrationDiscount
      ? Math.round(Number(additionalMetadata.registrationDiscount) * 100)
      : 0;
    const finalAmountCents =
      additionalMetadata.finalAmount != null
        ? Math.round(Number(additionalMetadata.finalAmount) * 100)
        : Math.max(0, totalBeforeDiscount - registrationDiscountCents);

    if (finalAmountCents < totalBeforeDiscount && finalAmountCents >= 0) {
      unit_amount = finalAmountCents;
      tax_amount = 0;
    }

    const user = await this.usersService.findOne(userId);
    const feeName = user
      ? getRegistrationFeeName(user.role)
      : type === 'shop_registration'
        ? 'Shop Registration Fee'
        : 'Hub Registration Fee';
    const feeDescription = user
      ? getRegistrationFeeDescription(user.role)
      : type === 'shop_registration'
        ? 'One-time fee to activate your SkyGloss Shop account.'
        : 'One-time fee to activate your SkyGloss Hub account.';

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency,
          product_data: {
            name: feeName,
            description: feeDescription,
          },
          unit_amount,
        },
        quantity: 1,
      },
    ];

    if (tax_amount > 0) {
      line_items.push({
        price_data: {
          currency,
          product_data: {
            name: 'Tax',
          },
          unit_amount: tax_amount,
        },
        quantity: 1,
      });
    }

    try {
      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        allow_promotion_codes: true,
        line_items,
        mode: 'payment',
        success_url: `${baseUrl}${success_path}&user_id=${userId}`,
        cancel_url: `${baseUrl}${cancel_path}&user_id=${userId}`,
        client_reference_id: userId,
        customer_email: email,
        metadata: {
          type,
          userId: userId,
          ...additionalMetadata,
        },
      });

      // Save session ID to user for verification fallback
      await this.usersService.update(userId, { stripeSessionId: session.id } as any, { role: UserRole.ADMIN } as any);

      return { url: session.url, id: session.id };
    } catch (error) {
      console.error('Stripe session creation error:', error);
      throw new BadRequestException(
        `Stripe session creation failed: ${error.message}`,
      );
    }
  }

  async createCheckoutSession(
    userId: string,
    createOrderDto: CreateOrderDto,
    role?: string,
  ) {
    // Fetch the logged-in user's country from database
    const currentUser = await this.usersService.findOne(userId);
    const userCountry = (currentUser?.country || '').toLowerCase().trim();
    const isUsaUser = this.isUsaCountry(userCountry);

    // Route to appropriate Stripe based on user's country
    const stripeInstance = this.getStripeForUsaUser(isUsaUser);

    if (!stripeInstance) {
      throw new BadRequestException('Stripe is not configured on the server.');
    }
    console.log(`[Stripe] Using ${isUsaUser ? 'USA' : 'Global'} Stripe for user country: "${currentUser?.country}"`);

    // DETERMINE CURRENCY
    const orderCurrency = await this.getCurrencyForUser(currentUser);

    const { items: rawItems, shippingAddress, couponCode } = createOrderDto;
    const items = rawItems.map((item) => ({
      ...item,
      orderType: normalizeOrderItemType(item.orderType),
    }));

    // Calculate total amount from items
    // Note: In a real app, we should fetch product prices from DB to secure against client-side manipulation.
    // For this implementation, we'll use the prices sent from frontend but ensure strict types.
    const itemsSubtotal = getItemsSubtotal(items);
    const shippingCountry =
      shippingAddress?.country || currentUser?.country || '';
    const shippingFee = calculateShippingFee(shippingCountry, itemsSubtotal);

    let discount = 0;
    let appliedCouponCode: string | undefined;
    if (couponCode?.trim()) {
      const validation = await this.couponsService.validateForCheckout(
        couponCode,
        itemsSubtotal,
      );
      discount = validation.discountAmount;
      appliedCouponCode = validation.code;
    }

    const orderTotal = Math.max(0, itemsSubtotal + shippingFee - discount);

    let order: any;
    let retries = 3;
    while (retries > 0) {
      try {
        const orderNumber = await this.generateShopOrderNumber(
          shippingCountry,
          'purchase',
        );
        const monetary = await this.buildMonetaryFieldsForNewOrder(
          orderTotal,
          orderCurrency,
        );
        order = new this.orderModel({
          user: userId,
          items,
          shippingFee,
          shippingAddress,
          status: isUsaUser ? OrderStatus.PENDING_PAYMENT : OrderStatus.PENDING,
          orderNumber,
          orderFlow: 'purchase',
          paymentReminderCount: 0,
          discount,
          couponCode: appliedCouponCode,
          ...monetary,
        });
        await order.save();
        break;
      } catch (saveError: any) {
        if (saveError.code === 11000 && retries > 1) {
          retries--;
          continue;
        }
        console.error('Order save error:', saveError);
        throw new BadRequestException(
          `Failed to create order: ${saveError.message}`,
        );
      }
    }

    // Non-USA checkout starts as PENDING — show commission as pending immediately.
    if (order?.status === OrderStatus.PENDING) {
      await this.applyOrderCommissions(
        order._id.toString(),
        OrderStatus.PENDING,
      );
    }

    try {
      const session = await this.createStripeCheckoutForOrder(
        order,
        currentUser,
        role,
        stripeInstance,
        orderCurrency,
      );

      if (isUsaUser) {
        const payUrl = this.getOrderPayUrl(order._id.toString(), currentUser?.role || role);
        await this.mailService
          .sendPendingPaymentReminder(order, currentUser, payUrl, false)
          .catch((err) =>
            console.error('Failed to send initial pending payment email', err),
          );
      }

      if (!session.url) {
        throw new BadRequestException('Failed to create Stripe checkout session.');
      }

      return { url: session.url };
    } catch (error) {
      console.error('Stripe session creation error:', error);
      throw new BadRequestException(
        `Stripe session creation failed: ${error.message}`,
      );
    }
  }

  async getMyOrders(userId: string): Promise<Order[]> {
    return this.orderModel
      .find({ user: userId as any })
      .sort({ createdAt: -1 });
  }

  async getOrderById(id: string, viewer?: UserDocument): Promise<Order> {
    const order = await this.orderModel
      .findById(id)
      .populate('user', 'firstName lastName email role country shopName')
      .lean();
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!viewer) {
      return order;
    }

    const orderUserId = String((order as any).user?._id || (order as any).user);

    if (viewer.role === UserRole.ADMIN) {
      return order;
    }

    if (orderUserId === viewer._id.toString()) {
      return order;
    }

    const networkRoles = [
      UserRole.PARTNER,
      UserRole.DISTRIBUTOR,
      UserRole.MASTER_PARTNER,
      UserRole.REGIONAL_PARTNER,
      // UserRole.SUB_PROMOTER, // removed
    ];
    if (networkRoles.includes(viewer.role as UserRole)) {
      if (shouldHideShopRegistrationFromViewer(order as any, viewer)) {
        throw new ForbiddenException(
          'Shop registration invoices are not available to partners',
        );
      }

      const inNetwork = await this.usersService.isUserInViewerNetwork(
        viewer,
        orderUserId,
      );
      if (inNetwork) {
        return order;
      }
    }

    throw new ForbiddenException('You do not have access to this order');
  }

  async createPaymentSessionForOrder(
    orderId: string,
    userId: string,
    role?: string,
  ): Promise<{ url: string }> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (String(order.user) !== String(userId)) {
      throw new ForbiddenException('You do not have access to this order');
    }

    const payableStatuses = [OrderStatus.PENDING_PAYMENT, OrderStatus.PENDING];
    if (!payableStatuses.includes(order.status)) {
      throw new BadRequestException(
        'This order is not awaiting payment.',
      );
    }

    const currentUser = await this.usersService.findOne(userId);
    const userCountry = (currentUser?.country || '').toLowerCase().trim();
    if (!this.isUsaCountry(userCountry)) {
      throw new BadRequestException(
        'Online payment is only available for USA orders.',
      );
    }

    const stripeInstance = this.getStripeForUsaUser(true);
    const orderCurrency = (order.currency || 'USD').toLowerCase();

    const session = await this.createStripeCheckoutForOrder(
      order,
      currentUser,
      role,
      stripeInstance,
      orderCurrency,
    );

    if (!session.url) {
      throw new BadRequestException('Failed to create Stripe checkout session.');
    }

    return { url: session.url };
  }

  async cancelExpiredPendingPaymentOrders(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PENDING_PAYMENT_CANCEL_DAYS);

    const expiredOrders = await this.orderModel
      .find({
        status: OrderStatus.PENDING_PAYMENT,
        createdAt: { $lte: cutoff },
      })
      .populate('user', 'firstName lastName email country role');

    let cancelled = 0;
    for (const order of expiredOrders) {
      const reason =
        'Payment was not completed within 3 days. The order was automatically cancelled.';
      order.status = OrderStatus.CANCELLED;
      order.cancellationReason = reason;
      await order.save();

      if (order.user) {
        await this.mailService
          .sendOrderCancelledCustomerNotification(order, order.user, {
            wasPaid: false,
            cancellationReason: reason,
          })
          .catch((err) =>
            console.error('Failed to send auto-cancel email to customer', err),
          );
      }
      cancelled++;
    }
    return cancelled;
  }

  async sendPendingPaymentReminders(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PENDING_PAYMENT_CANCEL_DAYS);

    const pendingOrders = await this.orderModel
      .find({
        status: OrderStatus.PENDING_PAYMENT,
        createdAt: { $gt: cutoff },
      })
      .populate('user', 'firstName lastName email role country');

    let sent = 0;
    const now = Date.now();

    for (const order of pendingOrders) {
      const reminderIndex = order.paymentReminderCount ?? 0;
      if (reminderIndex >= PAYMENT_REMINDER_INTERVALS_MS.length) {
        continue;
      }

      const ageMs = now - new Date((order as any).createdAt).getTime();
      if (ageMs < PAYMENT_REMINDER_INTERVALS_MS[reminderIndex]) {
        continue;
      }

      const user = order.user as any;
      if (!user?.email) continue;

      const payUrl = this.getOrderPayUrl(
        order._id.toString(),
        user?.role,
      );
      await this.mailService
        .sendPendingPaymentReminder(order, user, payUrl, true)
        .catch((err) =>
          console.error(
            `Failed to send payment reminder for ${order.orderNumber}`,
            err,
          ),
        );

      order.paymentReminderCount = reminderIndex + 1;
      await order.save();
      sent++;
    }

    return sent;
  }

  // Webhook handler will reuse logic or be separate.
  // For now, let's implement a verify endpoint for manual success check if webhook fails/delays
  async verifyPayment(orderId: string): Promise<Order> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    if (!order.stripeSessionId) return order;

    // Determine which Stripe to use based on the order's user country
    const orderUser = await this.usersService.findOne(String((order as any).user));
    const userCountry = (orderUser?.country || '').toLowerCase().trim();
    const isUsaUser = ['united states', 'usa', 'us', 'united states of america'].includes(userCountry);
    const stripeInstance = isUsaUser && this.usaStripe ? this.usaStripe : this.stripe;

    const session = await stripeInstance.checkout.sessions.retrieve(
      order.stripeSessionId,
    );
    if (session.payment_status === 'paid') {
      if (
        order.status !== OrderStatus.PAID &&
        [OrderStatus.PENDING_PAYMENT, OrderStatus.PENDING, OrderStatus.FAILED].includes(
          order.status,
        )
      ) {
        order.status = OrderStatus.PAID;
        order.cancellationReason = undefined;
        await order.save();

        const populatedOrder = await this.orderModel
          .findById(order._id)
          .populate('user', 'firstName lastName email');

        if (populatedOrder) {
          // Send notification
          try {
            const notification = await this.notificationsService.create({
              type: NotificationType.ORDER_PAID,
              title: 'Order Paid',
              message: `Order ${populatedOrder.orderNumber} has been paid by ${populatedOrder.user ? (populatedOrder.user as any).firstName : 'a user'}.`,
              metadata: {
                orderId: populatedOrder._id,
                orderNumber: populatedOrder.orderNumber,
              },
              user: (populatedOrder.user as any)?._id,
              triggeredBy: (populatedOrder.user as any)?._id,
              link: `/orders/${populatedOrder._id}`,
            });
            this.notificationsGateway.broadcastNotification(notification);
          } catch (notifErr) {
            console.error('Failed to create/broadcast notification for verified order:', notifErr);
          }

          // Send Email to sales@skygloss.com
          await this.mailService.sendNewOrderNotification(populatedOrder, populatedOrder.user).catch(err => {
            console.error('Failed to send order email to sales (verifyPayment)', err);
          });

          // Send Confirmation Email to the Customer
          await this.mailService.sendOrderPaidCustomerConfirmation(populatedOrder, populatedOrder.user).catch(err => {
            console.error('Failed to send order paid confirmation email to customer (verifyPayment)', err);
          });

          return populatedOrder;
        }
      }
    }
    return order;
  }

  async createRegistrationOrder(
    user: any,
    stripeSessionOrId?: any,
    couponOptions?: { couponCode?: string; discount?: number },
  ): Promise<Order> {
    // Check if registration order already exists for this user to avoid duplicates
    const existingOrder = await this.orderModel.findOne({
      user: user._id,
      'items.product': 'registration_fee',
    });
    if (existingOrder) {
      console.log(`[Registration Order] Found existing registration order: ${existingOrder.orderNumber}`);
      return existingOrder as any;
    }

    // Determine the registration fee and tax for user's country
    let currency = 'USD';
    let feeAmount = 250;
    let taxAmount = 0;

    try {
      const feeGroup = await this.registrationFeesService.findByCountry(user.country || '');
      if (feeGroup) {
        currency = (feeGroup.currency || 'USD').toUpperCase();
        feeAmount = feeGroup.feeAmount;
        taxAmount = feeGroup.taxAmount || 0;
      }
    } catch (err) {
      console.error('[Registration Order] Failed to fetch fee group:', err);
    }

    const subtotal = feeAmount + taxAmount;
    const couponDiscount = couponOptions?.discount ?? 0;
    const isCouponBypass = couponDiscount >= subtotal && subtotal > 0;
    let discount = isCouponBypass ? subtotal : Math.min(couponDiscount, subtotal);
    let totalAmount = Math.max(0, subtotal - discount);
    let couponCode = couponOptions?.couponCode;
    let stripeSessionId: string | undefined = undefined;

    if (stripeSessionOrId) {
      if (typeof stripeSessionOrId === 'string') {
        stripeSessionId = stripeSessionOrId;
        if (this.stripe) {
          try {
            const isUsa = user.country?.toLowerCase() === 'united states' || user.country?.toLowerCase() === 'usa';
            const stripeInstance = this.getStripeForUsaUser(isUsa) || this.stripe;
            const session = await stripeInstance.checkout.sessions.retrieve(stripeSessionId);
            if (session) {
              totalAmount = (session.amount_total || 0) / 100;
              discount = (session.total_details?.amount_discount || 0) / 100;
              if (discount > 0.01) {
                couponCode = 'STRIPECOUPON';
              }
            }
          } catch (stripeErr) {
            console.error('[Registration Order] Failed to retrieve stripe session details:', stripeErr);
          }
        }
      } else {
        stripeSessionId = stripeSessionOrId.id;
        totalAmount = (stripeSessionOrId.amount_total || 0) / 100;
        discount = (stripeSessionOrId.total_details?.amount_discount || 0) / 100;
        if (discount > 0.01) {
          couponCode = 'STRIPECOUPON';
        }
      }
    }

    // Prefill shippingAddress using user's details
    const shippingAddress = {
      email: user.email || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      companyName: user.companyName || '',
      address: user.address || 'N/A',
      address2: '',
      city: user.city || 'N/A',
      state: user.state || 'N/A',
      zipCode: user.zipCode || 'N/A',
      country: user.country || 'N/A',
      phoneNumber: user.phoneNumber || 'N/A',
    };

    const orderNumber = await this.generateRegistrationOrderNumber();
    const monetary = await this.buildMonetaryFieldsForNewOrder(totalAmount, currency);

    const order = new this.orderModel({
      user: user._id,
      items: [
        {
          product: 'registration_fee',
          name: getRegistrationFeeName(user.role),
          size: 'N/A',
          quantity: 1,
          price: subtotal,
        }
      ],
      discount,
      couponCode,
      shippingAddress,
      status: OrderStatus.PAID,
      orderNumber,
      stripeSessionId,
      ...monetary,
    });

    console.log(`[Registration Order] Creating registration order ${orderNumber} for user ${user._id}`);
    return await order.save();
  }

  async generateInvoicePdf(order: any): Promise<Buffer> {
    return this.pdfService.generateOrderDetails(order);
  }

  async verifyRegistrationPayment(userId: string): Promise<any> {
    const user = await this.usersService.findOne(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.isPartnerPaid) return { status: 'already_paid', user };

    if (!user.stripeSessionId) {
      throw new BadRequestException('No registration payment session found for this user.');
    }

    const session = await this.stripe.checkout.sessions.retrieve(user.stripeSessionId);

    if (session.payment_status === 'paid') {
      console.log(`[Manual Verify] Payment confirmed for user ${userId}. Activating...`);

      const updatedUser = await this.usersService.update(userId, {
        isPartnerPaid: true,
        status: UserStatus.ACTIVE,
      } as any, { role: UserRole.ADMIN } as any);

      // Trigger Notifications (Same logic as webhook)
      if (updatedUser) {
        // Create paid registration order
        let invoiceBuffer: Buffer | undefined;
        let orderNumber: string | undefined;
        try {
          const regOrder = await this.createRegistrationOrder(
            updatedUser,
            session,
            updatedUser.couponCode
              ? { couponCode: updatedUser.couponCode }
              : undefined,
          );
          invoiceBuffer = await this.generateInvoicePdf(regOrder);
          orderNumber = regOrder.orderNumber;
        } catch (orderErr) {
          console.error('[Manual Verify] Failed to create registration order:', orderErr);
        }

        // 1. Notify Admin
        // Admin notification is now handled internally by MailService for sales@skygloss.com
        await this.mailService.sendDistributorPaymentCompletedAdminNotification(
          [],
          updatedUser,
        );

        // 2. Notify User
        if (updatedUser.email) {
          const partnerContact = await this.usersService.getPartnerContactForShop(updatedUser);
          await this.mailService.sendDistributorPaymentConfirmation(
            updatedUser.email,
            updatedUser,
            invoiceBuffer,
            orderNumber,
            partnerContact,
          );
        }

        // 3. Notify Referring Partner
        const metadata: any = session.metadata || {};
        const partnerCode = metadata.referredByPartnerCode || updatedUser.referredByPartnerCode;

        if (partnerCode) {
          const partner = await (this.usersService as any).userModel.findOne({ partnerCode });
          if (partner) {
            const partnerNotification = await this.notificationsService.create({
              type: NotificationType.ORDER_PAID,
              title: 'New Shop Referral Active (Verified)',
              message: `Shop "${updatedUser.firstName} ${updatedUser.lastName}" has completed registration and is now part of your network.`,
              metadata: { shopId: updatedUser._id, shopName: `${updatedUser.firstName} ${updatedUser.lastName}` },
              user: partner._id,
              triggeredBy: userId,
              link: `/dashboard/partner/network`,
            });
            this.notificationsGateway.broadcastNotification(partnerNotification);
          }
        }

        return { status: 'success', user: updatedUser };
      }
    }

    return { status: 'pending', user };
  }

  async handleUsaWebhook(sig: string, payload: Buffer) {
    const endpointSecret = this.configService.get<string>('USA_STRIPE_WEBHOOK_SECRET');
    if (!endpointSecret)
      throw new BadRequestException('USA Webhook secret not configured');

    if (!this.usaStripe)
      throw new BadRequestException('USA Stripe is not configured on the server.');

    let event: Stripe.Event;
    try {
      event = this.usaStripe.webhooks.constructEvent(payload, sig, endpointSecret);
    } catch (err) {
      console.error(`[USA Stripe Webhook] Verification Failed: ${err.message}`);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    const session = event.data.object as Stripe.Checkout.Session;
    console.log(`[USA Stripe Webhook] Received event: ${event.type}`);
    const metadata = session.metadata;

    if (event.type === 'checkout.session.completed' && metadata?.type === 'shop_order') {
      const orderId = metadata.orderId;
      console.log(`[USA Stripe Webhook] Processing shop_order for orderId: ${orderId}`);

      if (!orderId) {
        console.error('[USA Stripe Webhook] No orderId found in metadata.');
        return { received: true };
      }

      const existingOrder = await this.orderModel.findById(orderId);
      if (existingOrder && existingOrder.status === OrderStatus.PAID) {
        console.log(`[USA Stripe Webhook] Order ${existingOrder.orderNumber} is already PAID. Skipping duplicate notifications/emails.`);
        return { received: true };
      }

      const actualTotal = (session.amount_total || 0) / 100;
      const stripeDiscount = (session.total_details?.amount_discount || 0) / 100;
      let discount = existingOrder?.discount ?? 0;
      let couponCode = existingOrder?.couponCode;
      if (stripeDiscount > 0.01 && !couponCode) {
        couponCode = 'STRIPECOUPON';
        discount = stripeDiscount;
      }

      const amountUpdate = this.buildAmountUpdateWithLockedRate(
        existingOrder,
        actualTotal,
      );

      const updatedOrder = await this.orderModel
        .findByIdAndUpdate(
          orderId,
          { 
            status: OrderStatus.PAID,
            discount,
            couponCode,
            ...amountUpdate,
          },
          { new: true },
        )
        .populate('user', 'firstName lastName email');

      if (updatedOrder) {
        console.log(`[USA Stripe Webhook] Order ${updatedOrder.orderNumber} marked as PAID.`);

        await this.recordCouponUsageIfApplicable(updatedOrder.couponCode);

        // Send notification
        const notification = await this.notificationsService.create({
          type: NotificationType.ORDER_PAID,
          title: 'Order Paid',
          message: `Order ${updatedOrder.orderNumber} has been paid by ${updatedOrder.user ? (updatedOrder.user as any).firstName : 'a user'}.`,
          metadata: {
            orderId: updatedOrder._id,
            orderNumber: updatedOrder.orderNumber,
          },
          user: (updatedOrder.user as any)?._id,
          triggeredBy: (updatedOrder.user as any)?._id,
          link: `/orders/${updatedOrder._id}`,
        });
        this.notificationsGateway.broadcastNotification(notification);

        // Send Email to sales@skygloss.com
        await this.mailService.sendNewOrderNotification(updatedOrder, updatedOrder.user).catch(err => {
          console.error('[USA Stripe Webhook] Failed to send order email to sales', err);
        });

        // Send Confirmation Email to the Customer
        await this.mailService.sendOrderPaidCustomerConfirmation(updatedOrder, updatedOrder.user).catch(err => {
          console.error('[USA Stripe Webhook] Failed to send order paid confirmation email to customer', err);
        });

        await this.applyOrderCommissions(
          updatedOrder._id.toString(),
          OrderStatus.PAID,
        );
      } else {
        console.error(`[USA Stripe Webhook] Order ${orderId} not found in DB.`);
      }
      return { received: true };
    }

    // Handle payment failure / expiration
    if (
      event.type === 'checkout.session.async_payment_failed' ||
      event.type === 'checkout.session.expired'
    ) {
      const orderId = metadata?.orderId;
      if (orderId) {
        const existing = await this.orderModel.findById(orderId);
        if (
          existing &&
          existing.status !== OrderStatus.PENDING_PAYMENT
        ) {
          console.log(
            `[USA Stripe Webhook] Marking order ${orderId} as FAILED due to: ${event.type}`,
          );
          await this.orderModel.findByIdAndUpdate(orderId, {
            status: OrderStatus.FAILED,
          });
        } else {
          console.log(
            `[USA Stripe Webhook] Checkout session expired for ${orderId}; order remains pending payment until auto-cancel.`,
          );
        }
      }
    }

    return { received: true };
  }

  async handleWebhook(sig: string, payload: Buffer) {
    const endpointSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
    if (!endpointSecret)
      throw new BadRequestException('Webhook secret not configured');

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(payload, sig, endpointSecret);
    } catch (err) {
      console.error(`[Stripe Webhook] Verification Failed: ${err.message}`);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    const session = event.data.object as Stripe.Checkout.Session;
    console.log(`[Stripe Webhook] Received event: ${event.type}`);
    const metadata = session.metadata;
    console.log(`[Stripe Webhook] Event ID: ${event.id}`);
    console.log(`[Stripe Webhook] Metadata: ${JSON.stringify(metadata)}`);
    console.log(`[Stripe Webhook] Payment Status: ${session.payment_status}`);

    if (event.type === 'checkout.session.completed') {

      // Handle Partner Registration Payment
      if (metadata && (metadata.type === 'partner_registration' || metadata.type === 'distributor_registration')) {
        const userId = session.client_reference_id || metadata.userId;
        console.log(`[Stripe Webhook] Processing partner_registration for userId: ${userId}`);

        const updatedUser = await this.usersService.update(userId, {
          status: UserStatus.ACTIVE,
          isPartnerPaid: true,
        } as any, { role: UserRole.ADMIN } as any);

        if (updatedUser) {
          console.log(`[Stripe Webhook] User ${userId} activated as partner.`);

          let invoiceBuffer: Buffer | undefined;
          let orderNumber: string | undefined;
          try {
            const regOrder = await this.createRegistrationOrder(
            updatedUser,
            session,
            updatedUser.couponCode
              ? { couponCode: updatedUser.couponCode }
              : undefined,
          );
            invoiceBuffer = await this.generateInvoicePdf(regOrder);
            orderNumber = regOrder.orderNumber;
          } catch (orderErr) {
            console.error('[Stripe Webhook] Failed to create registration order:', orderErr);
          }

          // Admin notification is now handled internally by MailService for sales@skygloss.com
          await this.mailService.sendDistributorPaymentCompletedAdminNotification(
            [],
            updatedUser,
          );

          // Send User Confirmation Email
          if (updatedUser.email) {
            const partnerContact = await this.usersService.getPartnerContactForShop(updatedUser);
            await this.mailService.sendDistributorPaymentConfirmation(
              updatedUser.email,
              updatedUser,
              invoiceBuffer,
              orderNumber,
              partnerContact,
            );
          }

          const notification = await this.notificationsService.create({
            type: NotificationType.ORDER_PAID,
            title: `${formatRoleLabel(updatedUser.role)} Registration Paid`,
            message: `User ${updatedUser.firstName} ${updatedUser.lastName} has paid the registration fee and is now active.`,
            metadata: { userId: updatedUser._id },
            user: updatedUser._id as any,
            triggeredBy: updatedUser._id as any,
            link: `/dashboard/partner`,
          });
          this.notificationsGateway.broadcastNotification(notification);
        } else {
          console.error(`[Stripe Webhook] Could not find/update user ${userId} for partner_registration.`);
        }
        return { received: true };
      }

      // Handle Shop Registration Payment
      if (metadata && metadata.type === 'shop_registration') {
        const userId = session.client_reference_id || metadata.userId;
        const partnerCode = metadata.referredByPartnerCode;
        console.log(`[Stripe Webhook] Processing shop_registration for userId: ${userId}, referredBy: ${partnerCode}`);

        const updatedUser = await this.usersService.update(userId, {
          status: UserStatus.ACTIVE,
          isPartnerPaid: true,
        } as any, { role: UserRole.ADMIN } as any);

        if (updatedUser) {
          console.log(`[Stripe Webhook] Shop ${userId} activated.`);

          let invoiceBuffer: Buffer | undefined;
          let orderNumber: string | undefined;
          try {
            const regOrder = await this.createRegistrationOrder(
            updatedUser,
            session,
            updatedUser.couponCode
              ? { couponCode: updatedUser.couponCode }
              : undefined,
          );
            invoiceBuffer = await this.generateInvoicePdf(regOrder);
            orderNumber = regOrder.orderNumber;
          } catch (orderErr) {
            console.error('[Stripe Webhook] Failed to create registration order:', orderErr);
          }

          // 1. Notify Admin (Sales Dept)
          await this.mailService.sendDistributorPaymentCompletedAdminNotification(
            [],
            updatedUser,
          );

          // Send User Confirmation Email
          if (updatedUser.email) {
            const partnerContact = await this.usersService.getPartnerContactForShop(updatedUser);
            await this.mailService.sendDistributorPaymentConfirmation(
              updatedUser.email,
              updatedUser,
              invoiceBuffer,
              orderNumber,
              partnerContact,
            );
          }

          // 2. Notify Referring Partner
          if (partnerCode) {
            const partner = await (this.usersService as any).userModel.findOne({ partnerCode });
            if (partner) {
              const partnerNotification = await this.notificationsService.create({
                type: NotificationType.ORDER_PAID,
                title: 'New Shop Referral Active',
                message: `Shop "${updatedUser.firstName} ${updatedUser.lastName}" has completed registration and is now part of your network.`,
                metadata: { shopId: updatedUser._id, shopName: `${updatedUser.firstName} ${updatedUser.lastName}` },
                user: partner._id,
                triggeredBy: updatedUser._id as any,
                link: `/dashboard/partner/network`,
              });
              this.notificationsGateway.broadcastNotification(partnerNotification);
            }
          }

          const notification = await this.notificationsService.create({
            type: NotificationType.ORDER_PAID,
            title: 'Shop Registration Paid',
            message: `Shop ${updatedUser.firstName} ${updatedUser.lastName} has paid the registration fee and is now active.`,
            metadata: { userId: updatedUser._id },
            user: updatedUser._id as any,
            triggeredBy: updatedUser._id as any,
            link: `/dashboard/shop`,
          });
          this.notificationsGateway.broadcastNotification(notification);
        } else {
          console.error(`[Stripe Webhook] CRITICAL: Could not find/update shop ${userId} for shop_registration type.`);
        }
        return { received: true };
      }

      // Handle Shop Order Payment
      if (metadata && metadata.type === 'shop_order') {
        // IMPORTANT: client_reference_id = userId, NOT orderId.
        // The orderId is stored in metadata.orderId.
        const orderId = metadata.orderId;
        console.log(`[Stripe Webhook] Processing shop_order for orderId: ${orderId}`);

        if (!orderId) {
          console.error('[Stripe Webhook] No orderId found in metadata for shop_order event.');
          return { received: true };
        }

        const existingOrder = await this.orderModel.findById(orderId);
        if (existingOrder && existingOrder.status === OrderStatus.PAID) {
          console.log(`[Stripe Webhook] Order ${existingOrder.orderNumber} is already PAID. Skipping duplicate notifications/emails.`);
          return { received: true };
        }

        const actualTotal = (session.amount_total || 0) / 100;
        const stripeDiscount = (session.total_details?.amount_discount || 0) / 100;
        let discount = existingOrder?.discount ?? 0;
        let couponCode = existingOrder?.couponCode;
        if (stripeDiscount > 0.01 && !couponCode) {
          couponCode = 'STRIPECOUPON';
          discount = stripeDiscount;
        }

        const amountUpdate = this.buildAmountUpdateWithLockedRate(
          existingOrder,
          actualTotal,
        );

        const updatedOrder = await this.orderModel
          .findByIdAndUpdate(
            orderId,
            { 
              status: OrderStatus.PAID,
              discount,
              couponCode,
              ...amountUpdate,
            },
            { new: true },
          )
          .populate('user', 'firstName lastName email');

        if (updatedOrder) {
          console.log(`[Stripe Webhook] Order ${updatedOrder.orderNumber} status updated to PAID.`);

          await this.recordCouponUsageIfApplicable(updatedOrder.couponCode);
          const notification = await this.notificationsService.create({
            type: NotificationType.ORDER_PAID,
            title: 'Order Paid',
            message: `Order ${updatedOrder.orderNumber} has been paid by ${updatedOrder.user ? (updatedOrder.user as any).firstName : 'a user'}.`,
            metadata: {
              orderId: updatedOrder._id,
              orderNumber: updatedOrder.orderNumber,
            },
            user: (updatedOrder.user as any)?._id,
            triggeredBy: (updatedOrder.user as any)?._id,
            link: `/orders/${updatedOrder._id}`,
          });
          this.notificationsGateway.broadcastNotification(notification);

          // Send Email to sales@skygloss.com
          await this.mailService.sendNewOrderNotification(updatedOrder, updatedOrder.user).catch(err => {
            console.error('Failed to send order email to sales', err);
          });

          // Send Confirmation Email to the Customer
          await this.mailService.sendOrderPaidCustomerConfirmation(updatedOrder, updatedOrder.user).catch(err => {
            console.error('Failed to send order paid confirmation email to customer', err);
          });

          await this.applyOrderCommissions(
            updatedOrder._id.toString(),
            OrderStatus.PAID,
          );
        } else {
          console.error(`[Stripe Webhook] Order with id ${orderId} not found in DB.`);
        }
        return { received: true };
      }

      console.warn('[Stripe Webhook] checkout.session.completed received but no matching type in metadata:', metadata);

    } else if (
      event.type === 'checkout.session.async_payment_failed' ||
      event.type === 'checkout.session.expired'
    ) {
      const orderId = metadata?.orderId;
      if (orderId) {
        const existing = await this.orderModel.findById(orderId);
        if (existing && existing.status !== OrderStatus.PENDING_PAYMENT) {
          console.log(
            `[Stripe Webhook] Marking order ${orderId} as FAILED due to event: ${event.type}`,
          );
          await this.orderModel.findByIdAndUpdate(orderId, {
            status: OrderStatus.FAILED,
          });
        } else {
          console.log(
            `[Stripe Webhook] Checkout session expired for ${orderId}; order remains pending payment until auto-cancel.`,
          );
        }
      }
    }
    return { received: true };
  }



  async getAllOrders(): Promise<Order[]> {
    return this.orderModel
      .find()
      .populate(
        'user',
        'firstName lastName email shopName role couponCode partnerCode',
      )
      .sort({ createdAt: -1 });
  }

  async getNetworkOrders(viewer: UserDocument): Promise<Order[]> {
    if (
      (viewer.role === UserRole.MASTER_PARTNER ||
        viewer.role === UserRole.REGIONAL_PARTNER) &&
      viewer.partnerCode?.trim()
    ) {
      await this.repairPartnerDevelopmentCommissionsForNetworkParent(
        viewer.partnerCode.trim(),
        viewer.role,
      );
      await this.repairInflatedShopIntroSplitsForRep(viewer.partnerCode.trim());
    }

    const userIds = await this.getNetworkOrderUserIds(viewer);
    if (userIds.length === 0) {
      return [];
    }

    // Backfill pending commissions on PENDING shop orders so the orders table
    // can show "Pending" amounts (cards still exclude these from totals).
    const pendingMissing = await this.orderModel
      .find({
        user: { $in: userIds },
        status: OrderStatus.PENDING,
        ...registrationOrderExclusionFilter(),
        $or: [
          { commissions: { $exists: false } },
          { commissions: { $size: 0 } },
          { commissions: null },
        ],
      } as any)
      .select('_id')
      .limit(50)
      .lean();

    for (const row of pendingMissing) {
      await this.applyOrderCommissions(
        String(row._id),
        OrderStatus.PENDING,
      );
    }

    const orders = await this.orderModel
      .find({ user: { $in: userIds } } as any)
      .populate(
        'user',
        'firstName lastName email shopName role couponCode partnerCode referredByPartnerCode shopIntroductionRepresentativeCode city country',
      )
      .sort({ createdAt: -1 })
      .exec();

    return orders
      .filter((order) => {
        const orderUser = order.user as {
          _id?: unknown;
          role?: string;
        } | null;
        if (!orderUser) return false;

        const orderUserId =
          typeof orderUser === 'object' && orderUser !== null && '_id' in orderUser
            ? String((orderUser as any)._id)
            : String(order.user);

        if (
          shouldIncludeViewerInNetworkOrders(viewer.role) &&
          orderUserId === String(viewer._id)
        ) {
          return true;
        }

        if (shouldHideShopRegistrationFromViewer(order, viewer)) {
          return false;
        }

        return canViewerSeeOrderPlacerRole(viewer.role, orderUser.role);
      })
      .map((order) => {
        const plain = order.toObject();
        type CommissionEntry = NonNullable<Order['commissions']>[number];
        plain.commissions = filterCommissionsForViewerWithSplitContext<CommissionEntry>(
          plain.commissions,
          viewer.role,
          viewer.partnerCode,
        );
        return plain;
      });
  }

  async getNetworkSalesStats(viewer: UserDocument) {
    const userIds = await this.getNetworkOrderUserIds(viewer);
    if (userIds.length === 0) {
      return {
        totalRevenue: 0,
        baseCurrency: SYSTEM_BASE_CURRENCY,
        currencyBreakdown: [],
      };
    }
    return this.computeSalesReport({
      user: { $in: userIds },
      ...registrationOrderExclusionFilter(),
    });
  }

  private async getNetworkOrderUserIds(
    viewer: UserDocument,
  ): Promise<string[]> {
    const network = await this.usersService.findNetworkUsersForViewer(viewer);
    const idSet = new Set<string>();

    const addUser = (u?: { _id?: unknown }) => {
      if (u?._id) {
        idSet.add(String(u._id));
      }
    };

    network.shops.forEach(addUser);
    network.promoters.forEach(addUser);
    network.subPromoters?.forEach(addUser);
    network.representatives.forEach(addUser);
    network.represented?.forEach(addUser);
    network.distributors.forEach(addUser);
    network.partners?.forEach(addUser);

    if (shouldIncludeViewerInNetworkOrders(viewer.role)) {
      addUser(viewer);
    }

    return Array.from(idSet);
  }

  /** Resolve a Representative partner code into a commission recipient. */
  private async resolveCommissionRecipient(
    partnerCode?: string,
  ): Promise<CommissionRecipient | null> {
    if (!partnerCode) return null;
    const user = await this.usersService.findByPartnerCode(partnerCode);
    if (!user?.partnerCode) return null;
    return {
      _id: user._id.toString(),
      partnerCode: user.partnerCode,
      role: user.role,
    };
  }

  /** True when `orderId` is the shop's earliest commissionable order
   *  (PENDING / PAID / SHIPPED / DELIVERED — so FO rates apply while still pending). */
  private async isFirstSuccessfulShopOrder(
    shopUserId: string,
    orderId: string,
  ): Promise<boolean> {
    const earliest = await this.orderModel
      .find({
        user: shopUserId,
        status: {
          $in: [
            OrderStatus.PENDING,
            OrderStatus.PAID,
            OrderStatus.SHIPPED,
            OrderStatus.DELIVERED,
          ],
        },
        ...registrationOrderExclusionFilter(),
      } as any)
      .sort({ createdAt: 1 })
      .limit(1)
      .select('_id')
      .lean();

    return earliest.length > 0 && String(earliest[0]._id) === String(orderId);
  }

  async applyOrderCommissions(
    orderId: string,
    newStatus: OrderStatus,
  ): Promise<void> {
    if (
      newStatus !== OrderStatus.PENDING &&
      newStatus !== OrderStatus.PAID &&
      newStatus !== OrderStatus.SHIPPED &&
      newStatus !== OrderStatus.DELIVERED
    ) {
      return;
    }

    const order = await this.orderModel.findById(orderId);
    if (!order) return;
    if (isRegistrationOrder(order)) return;

    const shopUserId =
      typeof order.user === 'object' && order.user !== null && '_id' in (order.user as object)
        ? String((order.user as any)._id)
        : String(order.user);

    if (!shopUserId) return;

    let shopUser = await this.usersService.findOne(shopUserId);
    if (!shopUser || shopUser.role !== UserRole.CERTIFIED_SHOP) return;

    // Promoter Network FO first (same stamp shape as Rep FO: SI=P2, PD=P1).
    // Must run before Rep re-assignment so we don't keep an upstream-Rep SI
    // when the shop sits under an Add-to-Network linked Promoter.
    shopUser = await this.usersService.assignShopPromoterNetworkEarnings(shopUser);

    const promoterFoReady =
      shopUser.partnerDevelopmentPromoterEligible === true &&
      normalizePartnerCode(shopUser.shopIntroductionRepresentativeCode) ===
        normalizePartnerCode(shopUser.referredByPartnerCode);

    if (!promoterFoReady) {
      if (!shopUser.shopIntroductionRepresentativeCode) {
        shopUser = await this.usersService.assignShopEarningRepresentatives(shopUser);
      } else if (
        shopUser.partnerDevelopmentEligible !== true ||
        !shopUser.partnerDevelopmentRepresentativeCode
      ) {
        // Re-evaluate Rep FO eligibility (fixes shops blocked by old default=false bug).
        shopUser = await this.usersService.assignShopEarningRepresentatives(shopUser);
      }
      shopUser = await this.usersService.ensureShopPartnerDevelopmentAssignment(
        shopUser,
      );
      // Re-apply promoter FO in case Rep assign ran first on a linked-promoter shop.
      shopUser = await this.usersService.assignShopPromoterNetworkEarnings(shopUser);
    }

    // Admin may have edited Child/Parent FO % after shop assignment — use live rates
    // until Partner Development is locked on first paid/fulfilled order.
    shopUser = await this.usersService.refreshShopFirstOrderRatesIfUnpaid(
      shopUser,
    );

    if (!shopUser.shopIntroductionRepresentativeCode) return;

    const isFirstSuccessfulOrder = await this.isFirstSuccessfulShopOrder(
      shopUserId,
      orderId,
    );

    // Partner Development is a ONE-TIME earning per SHOP — paid only on that
    // shop's first successful (non-registration) order, tracked via the
    // shop-level partnerDevelopmentCommissionPaid flag.
    const partnerDevelopmentAlreadyPaid =
      shopUser.partnerDevelopmentCommissionPaid === true;

    if (order.commissions && order.commissions.length > 0) {
      // If FO stamps now point at a different SI recipient (e.g. Promoter FO
      // fixed after an earlier Rep-only commission write), rebuild from scratch.
      const expectedSi = normalizePartnerCode(
        shopUser.shopIntroductionRepresentativeCode,
      );
      const existingSiLine = order.commissions.find(
        (entry) => entry.earningType === 'Shop Introduction',
      );
      const actualSi = normalizePartnerCode(existingSiLine?.recipientPartnerCode);
      const siMismatch =
        !partnerDevelopmentAlreadyPaid &&
        !!expectedSi &&
        !!actualSi &&
        actualSi !== expectedSi;

      if (siMismatch) {
        order.commissions = [];
        order.markModified('commissions');
        await order.save();
        // Fall through to fresh commission build below.
      } else {
      const hasPartnerDevelopment = order.commissions.some(
        (entry) => entry.earningType === 'Partner Development',
      );

      if (
        isFirstSuccessfulOrder &&
        !hasPartnerDevelopment &&
        shopUser.partnerDevelopmentEligible === true &&
        shopUser.partnerDevelopmentRepresentativeCode &&
        !partnerDevelopmentAlreadyPaid
      ) {
        const monetary = resolveCommissionOrderAmounts(order);
        const partnerDevUser = await this.usersService.findByPartnerCode(
          shopUser.partnerDevelopmentRepresentativeCode,
        );
        if (partnerDevUser) {
          const commissionStatus =
            newStatus === OrderStatus.SHIPPED ||
            newStatus === OrderStatus.DELIVERED
              ? ('earned' as const)
              : ('pending' as const);

          const split = resolveFirstOrderPoolSplit({
            shopIntroductionRate:
              shopUser.shopIntroductionFirstOrderRatePercent,
            partnerDevelopmentRate: shopUser.partnerDevelopmentRatePercent,
          });

          // Child keeps remainder of the FO pool after parent cut.
          this.shrinkShopIntroToPercent(
            order,
            monetary,
            split.childKeepPercent,
          );

          // Keep existing lines pending until shipped.
          order.commissions = order.commissions.map((entry) => ({
            ...entry,
            status: commissionStatus,
          }));

          order.commissions.push({
            recipientUserId: partnerDevUser._id.toString(),
            recipientPartnerCode: partnerDevUser.partnerCode!,
            recipientRole: partnerDevUser.role,
            earningType: 'Partner Development',
            percentage: split.parentPercent,
            amount: roundMoney(
              monetary.convertedUsdAmount * (split.parentPercent / 100),
            ),
            status: commissionStatus,
            shopId: shopUserId,
            orderAmount: monetary.orderAmount,
            originalCurrency: monetary.orderCurrency,
            exchangeRate: monetary.exchangeRateToUsd,
            convertedUsdAmount: monetary.convertedUsdAmount,
          });

          order.markModified('commissions');
          await order.save();
          if (
            newStatus === OrderStatus.PAID ||
            newStatus === OrderStatus.SHIPPED ||
            newStatus === OrderStatus.DELIVERED
          ) {
            await this.usersService.markPartnerDevelopmentCommissionPaid(
              shopUserId,
            );
            if (shopUser.partnerDevelopmentPromoterEligible === true) {
              await this.usersService.markPartnerDevelopmentPromoterCommissionPaid(
                shopUserId,
              );
            }
          }
        }
      } else if (
        isFirstSuccessfulOrder &&
        hasPartnerDevelopment
      ) {
        const monetary = resolveCommissionOrderAmounts(order);
        // Prefer live admin FO rates over legacy "normalize 20% → 10%" repair.
        const ratesSynced = this.syncFirstOrderCommissionRatesOnOrder(
          order,
          shopUser,
          monetary,
        );
        if (!ratesSynced) {
          await this.normalizeFirstOrderSplitOnOrder(order);
        }
        const commissionStatus =
          newStatus === OrderStatus.SHIPPED ||
          newStatus === OrderStatus.DELIVERED
            ? ('earned' as const)
            : ('pending' as const);
        order.commissions = order.commissions.map((entry) => ({
          ...entry,
          status: commissionStatus,
        }));
        order.markModified('commissions');
        await order.save();
      } else if (
        newStatus === OrderStatus.SHIPPED ||
        newStatus === OrderStatus.DELIVERED ||
        newStatus === OrderStatus.PAID ||
        newStatus === OrderStatus.PENDING
      ) {
        const commissionStatus =
          newStatus === OrderStatus.SHIPPED ||
          newStatus === OrderStatus.DELIVERED
            ? ('earned' as const)
            : ('pending' as const);
        order.commissions = order.commissions.map((entry) => ({
          ...entry,
          status: commissionStatus,
        }));
        order.markModified('commissions');
        await order.save();
      }
      return;
      } // end else (no SI mismatch)
    }

    const monetary = resolveCommissionOrderAmounts(order);

    const shopIntroduction = await this.resolveCommissionRecipient(
      shopUser.shopIntroductionRepresentativeCode,
    );
    const partnerDevelopment =
      shopUser.partnerDevelopmentEligible === true
        ? await this.resolveCommissionRecipient(
            shopUser.partnerDevelopmentRepresentativeCode,
          )
        : null;

    const shopIntroUser = shopUser.shopIntroductionRepresentativeCode
      ? await this.usersService.findByPartnerCode(
          shopUser.shopIntroductionRepresentativeCode,
        )
      : null;
    const defaultShopIntroductionRatePercent = resolveCommissionRatePercent(
      shopIntroUser?.role || UserRole.MASTER_PARTNER,
      shopIntroUser?.customCommissionRate,
    );

    // Promoter Network FO uses the SAME stamps as Rep FO
    // (SI = child Promoter, PD = parent Promoter, eligible = true).
    // assignShopPromoterNetworkEarnings runs above so stamps are ready.
    const entries = calculateRepresentativeCommissionEntries({
      shopId: shopUserId,
      assignments: {
        shopIntroductionRepresentativeCode:
          shopUser.shopIntroductionRepresentativeCode,
        partnerDevelopmentRepresentativeCode:
          shopUser.partnerDevelopmentRepresentativeCode,
        partnerDevelopmentCommissionPaid: partnerDevelopmentAlreadyPaid,
        partnerDevelopmentEligible: shopUser.partnerDevelopmentEligible === true,
        partnerDevelopmentRatePercent: shopUser.partnerDevelopmentRatePercent,
        shopIntroductionFirstOrderRatePercent:
          shopUser.shopIntroductionFirstOrderRatePercent,
      },
      recipients: {
        shopIntroduction,
        partnerDevelopment,
      },
      monetary,
      isFirstSuccessfulOrder,
      defaultShopIntroductionRatePercent,
    });

    const commissionStatus =
      newStatus === OrderStatus.SHIPPED ||
      newStatus === OrderStatus.DELIVERED
        ? ('earned' as const)
        : ('pending' as const);

    order.commissions = entries.map((entry) => ({
      ...entry,
      status: commissionStatus,
    }));
    await order.save();

    const paidPartnerDevelopment = entries.some(
      (entry) => entry.earningType === 'Partner Development',
    );
    // Only lock PD after real payment / fulfillment — not while still PENDING.
    if (
      paidPartnerDevelopment &&
      (newStatus === OrderStatus.PAID ||
        newStatus === OrderStatus.SHIPPED ||
        newStatus === OrderStatus.DELIVERED)
    ) {
      await this.usersService.markPartnerDevelopmentCommissionPaid(
        shopUserId,
      );
      // Keep promoter mirror flag in sync when FO recipients are Promoters
      if (shopUser.partnerDevelopmentPromoterEligible === true) {
        await this.usersService.markPartnerDevelopmentPromoterCommissionPaid(
          shopUserId,
        );
      }
    }

    if (entries.length > 0) {
      console.log(
        `[Commission] Order ${order.orderNumber}: ${entries.length} recipient(s), status=${commissionStatus}, base=${monetary.orderAmount} ${monetary.orderCurrency} @ ${monetary.exchangeRateToUsd} → USD`,
      );
    }
  }

  /** Orders where `viewer` (Representative or Promoter) is a commission recipient. */
  async getCommissionOrders(viewer: UserDocument): Promise<Order[]> {
    const partnerCode = viewer.partnerCode?.trim();
    if (
      !partnerCode ||
      (viewer.role !== UserRole.MASTER_PARTNER &&
        viewer.role !== UserRole.REGIONAL_PARTNER)
    ) {
      return [];
    }

    await this.repairPartnerDevelopmentCommissionsForNetworkParent(
      partnerCode,
      viewer.role,
    );
    await this.repairInflatedShopIntroSplitsForRep(partnerCode);

    // Case-insensitive partner code match (legacy rows may differ in casing).
    const orders = await this.orderModel
      .find({
        'commissions.recipientPartnerCode': {
          $regex: `^${partnerCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
          $options: 'i',
        },
        ...registrationOrderExclusionFilter(),
      } as any)
      .populate(
        'user',
        'firstName lastName email shopName role couponCode partnerCode referredByPartnerCode shopIntroductionRepresentativeCode city country',
      )
      .sort({ createdAt: -1 })
      .exec();

    return orders.map((order) => {
      const plain = order.toObject();
      // Keep the full commission split so viewers can see sibling First Order lines
      // (e.g. Shop Intro 5% + Partner Dev 5%).
      plain.commissions = plain.commissions || [];
      return plain;
    });
  }

  /**
   * Repair: for each shop that still owes `parentCode` a Partner Development
   * commission (as PD parent), OR shops introduced by `parentCode` that still
   * need the first-order split — pay / split on that shop's earliest
   * successful (non-registration) order.
   * Works for both Representative and Promoter FO parents (shared stamp fields).
   */
  private async repairPartnerDevelopmentCommissionsForNetworkParent(
    parentCode: string,
    parentRole: UserRole,
  ): Promise<void> {
    if (parentRole === UserRole.MASTER_PARTNER) {
      await this.usersService.ensurePartnerDevelopmentNetworkForRepresentative(
        parentCode,
      );
    } else if (parentRole === UserRole.REGIONAL_PARTNER) {
      await this.usersService.ensurePartnerDevelopmentNetworkForPromoter(
        parentCode,
      );
    } else {
      return;
    }

    const pendingShops =
      await this.usersService.findShopsPendingPartnerDevelopment(parentCode);

    const shopIds = new Set(pendingShops.map((shop) => String(shop._id)));

    // Also include shops introduced by this parent that still need PD split
    // (covers child loading commissions and triggering parent PD repair).
    const introShops =
      await this.usersService.findShopsByIntroductionRep(parentCode);
    for (const shop of introShops) {
      if (shop.partnerDevelopmentCommissionPaid === true) continue;
      shopIds.add(String(shop._id));
    }

    for (const shopId of shopIds) {
      const shop = await this.usersService.findOne(shopId);
      // Pre-Add-to-Network shops are not FO Partner Development eligible.
      if (!shop || shop.partnerDevelopmentEligible !== true) {
        continue;
      }

      const earliestOrder = await this.orderModel
        .findOne({
          user: shopId,
          status: {
            $in: [OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.DELIVERED],
          },
          ...registrationOrderExclusionFilter(),
        } as any)
        .sort({ createdAt: 1 })
        .select('_id')
        .lean();

      if (earliestOrder) {
        await this.repairPartnerDevelopmentCommission(
          String(earliestOrder._id),
          shopId,
        );
      }
    }
  }
  /**
   * When Partner Development exists, Shop Introduction must not remain at the
   * unlinked default (20%). FO pool model: child keeps (pool − parent).
   * Legacy repair without shop rates: defaults to 10% pool / 5% parent → child 5%.
   */
  private async normalizeFirstOrderSplitOnOrder(order: any): Promise<boolean> {
    if (!order?.commissions?.length) return false;

    const hasPartnerDevelopment = order.commissions.some(
      (entry: { earningType?: string }) =>
        entry.earningType === 'Partner Development',
    );
    if (!hasPartnerDevelopment) return false;

    const monetary = resolveCommissionOrderAmounts(order);
    const twentyPercent = roundMoney(monetary.convertedUsdAmount * 0.2);
    const defaultSplit = resolveFirstOrderPoolSplit();
    const foSiPercent = defaultSplit.childKeepPercent;
    const foSiAmount = roundMoney(
      monetary.convertedUsdAmount * (foSiPercent / 100),
    );
    if (!(foSiAmount >= 0)) return false;

    let changed = false;
    for (const entry of order.commissions) {
      if (entry.earningType === 'Partner Development') continue;

      const pct = Number(entry.percentage);
      const amt = Number(entry.amount) || 0;
      const isShopIntro =
        entry.earningType === 'Shop Introduction' ||
        (!entry.earningType &&
          entry.recipientRole === UserRole.MASTER_PARTNER &&
          (pct === 20 || Math.abs(amt - twentyPercent) < 0.05));

      if (!isShopIntro) continue;
      // Only rewrite clearly-wrong unlinked 20% SI when PD is already present.
      if (!(pct === 20 || Math.abs(amt - twentyPercent) < 0.05)) continue;

      entry.earningType = 'Shop Introduction';
      entry.percentage = foSiPercent;
      entry.amount = foSiAmount;
      changed = true;
    }

    if (!changed) return false;

    order.markModified('commissions');
    await order.save();

    console.log(
      `[Commission] Normalized FO split on ${order.orderNumber || order._id}: Shop Intro → ${foSiPercent}% ($${foSiAmount}) with Partner Development present`,
    );
    return true;
  }

  private shrinkShopIntroToFivePercent(order: any, monetary: {
    convertedUsdAmount: number;
  }): void {
    this.shrinkShopIntroToPercent(order, monetary, 5);
  }

  private shrinkShopIntroToPercent(
    order: any,
    monetary: { convertedUsdAmount: number },
    shopIntroPercent: number,
  ): void {
    // Child Rep FO can be any admin-configured % (e.g. 50), not capped at 10.
    const introPercent = normalizeShopIntroductionFirstOrderRatePercent(
      shopIntroPercent,
    );
    const introAmount = roundMoney(
      monetary.convertedUsdAmount * (introPercent / 100),
    );
    const tenPercent = roundMoney(monetary.convertedUsdAmount * 0.1);

    for (const entry of order.commissions || []) {
      if (entry.earningType === 'Partner Development') continue;

      const pct = Number(entry.percentage);
      const amt = Number(entry.amount) || 0;
      const isShopIntro =
        entry.earningType === 'Shop Introduction' ||
        (!entry.earningType &&
          (pct === 10 || Math.abs(amt - tenPercent) < 0.05));

      if (!isShopIntro) continue;
      if (
        pct === introPercent &&
        Math.abs(amt - introAmount) < 0.02
      ) {
        continue;
      }

      entry.earningType = 'Shop Introduction';
      entry.percentage = introPercent;
      entry.amount = introAmount;
    }

    if (typeof order.markModified === 'function') {
      order.markModified('commissions');
    }
  }

  /**
   * When admin changes Child/Parent FO % before Partner Development is locked,
   * rewrite pending first-order commission lines to the live shop rates.
   */
  private syncFirstOrderCommissionRatesOnOrder(
    order: any,
    shopUser: {
      partnerDevelopmentEligible?: boolean;
      partnerDevelopmentCommissionPaid?: boolean;
      shopIntroductionFirstOrderRatePercent?: number;
      partnerDevelopmentRatePercent?: number;
    },
    monetary: { convertedUsdAmount: number },
  ): boolean {
    if (shopUser.partnerDevelopmentEligible !== true) return false;
    if (shopUser.partnerDevelopmentCommissionPaid === true) return false;
    if (!order?.commissions?.length) return false;

    const hasPartnerDevelopment = order.commissions.some(
      (entry: { earningType?: string }) =>
        entry.earningType === 'Partner Development',
    );
    if (!hasPartnerDevelopment) return false;

    const split = resolveFirstOrderPoolSplit({
      shopIntroductionRate: shopUser.shopIntroductionFirstOrderRatePercent,
      partnerDevelopmentRate: shopUser.partnerDevelopmentRatePercent,
    });

    const shopIntroAmount = roundMoney(
      monetary.convertedUsdAmount * (split.childKeepPercent / 100),
    );
    const pdAmount = roundMoney(
      monetary.convertedUsdAmount * (split.parentPercent / 100),
    );

    let changed = false;
    for (const entry of order.commissions) {
      if (entry.earningType === 'Partner Development') {
        if (
          Number(entry.percentage) !== split.parentPercent ||
          Math.abs(Number(entry.amount) - pdAmount) >= 0.02
        ) {
          entry.percentage = split.parentPercent;
          entry.amount = pdAmount;
          changed = true;
        }
        continue;
      }

      const pct = Number(entry.percentage);
      const amt = Number(entry.amount) || 0;
      const isShopIntro =
        entry.earningType === 'Shop Introduction' ||
        (!entry.earningType && entry.recipientRole === UserRole.MASTER_PARTNER);

      if (!isShopIntro) continue;
      if (
        pct === split.childKeepPercent &&
        Math.abs(amt - shopIntroAmount) < 0.02
      ) {
        continue;
      }

      entry.earningType = 'Shop Introduction';
      entry.percentage = split.childKeepPercent;
      entry.amount = shopIntroAmount;
      changed = true;
    }

    if (changed && typeof order.markModified === 'function') {
      order.markModified('commissions');
    }
    return changed;
  }

  private async repairPartnerDevelopmentCommission(
    orderId: string,
    shopUserId: string,
  ): Promise<void> {
    let shopUser = await this.usersService.findOne(shopUserId);
    if (!shopUser || shopUser.role !== UserRole.CERTIFIED_SHOP) return;

    // Only shops created after Add-to-Network get FO Partner Development.
    if (shopUser.partnerDevelopmentEligible !== true) {
      return;
    }

    shopUser = await this.usersService.refreshShopFirstOrderRatesIfUnpaid(
      shopUser,
    );

    const order = await this.orderModel.findById(orderId);
    if (!order?.commissions?.length) return;

    const hasPartnerDevelopment = order.commissions.some(
      (entry) => entry.earningType === 'Partner Development',
    );

    // Already split — sync to live FO rates (or legacy 20% → FO repair).
    if (hasPartnerDevelopment) {
      const monetary = resolveCommissionOrderAmounts(order);
      const ratesSynced = this.syncFirstOrderCommissionRatesOnOrder(
        order,
        shopUser,
        monetary,
      );
      if (ratesSynced) {
        await order.save();
      } else {
        await this.normalizeFirstOrderSplitOnOrder(order);
      }
      return;
    }

    // Guard: never pay Partner Development twice for the same shop.
    if (shopUser.partnerDevelopmentCommissionPaid === true) {
      return;
    }

    // Prefer Promoter FO stamps (same order as applyOrderCommissions).
    let updatedShop =
      await this.usersService.assignShopPromoterNetworkEarnings(shopUser);
    if (
      updatedShop.partnerDevelopmentEligible !== true ||
      !updatedShop.partnerDevelopmentRepresentativeCode
    ) {
      updatedShop =
        await this.usersService.ensureShopPartnerDevelopmentAssignment(
          updatedShop,
        );
    }
    if (
      updatedShop.partnerDevelopmentEligible !== true ||
      !updatedShop.partnerDevelopmentRepresentativeCode
    ) {
      return;
    }

    const partnerDevUser = await this.usersService.findByPartnerCode(
      updatedShop.partnerDevelopmentRepresentativeCode,
    );
    if (!partnerDevUser) return;

    const monetary = resolveCommissionOrderAmounts(order);
    const commissionStatus = order.commissions[0]?.status || 'pending';
    const split = resolveFirstOrderPoolSplit({
      shopIntroductionRate: updatedShop.shopIntroductionFirstOrderRatePercent,
      partnerDevelopmentRate: updatedShop.partnerDevelopmentRatePercent,
    });

    this.shrinkShopIntroToPercent(order, monetary, split.childKeepPercent);

    order.commissions.push({
      recipientUserId: partnerDevUser._id.toString(),
      recipientPartnerCode: partnerDevUser.partnerCode!,
      recipientRole: partnerDevUser.role,
      earningType: 'Partner Development',
      percentage: split.parentPercent,
      amount: roundMoney(
        monetary.convertedUsdAmount * (split.parentPercent / 100),
      ),
      status: commissionStatus,
      shopId: shopUserId,
      orderAmount: monetary.orderAmount,
      originalCurrency: monetary.orderCurrency,
      exchangeRate: monetary.exchangeRateToUsd,
      convertedUsdAmount: monetary.convertedUsdAmount,
    });

    order.markModified('commissions');
    await order.save();
    await this.usersService.markPartnerDevelopmentCommissionPaid(shopUserId);
    if (updatedShop.partnerDevelopmentPromoterEligible === true) {
      await this.usersService.markPartnerDevelopmentPromoterCommissionPaid(
        shopUserId,
      );
    }
  }

  /**
   * Scan commission orders for this Rep/Promoter and shrink any FO Shop Intro
   * still inflated when Partner Development is already present on the same order.
   */
  private async repairInflatedShopIntroSplitsForRep(
    repCode: string,
  ): Promise<void> {
    const code = repCode?.trim();
    if (!code) return;

    // Any order involving this Rep that already has a PD line (including
    // sibling PD when this Rep is Shop Intro) — normalize SI to 5%.
    const orders = await this.orderModel
      .find({
        $and: [
          registrationOrderExclusionFilter(),
          {
            commissions: {
              $elemMatch: { earningType: 'Partner Development' },
            },
          },
          {
            'commissions.recipientPartnerCode': code,
          },
        ],
      } as any)
      .exec();

    for (const order of orders) {
      await this.normalizeFirstOrderSplitOnOrder(order);
    }
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    trackingId?: string,
    shippingCompany?: string,
    actor?: UserDocument,
  ): Promise<Order> {
    const order = await this.orderModel.findById(id).populate('user');
    if (!order) throw new NotFoundException('Order not found');

    if (actor?.role === UserRole.PARTNER) {
      const orderUserId =
        typeof order.user === 'object' && order.user !== null && '_id' in (order.user as object)
          ? String((order.user as any)._id)
          : String(order.user);
      const inNetwork = await this.usersService.isUserInViewerNetwork(
        actor,
        orderUserId,
      );
      if (!inNetwork) {
        throw new ForbiddenException(
          'You can only update orders from shops in your network',
        );
      }
    }

    if (status === OrderStatus.SHIPPED) {
      if (!trackingId?.trim()) {
        throw new BadRequestException(
          'Tracking ID is required when marking an order as shipped',
        );
      }
    }

    const oldStatus = order.status;
    order.status = status;
    if (trackingId) {
      order.trackingId = trackingId;
    }
    if (shippingCompany) {
      order.shippingCompany = shippingCompany;
    }

    if (status === OrderStatus.CANCELLED && oldStatus !== OrderStatus.CANCELLED) {
      if (oldStatus === OrderStatus.PAID && order.stripeSessionId) {
        try {
          const userCountry = ((order.user as any)?.country || '').toLowerCase().trim();
          const isUsaUser = ['united states', 'usa', 'us', 'united states of america'].includes(userCountry);
          const stripeInstance = isUsaUser && this.usaStripe ? this.usaStripe : this.stripe;

          if (stripeInstance) {
            const session = await stripeInstance.checkout.sessions.retrieve(order.stripeSessionId);
            if (session.payment_intent) {
              await stripeInstance.refunds.create({
                payment_intent: session.payment_intent as string,
              });
              console.log(`[Order Cancelled] Refund issued for order ${order.orderNumber}`);
            } else {
              console.warn(`[Order Cancelled] No payment_intent found for session ${order.stripeSessionId}`);
            }
          }
        } catch (error) {
          console.error(`[Order Cancelled] Refund failed for order ${order.orderNumber}:`, error);
        }
      }

      // Send cancellation emails
      if (order.user) {
        if (!order.cancellationReason) {
          order.cancellationReason =
            'This order was cancelled by an administrator.';
        }
        await this.mailService
          .sendOrderCancelledCustomerNotification(order, order.user, {
            wasPaid: oldStatus === OrderStatus.PAID,
            cancellationReason: order.cancellationReason,
          })
          .catch((err) => {
            console.error('Failed to send order cancelled email to customer', err);
          });
        await this.mailService.sendOrderCancelledAdminNotification(order, order.user).catch(err => {
          console.error('Failed to send order cancelled email to admin', err);
        });
      }
    }

    const updatedOrder = await order.save();

    if (
      status === OrderStatus.SHIPPED &&
      oldStatus !== OrderStatus.SHIPPED &&
      order.user
    ) {
      await this.mailService
        .sendOrderShippedCustomerNotification(updatedOrder, order.user)
        .catch((err) => {
          console.error('Failed to send order shipped email to customer', err);
        });
    }

    if (
      status === OrderStatus.PENDING ||
      status === OrderStatus.PAID ||
      status === OrderStatus.SHIPPED ||
      status === OrderStatus.DELIVERED
    ) {
      await this.applyOrderCommissions(updatedOrder._id.toString(), status);
    }

    if (status === OrderStatus.PAID && oldStatus !== OrderStatus.PAID) {
      await this.recordCouponUsageIfApplicable(updatedOrder.couponCode);
    }

    return updatedOrder;
  }

  async createOrderRequest(userId: string, createOrderDto: CreateOrderDto) {
    try {
      const currentUser = await this.usersService.findOne(userId);
      if (!currentUser) {
        throw new NotFoundException('User not found');
      }
      
      const orderCurrency = await this.getCurrencyForUser(currentUser);

      const { items: rawItems, shippingAddress, couponCode } = createOrderDto;
      const items = rawItems.map((item) => ({
        ...item,
        orderType: normalizeOrderItemType(item.orderType),
      }));
      
      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new BadRequestException('Order items are required');
      }

      const itemsSubtotal = getItemsSubtotal(items);
      const shippingCountry =
        shippingAddress?.country || currentUser?.country || '';
      const shippingFee = calculateShippingFee(shippingCountry, itemsSubtotal);

      let discount = 0;
      let appliedCouponCode: string | undefined;
      if (couponCode?.trim()) {
        const validation = await this.couponsService.validateForCheckout(
          couponCode,
          itemsSubtotal,
        );
        discount = validation.discountAmount;
        appliedCouponCode = validation.code;
      }

      const finalAmount = Math.max(0, itemsSubtotal + shippingFee - discount);

      let savedOrder;
      let retries = 3;
      while (retries > 0) {
        try {
          const orderNumber = await this.generateShopOrderNumber(
            shippingCountry,
            'request',
          );
          const monetary = await this.buildMonetaryFieldsForNewOrder(
            finalAmount,
            orderCurrency || 'usd',
          );
          const order = new this.orderModel({
            user: userId,
            items,
            shippingFee,
            shippingAddress,
            status: OrderStatus.PENDING,
            orderNumber,
            orderFlow: 'request',
            discount,
            couponCode: appliedCouponCode,
            ...monetary,
          });
          savedOrder = await order.save();
          break;
        } catch (saveError: any) {
          if (saveError.code === 11000 && retries > 1) {
            retries--;
            continue;
          }
          throw saveError;
        }
      }

      if (savedOrder) {
        await this.applyOrderCommissions(
          savedOrder._id.toString(),
          OrderStatus.PENDING,
        );
      }

      // Create notification for admin
      try {
        const notification = await this.notificationsService.create({
          type: NotificationType.ORDER_PLACED,
          title: 'New Order Request',
          message: `A new order request ${savedOrder.orderNumber} has been submitted.`,
          metadata: {
            orderId: savedOrder._id,
            orderNumber: savedOrder.orderNumber,
          },
          user: userId,
          triggeredBy: userId,
          link: `/orders/${savedOrder._id}`,
        });
        this.notificationsGateway.broadcastNotification(notification);
      } catch (notifErr) {
        console.error('Failed to create/broadcast notification for order request:', notifErr);
      }

      // Send Email to sales@skygloss.com
      if (currentUser) {
        await this.mailService.sendNewOrderRequestNotification(savedOrder, currentUser).catch(err => {
          console.error('Failed to send order request email to sales', err);
        });
        
        // Send Confirmation Email to the Customer
        await this.mailService.sendOrderRequestCustomerConfirmation(savedOrder, currentUser).catch(err => {
          console.error('Failed to send order request confirmation email to customer', err);
        });
      }

      return savedOrder;
    } catch (error) {
      console.error('[OrdersService] createOrderRequest error:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to create order request: ${error.message}`);
    }
  }

  async getDashboardStats() {
    const recentOrders = await this.orderModel
      .find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'firstName lastName email');

    const salesReport = await this.computeSalesReport();

    return {
      recentOrders,
      totalRevenue: salesReport.totalRevenue,
      baseCurrency: salesReport.baseCurrency,
      currencyBreakdown: salesReport.currencyBreakdown,
      chartData: salesReport.chartData,
    };
  }

  async getExchangeRates() {
    return this.exchangeRatesService.getAllRates();
  }

  async getExchangeRatesMap() {
    return this.exchangeRatesService.getRatesMap();
  }

  async refreshExchangeRatesFromMarket() {
    const updated = await this.exchangeRatesService.refreshRatesFromMarket();
    await this.repairBrokenFxOrders();
    return {
      updated,
      rates: await this.exchangeRatesService.getRatesMap(),
    };
  }

  async updateExchangeRate(currency: string, rateToBase: number) {
    if (!currency || typeof rateToBase !== 'number' || rateToBase <= 0) {
      throw new BadRequestException('Valid currency and rateToBase are required');
    }
    return this.exchangeRatesService.updateRate(currency, rateToBase);
  }

  async deleteOrder(id: string): Promise<{ success: boolean }> {
    const order = await this.orderModel.findById(id).populate('user');
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === OrderStatus.PAID && order.stripeSessionId) {
      try {
        const userCountry = ((order.user as any)?.country || '').toLowerCase().trim();
        const isUsaUser = ['united states', 'usa', 'us', 'united states of america'].includes(userCountry);
        const stripeInstance = isUsaUser && this.usaStripe ? this.usaStripe : this.stripe;

        if (stripeInstance) {
          const session = await stripeInstance.checkout.sessions.retrieve(order.stripeSessionId);
          if (session.payment_intent) {
            await stripeInstance.refunds.create({
              payment_intent: session.payment_intent as string,
            });
            console.log(`[Order Deleted] Refund issued for order ${order.orderNumber}`);
          }
        }
      } catch (error) {
        console.error(`[Order Deleted] Refund failed for order ${order.orderNumber}:`, error);
      }
    }

    if (order.user) {
      await this.mailService.sendOrderCancelledCustomerNotification(order, order.user).catch(err => {
        console.error('Failed to send order cancelled email to customer', err);
      });
      await this.mailService.sendOrderCancelledAdminNotification(order, order.user).catch(err => {
        console.error('Failed to send order cancelled email to admin', err);
      });
    }

    await this.orderModel.findByIdAndDelete(id);
    return { success: true };
  }

  private isUsaCountry(country: string): boolean {
    return USA_COUNTRIES.includes((country || '').toLowerCase().trim());
  }

  private getStripeForUsaUser(isUsaUser: boolean): Stripe {
    const stripeInstance = isUsaUser && this.usaStripe ? this.usaStripe : this.stripe;
    if (!stripeInstance) {
      throw new BadRequestException('Stripe is not configured on the server.');
    }
    return stripeInstance;
  }

  private getFrontendBaseUrl(): string {
    let baseUrl = (this.configService.get<string>('FRONTEND_URL') || '').replace(
      /\/+$/,
      '',
    );
    if (!baseUrl) {
      baseUrl =
        process.env.NODE_ENV === 'production'
          ? 'https://portal.skygloss.com'
          : 'http://localhost:3000';
    }
    return baseUrl;
  }

  private getDashboardPath(role?: string): string {
    const isPartner = ['master_partner', 'regional_partner', 'distributor', 'partner'].includes(
      role || '',
    );
    return isPartner ? '/dashboard/partner' : '/dashboard/shop';
  }

  getOrderPayUrl(orderId: string, role?: string): string {
    const baseUrl = this.getFrontendBaseUrl();
    const dashboardPath = this.getDashboardPath(role);
    return `${baseUrl}${dashboardPath}/receipt/${orderId}`;
  }

  private async createStripeCheckoutForOrder(
    order: OrderDocument,
    currentUser: any,
    role: string | undefined,
    stripeInstance: Stripe,
    orderCurrency: string,
  ): Promise<Stripe.Checkout.Session> {
    const items = order.items;
    const itemsSubtotal = getItemsSubtotal(items);
    const discount = order.discount ?? 0;
    const discountedSubtotal = Math.max(0, itemsSubtotal - discount);
    const priceRatio =
      itemsSubtotal > 0 ? discountedSubtotal / itemsSubtotal : 1;
    const shippingFee =
      order.shippingFee != null && order.shippingFee >= 0
        ? order.shippingFee
        : Math.max(0, order.totalAmount - itemsSubtotal + discount);
    const shippingCountry =
      order.shippingAddress?.country || currentUser?.country || '';

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map(
      (item) => {
        const images: string[] = [];
        if (item.image && typeof item.image === 'string' && item.image.startsWith('http')) {
          images.push(item.image);
        }

        return {
          price_data: {
            currency: orderCurrency,
            product_data: {
              name: String(item.name || 'Product'),
              images,
              metadata: {
                size: String(item.size || ''),
                productId: String(item.product || ''),
              },
            },
            unit_amount: Math.round(
              Number(item.price || 0) * priceRatio * 100,
            ),
          },
          quantity: Math.max(1, Number(item.quantity || 1)),
        };
      },
    );

    if (shippingFee > 0) {
      const shippingRegion = getShippingRegion(
        shippingCountry.toLowerCase().trim(),
      );
      line_items.push({
        price_data: {
          currency: orderCurrency,
          product_data: {
            name: 'Shipping',
            description: `Standard shipping for orders under ${shippingRegion === 'EU' ? '€' : '$'}500`,
          },
          unit_amount: Math.round(shippingFee * 100),
        },
        quantity: 1,
      });
    }

    const baseUrl = this.getFrontendBaseUrl();
    const dashboardPath = this.getDashboardPath(currentUser?.role || role);
    const sessionMetadata = {
      orderId: String(order._id),
      type: 'shop_order',
    };

    const session = await stripeInstance.checkout.sessions.create({
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      line_items,
      mode: 'payment',
      success_url: `${baseUrl}${dashboardPath}?success=true&order_id=${order._id}`,
      cancel_url: `${baseUrl}${dashboardPath}/receipt/${order._id}?canceled=true`,
      client_reference_id: String(currentUser?._id || order.user),
      customer_email: String(
        currentUser?.email || order.shippingAddress?.email || '',
      ),
      metadata: sessionMetadata,
    });

    order.stripeSessionId = session.id;
    await order.save();

    return session;
  }

  private async recordCouponUsageIfApplicable(
    couponCode?: string,
  ): Promise<void> {
    if (!couponCode || couponCode === 'STRIPECOUPON') {
      return;
    }
    await this.couponsService.recordUsage(couponCode).catch((err) => {
      this.logger.warn(`Failed to record coupon usage for ${couponCode}:`, err);
    });
  }

  private async generateShopOrderNumber(
    _country: string,
    flow: ShopOrderFlow,
  ): Promise<string> {
    const nextSequence = await this.getNextShopOrderSequence(flow);
    return formatShopOrderNumber(flow, nextSequence);
  }

  private async getNextShopOrderSequence(
    flow: ShopOrderFlow,
  ): Promise<number> {
    const prefix = getShopOrderPrefix(flow);
    const matchingOrders = await this.orderModel
      .find({
        orderFlow: flow,
        orderNumber: { $regex: new RegExp(`^${prefix}\\d+$`, 'i') },
      })
      .select('orderNumber orderFlow')
      .lean()
      .exec();

    return getNextShopOrderSequenceForFlow(
      matchingOrders.map((order) => ({
        orderNumber: (order as { orderNumber?: string }).orderNumber,
        orderFlow: (order as { orderFlow?: ShopOrderFlow }).orderFlow,
      })),
      flow,
    );
  }

  private async generateRegistrationOrderNumber(): Promise<string> {
    const matchingOrders = await this.orderModel
      .find({ orderNumber: { $regex: /^SGREG\d+$/i } })
      .select('orderNumber')
      .lean()
      .exec();

    const nextNumber = getNextRegistrationOrderSequence(
      matchingOrders.map(
        (order) => (order as { orderNumber?: string }).orderNumber,
      ),
    );
    return formatRegistrationOrderNumber(nextNumber);
  }
}
