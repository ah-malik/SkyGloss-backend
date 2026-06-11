import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
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
import { ProductGroup, ProductGroupDocument } from '../product-groups/entities/product-group.entity';
import { RegistrationFeesService } from '../registration-fees/registration-fees.service';
import { calculateShippingFee, getShippingRegion, SHIPPING_FEE_AMOUNT } from '../common/shipping-config';
import { getItemsSubtotal } from '../common/order-totals';
import {
  formatRoleLabel,
  getRegistrationFeeDescription,
  getRegistrationFeeName,
} from '../common/role-labels';
import { PdfService } from '../pdf/pdf.service';
import {
  calculateCommissionEntries,
  resolveShopCommissionChain,
} from '../common/commission-distribution';

const USA_COUNTRIES = ['united states', 'usa', 'us', 'united states of america'];
const PENDING_PAYMENT_CANCEL_DAYS = 3;
const PAYMENT_REMINDER_INTERVALS_MS = [
  24 * 60 * 60 * 1000,
  48 * 60 * 60 * 1000,
];

@Injectable()
export class OrdersService {
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
    return orderCurrency;
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
    const success_path = type === 'shop_registration' ? '/login/shop?payment_success=true' : '/login/partner?payment_success=true';
    const cancel_path = type === 'shop_registration' ? '/register/shop?payment_canceled=true' : '/register/partner?payment_canceled=true';

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

    const { items, shippingAddress } = createOrderDto;

    // Calculate total amount from items
    // Note: In a real app, we should fetch product prices from DB to secure against client-side manipulation.
    // For this implementation, we'll use the prices sent from frontend but ensure strict types.
    const itemsSubtotal = getItemsSubtotal(items);
    const shippingCountry =
      shippingAddress?.country || currentUser?.country || '';
    const shippingFee = calculateShippingFee(shippingCountry, itemsSubtotal);

