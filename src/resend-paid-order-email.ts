/**
 * Resend paid-order confirmation + sales notification (idempotent).
 * Run: npx ts-node --transpile-only src/resend-paid-order-email.ts SGUSAP0173
 */
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from './app.module';
import { OrdersService } from './orders/orders.service';
import { Order } from './orders/entities/order.entity';
import { MailService } from './mail/mail.service';

dotenv.config();

async function bootstrap() {
  const orderNumber = (process.argv[2] || 'SGUSAP0173').trim();
  const app = await NestFactory.createApplicationContext(AppModule);
  const orderModel = app.get<Model<any>>(getModelToken(Order.name));
  const ordersService = app.get(OrdersService);
  const mailService = app.get(MailService);

  const order = await orderModel
    .findOne({ orderNumber })
    .populate('user', 'firstName lastName email')
    .exec();

  if (!order) {
    console.error(`Order not found: ${orderNumber}`);
    await app.close();
    process.exit(1);
  }

  const userDoc =
    typeof order.user === 'object' && order.user !== null
      ? order.user
      : null;
  const customerEmail = mailService.resolveCustomerEmail(order, userDoc);

  console.log('Order:', order.orderNumber);
  console.log('Status:', order.status);
  console.log('Customer email:', customerEmail || '(none)');
  console.log(
    'paidConfirmationEmailSentAt:',
    order.paidConfirmationEmailSentAt || null,
  );

  const sent = await ordersService.sendPaidOrderNotificationsIfNeeded(
    order._id.toString(),
  );
  console.log(sent ? 'Confirmation email sent.' : 'No email sent (see logs).');

  await app.close();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
