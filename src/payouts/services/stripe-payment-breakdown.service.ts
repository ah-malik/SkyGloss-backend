import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../../orders/entities/order.entity';
import { buildStripePaymentBreakdown } from '../stripe-payment-breakdown.logic';

@Injectable()
export class StripePaymentBreakdownService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  async getBreakdown(currency = 'USD') {
    const orders = await this.orderModel
      .find({
        status: OrderStatus.PAID,
        stripeSessionId: { $exists: true, $nin: [null, ''] },
      })
      .populate('user', 'country')
      .select(
        'orderNumber items totalAmount baseCurrencyAmount shippingAddress stripeSessionId user',
      )
      .lean()
      .exec();

    return buildStripePaymentBreakdown(orders as any[], currency);
  }
}
