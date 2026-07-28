/**
 * Send a latest-template test email to it@skygloss.com
 * Run: npx ts-node --transpile-only test-send-latest-email.ts
 */
import * as nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import { buildLatestOrderRequestCustomerHtml } from './src/mail/templates/latest-order-request-emails';
import { resolveShopFooterContact } from './src/mail/templates/latest-shared';

dotenv.config();

const {
  loadShopAndRepresentative,
  disconnect,
} = require('./email-draft-resolve-representative');

async function main() {
  const sampleOrder = {
    orderNumber: 'SG-TEST-LATEST',
    currency: 'USD',
    totalAmount: 95,
    shippingFee: 0,
    items: [
      {
        name: 'FUSION 250',
        size: '250mL',
        orderType: 'unit',
        quantity: 1,
        price: 95,
      },
    ],
    shippingAddress: {
      name: 'Test User',
      line1: '123 Test Street',
      city: 'Madrid',
      state: '',
      zip: '28001',
      country: 'Spain',
    },
  };

  const sampleUser = {
    firstName: 'Test',
    lastName: 'User',
    email: 'it@skygloss.com',
    companyName: 'SkyGloss IT',
    role: 'certified_shop',
  };

  let footerContact = resolveShopFooterContact(sampleUser, null);
  try {
    const { shop, representative } = await loadShopAndRepresentative('it@skygloss.com');
    footerContact = resolveShopFooterContact(shop || sampleUser, representative);
  } finally {
    await disconnect().catch(() => {});
  }

  const html = buildLatestOrderRequestCustomerHtml(
    sampleOrder,
    sampleUser,
    footerContact,
  );

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'sales@skygloss.com',
      pass: 'wsux didm itaa zeds',
    },
  });

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const info = await transporter.sendMail({
    from: '"SkyGloss Portal" <sales@skygloss.com>',
    to: 'it@skygloss.com',
    subject: `[TEST LATEST] Order Request Received – ${sampleOrder.orderNumber} – ${stamp}`,
    html,
  });

  console.log('Latest template test email sent to it@skygloss.com');
  console.log('Footer:', footerContact.name, `(${footerContact.title})`);
  console.log('SMTP response:', info.response);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
