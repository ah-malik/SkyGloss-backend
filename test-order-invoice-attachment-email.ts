/**
 * Test: order confirmation email WITH real invoice PDF attachment.
 * Sends only to it@skygloss.com.
 *
 * Run: npx ts-node --transpile-only test-order-invoice-attachment-email.ts
 */
import * as dotenv from 'dotenv';
import * as nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import { PdfService } from './src/pdf/pdf.service';
import { buildLatestOrderPaidHtml } from './src/mail/templates/latest-order-emails';
import { resolveShopFooterContact } from './src/mail/templates/latest-shared';

dotenv.config();

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI missing in .env');
  }

  const mailUser = process.env.MAIL_USER || 'sales@skygloss.com';
  const mailPass = process.env.MAIL_PASS;
  if (!mailPass) {
    throw new Error('MAIL_PASS missing in .env');
  }

  await mongoose.connect(mongoUri);
  const orderCol = mongoose.connection.collection('orders');
  const requested = (process.argv[2] || '').trim();

  const order = requested
    ? await orderCol.findOne({ orderNumber: requested })
    : await orderCol.findOne(
        {
          orderNumber: { $exists: true, $ne: null },
          items: { $exists: true, $ne: [] },
        },
        { sort: { createdAt: -1 } },
      );

  if (!order) {
    throw new Error('No order found to build invoice PDF');
  }

  const pdfService = new PdfService();
  const invoiceBuffer = await pdfService.generateOrderDetails(order as any);
  const orderNumber = String(order.orderNumber);
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const recipient = {
    firstName: order.shippingAddress?.firstName || 'Test',
    lastName: order.shippingAddress?.lastName || 'Recipient',
    email: 'it@skygloss.com',
    companyName: order.shippingAddress?.companyName || 'SkyGloss IT',
    role: 'certified_shop',
  };

  const footerContact = resolveShopFooterContact(recipient, null);
  const html = buildLatestOrderPaidHtml(
    { ...order, orderNumber: `${orderNumber}-TEST` },
    recipient,
    footerContact,
  );

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: mailUser, pass: mailPass },
  });

  const info = await transporter.sendMail({
    from: `"SkyGloss Portal" <sales@skygloss.com>`,
    to: 'it@skygloss.com',
    subject: `[TEST] Order Confirmation + Invoice PDF – ${orderNumber} – ${stamp}`,
    html,
    attachments: [
      {
        filename: `Invoice_${orderNumber}.pdf`,
        content: invoiceBuffer,
      },
    ],
  });

  console.log('Order used:', orderNumber);
  console.log('PDF bytes:', invoiceBuffer.length);
  console.log('Sent to it@skygloss.com');
  console.log('MessageId:', info.messageId);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
