import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Order, OrderDocument, OrderStatus } from './entities/order.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationType } from '../notifications/entities/notification.entity';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { UserRole, UserStatus } from '../users/entities/user.entity';

@Injectable()
export class OrdersService {
  private stripe: Stripe;

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
    private usersService: UsersService,
    private mailService: MailService,
  ) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
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

    const europeanCountries = [
      'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech republic', 'denmark', 
      'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'ireland', 'italy', 
      'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'poland', 'portugal', 
      'romania', 'slovakia', 'slovenia', 'spain', 'sweden', 'united kingdom', 
      'switzerland', 'norway', 'iceland', 'liechtenstein', 'monaco', 'san marino', 'andorra'
    ];

    const normalizedCountry = country.toLowerCase().trim();

    if (normalizedCountry === 'australia' || normalizedCountry === 'new zealand') {
      currency = 'aud';
      unit_amount = 198000; // 1,980.00 AUD (1800 base + 180 tax)
    } else if (europeanCountries.includes(normalizedCountry)) {
      currency = 'eur';
      unit_amount = 25000; // 250.00 EUR
    }

    try {
      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency,
              product_data: {
                name: type === 'shop_registration' ? 'Shop Registration Fee' : 'Partner Registration Fee',
                description: type === 'shop_registration' 
                  ? 'One-time fee to activate your SkyGloss Shop account.' 
                  : 'One-time fee to activate your SkyGloss partner account.',
              },
              unit_amount,
            },
            quantity: 1,
          },
        ],
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
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured on the server.');
    }

    const { items, shippingAddress } = createOrderDto;

    // Calculate total amount from items
    // Note: In a real app, we should fetch product prices from DB to secure against client-side manipulation.
    // For this implementation, we'll use the prices sent from frontend but ensure strict types.
    const totalAmount = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const orderNumber = await this.generateOrderNumber('SG');
    const order = new this.orderModel({
      user: userId,
      items,
      totalAmount,
      shippingAddress,
      status: OrderStatus.PENDING,
      orderNumber,
    });

    try {
      // Determine baseUrl once
      let baseUrl = (this.configService.get<string>('FRONTEND_URL') || '').replace(/\/+$/, '');
      if (!baseUrl) {
        baseUrl = process.env.NODE_ENV === 'production' 
          ? 'https://portal.skygloss.com' 
          : 'http://localhost:3000'; // Default for local
      }

      // Create Stripe Line Items with aggressive sanitization
      const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] =
        items.map((item) => {
          // Stripe images must be publicly accessible URLs. 
          // Base64 or local paths will cause errors.
          const images: string[] = [];
          if (item.image && typeof item.image === 'string' && item.image.startsWith('http')) {
            images.push(item.image);
          }

          return {
            price_data: {
              currency: 'usd',
              product_data: {
                name: String(item.name || 'Product'),
                images: images,
                metadata: {
                  size: String(item.size || ''),
                  productId: String(item.product || ''),
                },
              },
              unit_amount: Math.round(Number(item.price || 0) * 100), // cents
            },
            quantity: Math.max(1, Number(item.quantity || 1)),
          };
        });

      // Add shipping cost (Free shipping)
      const shippingRate = 0;
      line_items.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Shipping (Free)',
          },
          unit_amount: shippingRate,
        },
        quantity: 1,
      });

      // Add Tax (8% approx matching frontend)
      const taxAmount = Math.round(totalAmount * 100 * 0.08);
      if (taxAmount > 0) {
        line_items.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Tax (Estimated)',
            },
            unit_amount: taxAmount,
          },
          quantity: 1,
        });
      }

      // Prepare metadata carefully (max 50 keys, 500 chars per value)
      const sessionMetadata = {
        orderId: String(order._id),
        type: 'shop_order',
      };

      console.log('[Stripe Session] Creating with metadata:', JSON.stringify(sessionMetadata));
      console.log('[Stripe Session] Line items count:', line_items.length);

      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: line_items,
        mode: 'payment',
        success_url: `${baseUrl}/dashboard/shop?success=true&order_id=${order._id}`,
        cancel_url: `${baseUrl}/dashboard/shop?canceled=true`, // Fixed to match shop path
        client_reference_id: String(userId),
        customer_email: String(shippingAddress.email || ''),
        metadata: sessionMetadata,
      });

      order.stripeSessionId = session.id;
      // Update total to include shipping/tax
      order.totalAmount = (totalAmount * 100 + shippingRate + taxAmount) / 100;

      await order.save();

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

  async getOrderById(id: string): Promise<Order> {
    const order = await this.orderModel
      .findById(id)
      .populate('user', 'firstName lastName email role');
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  // Webhook handler will reuse logic or be separate.
  // For now, let's implement a verify endpoint for manual success check if webhook fails/delays
  async verifyPayment(orderId: string): Promise<Order> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    if (!order.stripeSessionId) return order;

    const session = await this.stripe.checkout.sessions.retrieve(
      order.stripeSessionId,
    );
    if (session.payment_status === 'paid') {
      order.status = OrderStatus.PAID;
      await order.save();
    } else if (session.status === 'expired' || session.status === 'open') {
      // If open but timed out or explicitly expired
      if (session.status === 'expired') {
        order.status = OrderStatus.FAILED;
        await order.save();
      }
    }
    return order;
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
            );
          }

          const notification = await this.notificationsService.create({
            type: NotificationType.ORDER_PAID,
            title: 'Partner Registration Paid',
            message: `User ${updatedUser.firstName} ${updatedUser.lastName} has paid the registration fee and is now active.`,
            metadata: { userId: updatedUser._id },
            user: updatedUser._id as any,
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

        const updatedOrder = await this.orderModel
          .findByIdAndUpdate(
            orderId,
            { status: OrderStatus.PAID },
            { new: true },
          )
          .populate('user', 'firstName lastName');

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
            link: `/orders/${updatedOrder._id}`,
          });
          this.notificationsGateway.broadcastNotification(notification);
          
          // Send Email to sales@skygloss.com
          await this.mailService.sendNewOrderNotification(updatedOrder, updatedOrder.user).catch(err => {
             console.error('Failed to send order email to sales', err);
          });
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
        console.log(`[Stripe Webhook] Marking order ${orderId} as FAILED due to event: ${event.type}`);
        await this.orderModel.findByIdAndUpdate(orderId, {
          status: OrderStatus.FAILED,
        });
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

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    const order = await this.orderModel.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    );
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async createOrderRequest(userId: string, createOrderDto: CreateOrderDto) {
    const { items, shippingAddress } = createOrderDto;
    const totalAmount = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    // Calculate final mount with shipping and tax to match record keeping
    const shippingRate = 0;
    const taxRate = 0.08;
    const finalAmount = totalAmount + shippingRate + totalAmount * taxRate;

    const orderNumber = await this.generateOrderNumber('REQ-');
    const order = new this.orderModel({
      user: userId,
      items,
      totalAmount: finalAmount,
      shippingAddress,
      status: OrderStatus.PENDING,
      orderNumber,
    });

    const savedOrder = await order.save();

    // Create notification for admin
    const notification = await this.notificationsService.create({
      type: NotificationType.ORDER_PLACED,
      title: 'New Order Request',
      message: `A new order request ${savedOrder.orderNumber} has been submitted.`,
      metadata: {
        orderId: savedOrder._id,
        orderNumber: savedOrder.orderNumber,
      },
      user: userId,
      link: `/orders/${savedOrder._id}`,
    });
    this.notificationsGateway.broadcastNotification(notification);

    // Send Email to sales@skygloss.com
    const user = await this.usersService.findOne(userId);
    if (user) {
      await this.mailService.sendNewOrderRequestNotification(savedOrder, user).catch(err => {
        console.error('Failed to send order request email to sales', err);
      });
    }

    return savedOrder;
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

  private async generateOrderNumber(prefix: string): Promise<string> {
    const count = await this.orderModel.countDocuments();
    return `${prefix}${(count + 1).toString().padStart(6, '0')}`;
  }
}