    let order: any;
    let retries = 3;
    while (retries > 0) {
      try {
        const orderNumber = await this.generateOrderNumber('SG');
        order = new this.orderModel({
          user: userId,
          items,
          totalAmount: itemsSubtotal + shippingFee,
          shippingFee,
          shippingAddress,
          status: isUsaUser ? OrderStatus.PENDING_PAYMENT : OrderStatus.PENDING,
          orderNumber,
          currency: orderCurrency.toUpperCase(),
          paymentReminderCount: 0,
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
    ];
    if (networkRoles.includes(viewer.role as UserRole)) {
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

  async createRegistrationOrder(user: any, stripeSessionOrId?: any, isCouponBypass: boolean = false): Promise<Order> {
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
    let discount = isCouponBypass ? subtotal : 0;
    let totalAmount = isCouponBypass ? 0 : subtotal;
    let couponCode = isCouponBypass ? 'CERTIFICATIONONUS' : undefined;
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

    const orderNumber = await this.generateOrderNumber('REG');

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
      totalAmount,
      discount,
      couponCode,
      shippingAddress,
      status: OrderStatus.PAID,
      orderNumber,
      currency,
      stripeSessionId,
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
          const regOrder = await this.createRegistrationOrder(updatedUser, session, false);
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
          await this.mailService.sendDistributorPaymentConfirmation(
            updatedUser.email,
            updatedUser,
            invoiceBuffer,
            orderNumber,
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
      const actualDiscount = (session.total_details?.amount_discount || 0) / 100;
      let couponCode = existingOrder?.couponCode;
      if (actualDiscount > 0.01 && !couponCode) {
        couponCode = 'STRIPECOUPON';
      }

      const updatedOrder = await this.orderModel
        .findByIdAndUpdate(
          orderId,
          { 
            status: OrderStatus.PAID,
            totalAmount: actualTotal,
            discount: actualDiscount,
            couponCode
          },
          { new: true },
        )
        .populate('user', 'firstName lastName email');

      if (updatedOrder) {
        console.log(`[USA Stripe Webhook] Order ${updatedOrder.orderNumber} marked as PAID.`);

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
            const regOrder = await this.createRegistrationOrder(updatedUser, session, false);
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
            await this.mailService.sendDistributorPaymentConfirmation(
              updatedUser.email,
              updatedUser,
              invoiceBuffer,
              orderNumber,
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
            const regOrder = await this.createRegistrationOrder(updatedUser, session, false);
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
            await this.mailService.sendDistributorPaymentConfirmation(
              updatedUser.email,
              updatedUser,
              invoiceBuffer,
              orderNumber,
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
        const actualDiscount = (session.total_details?.amount_discount || 0) / 100;
        let couponCode = existingOrder?.couponCode;
        if (actualDiscount > 0.01 && !couponCode) {
          couponCode = 'STRIPECOUPON';
        }

        const updatedOrder = await this.orderModel
          .findByIdAndUpdate(
            orderId,
            { 
              status: OrderStatus.PAID,
              totalAmount: actualTotal,
              discount: actualDiscount,
              couponCode
            },
            { new: true },
          )
          .populate('user', 'firstName lastName email');

        if (updatedOrder) {
          console.log(`[Stripe Webhook] Order ${updatedOrder.orderNumber} status updated to PAID.`);
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
      .populate('user', 'firstName lastName email role')
      .sort({ createdAt: -1 });
  }

  async getNetworkOrders(viewer: UserDocument): Promise<Order[]> {
    const { shops } = await this.usersService.findNetworkUsersForViewer(viewer);
    const shopIds = shops.map((shop) => shop._id);
    
    return await this.orderModel
      .find({ user: { $in: shopIds } } as any)
      .populate('user', 'firstName lastName email shopName role couponCode')
      .sort({ createdAt: -1 })
      .exec();
  }

  async applyOrderCommissions(
    orderId: string,
    newStatus: OrderStatus,
  ): Promise<void> {
    if (newStatus !== OrderStatus.PAID && newStatus !== OrderStatus.SHIPPED) {
      return;
    }

    const order = await this.orderModel.findById(orderId);
    if (!order) return;

    const shopUserId =
      typeof order.user === 'object' && order.user !== null && '_id' in (order.user as object)
        ? String((order.user as any)._id)
        : String(order.user);

    if (!shopUserId) return;

    const shopUser = await this.usersService.findOne(shopUserId);
    if (!shopUser || shopUser.role !== UserRole.CERTIFIED_SHOP) return;

    if (order.commissions && order.commissions.length > 0) {
      if (newStatus === OrderStatus.SHIPPED) {
        order.commissions = order.commissions.map((entry) => ({
          ...entry,
          status: 'earned' as const,
        }));
        await order.save();
      }
      return;
    }

    const chain = await resolveShopCommissionChain(shopUser, (code) =>
      this.usersService.findByPartnerCode(code),
    );
    const entries = calculateCommissionEntries(order.totalAmount, chain);
    const commissionStatus =
      newStatus === OrderStatus.SHIPPED ? ('earned' as const) : ('pending' as const);

    order.commissions = entries.map((entry) => ({
      ...entry,
      status: commissionStatus,
    }));
    await order.save();

    if (entries.length > 0) {
      console.log(
        `[Commission] Order ${order.orderNumber}: ${entries.length} recipient(s), status=${commissionStatus}`,
      );
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
      status === OrderStatus.PAID ||
      status === OrderStatus.SHIPPED
    ) {
      await this.applyOrderCommissions(updatedOrder._id.toString(), status);
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

      const { items, shippingAddress } = createOrderDto;
      
      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new BadRequestException('Order items are required');
      }

      const itemsSubtotal = getItemsSubtotal(items);
      const shippingCountry =
        shippingAddress?.country || currentUser?.country || '';
      const shippingFee = calculateShippingFee(shippingCountry, itemsSubtotal);
      const finalAmount = itemsSubtotal + shippingFee;

      let savedOrder;
      let retries = 3;
      while (retries > 0) {
        try {
          const orderNumber = await this.generateOrderNumber('REQ-');
          const order = new this.orderModel({
            user: userId,
            items,
            totalAmount: finalAmount,
            shippingFee,
            shippingAddress,
            status: OrderStatus.PENDING,
            orderNumber,
            currency: (orderCurrency || 'usd').toUpperCase(),
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
    // 1. Recent Orders (5)
    const recentOrders = await this.orderModel
      .find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'firstName lastName email');

    // 2. Total Revenue (Paid only)
    const totalRevenueResult = await this.orderModel.aggregate([
      { $match: { status: OrderStatus.PAID } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]);
    const totalRevenue = totalRevenueResult[0]?.total || 0;

    // 3. Daily Sales (Last 7 Days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const dailySales = await this.orderModel.aggregate([
      {
        $match: {
          status: OrderStatus.PAID,
          createdAt: { $gte: sevenDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          sales: { $sum: '$totalAmount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Fill in missing days
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
      recentOrders,
      totalRevenue,
      chartData,
    };
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
    const shippingFee =
      order.shippingFee != null && order.shippingFee >= 0
        ? order.shippingFee
        : Math.max(0, order.totalAmount - itemsSubtotal);
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
            unit_amount: Math.round(Number(item.price || 0) * 100),
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

  private async generateOrderNumber(prefix: string): Promise<string> {
    // Find ALL orders with this prefix and determine the true max number
    const matchingOrders = await this.orderModel
      .find({ orderNumber: new RegExp(`^${prefix}`) })
      .select('orderNumber')
      .lean()
      .exec();

    let maxNum = 0;
    for (const o of matchingOrders) {
      const numPart = (o as any).orderNumber.replace(prefix, '');
      const num = parseInt(numPart, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }

    let nextNumber = maxNum + 1;
    if (nextNumber === 1 && prefix === 'REQ-') {
      nextNumber = 254701;
    }

    return `${prefix}${nextNumber.toString().padStart(6, '0')}`;
  }
}
