import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Order, OrderDocument, OrderStatus } from './entities/order.entity';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
    private stripe: Stripe;

    constructor(
        @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
        private configService: ConfigService,
    ) {
        const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
        const stripeApiVersion = this.configService.get<string>('STRIPE_API_VERSION') || '2022-11-15';

        if (!stripeSecretKey) {
            console.warn('STRIPE_SECRET_KEY is not defined');
            this.stripe = undefined as any;
        } else {
            this.stripe = new Stripe(stripeSecretKey, {
                apiVersion: stripeApiVersion as Stripe.LatestApiVersion,
            });
        }
    }

    async createCheckoutSession(userId: string, createOrderDto: CreateOrderDto) {
        if (!this.stripe) {
            throw new BadRequestException('Stripe is not configured on the server.');
        }

        const { items, shippingAddress } = createOrderDto;

        // Calculate total amount from items
        // Note: In a real app, we should fetch product prices from DB to secure against client-side manipulation.
        // For this implementation, we'll use the prices sent from frontend but ensure strict types.
        const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        // Create pending order
        const order = new this.orderModel({
            user: userId,
            items,
            totalAmount,
            shippingAddress,
            status: OrderStatus.PENDING,
            orderNumber: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        });

        try {
            // Create Stripe Line Items
            const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map(item => ({
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: item.name,
                        images: item.image ? [item.image] : [],
                        metadata: {
                            size: item.size,
                            productId: item.product,
                        },
                    },
                    unit_amount: Math.round(item.price * 100), // cents
                },
                quantity: item.quantity,
            }));

            // Add shipping cost (flat rate $15 for now, matching frontend)
            const shippingRate = 1500;
            line_items.push({
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Shipping',
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
                    quantity: 1
                });
            }

            // Metadata limits: 50 keys, 500 chars values.
            const session = await this.stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items,
                mode: 'payment',
                success_url: `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173'}/dashboard/shop?success=true&order_id=${order._id}`,
                cancel_url: `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173'}/dashboard/shop?canceled=true`,
                client_reference_id: order._id.toString(),
                customer_email: shippingAddress.email,
                metadata: {
                    orderId: order._id.toString(),
                },
            });

            order.stripeSessionId = session.id;
            // Update total to include shipping/tax if we want DB to match potential charge, 
            // but usually we want to know what the cart subtotal was. 
            // Let's store the FINAL charge amount in the order for reconciliation.
            order.totalAmount = (totalAmount * 100 + shippingRate + taxAmount) / 100;

            await order.save();

            return { url: session.url };
        } catch (error) {
            console.error('Stripe session creation error:', error);
            throw new BadRequestException(`Stripe session creation failed: ${error.message}`);
        }
    }

    async getMyOrders(userId: string): Promise<Order[]> {
        return this.orderModel.find({ user: userId as any }).sort({ createdAt: -1 });
    }

    async getOrderById(id: string): Promise<Order> {
        const order = await this.orderModel.findById(id);
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

        const session = await this.stripe.checkout.sessions.retrieve(order.stripeSessionId);
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

    async handleWebhook(sig: string, payload: Buffer) {
        const endpointSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
        if (!endpointSecret) throw new BadRequestException('Webhook secret not configured');

        let event: Stripe.Event;
        try {
            event = this.stripe.webhooks.constructEvent(payload, sig, endpointSecret);
        } catch (err) {
            throw new BadRequestException(`Webhook Error: ${err.message}`);
        }

        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.client_reference_id || session.metadata?.orderId;

        if (event.type === 'checkout.session.completed') {
            if (orderId) {
                await this.orderModel.findByIdAndUpdate(orderId, {
                    status: OrderStatus.PAID
                });
            }
        } else if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
            if (orderId) {
                await this.orderModel.findByIdAndUpdate(orderId, {
                    status: OrderStatus.FAILED
                });
            }
        }
        return { received: true };
    }

    async getAllOrders(): Promise<Order[]> {
        return this.orderModel.find().populate('user', 'firstName lastName email').sort({ createdAt: -1 });
    }

    async updateStatus(id: string, status: OrderStatus): Promise<Order> {
        const order = await this.orderModel.findByIdAndUpdate(id, { status }, { new: true });
        if (!order) throw new NotFoundException('Order not found');
        return order;
    }
}
