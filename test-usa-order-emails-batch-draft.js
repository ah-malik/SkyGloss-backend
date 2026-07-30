/**
 * DRAFT USA order emails â€“ visual test only (batch).
 * Does NOT replace live templates in mail.service.ts.
 *
 * Includes:
 *  1. USA Order Shipped
 *  2. USA Order Cancellation
 *  3. USA Hub / Representative / Distributor / Promoter â€“ order before payment
 *  4. USA Shop Order Payment Reminder (daily x3 days, then cart cleared)
 *
 * Run: node test-usa-order-emails-batch-draft.js
 * Sends to: it@skygloss.com only
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './.env' });

const ASSETS = {
  blueLogoHeader:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784290766/svnkjkigtjacvlsoiktt.png',
  footerWhite:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204256/fsxmdvqtln4zsejc8c53.png',
  footerWhiteCar:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204545/gxnxmjx9e6d48x3u7ifr.png',
};

const BRAND_BLUE = '#00AEEF';
const WIDTH = 600;
const PAY_URL = 'https://portal.skygloss.com/login/shop';

const sampleItems = [
  { name: 'SkyGloss Fusion Kit', size: 'Standard', orderType: 'Kit', quantity: 2, price: 249.0 },
  { name: 'SkyGloss Compound', size: '1L', orderType: 'Product', quantity: 1, price: 89.0 },
];

const sampleCustomer = {
  name: 'Test User',
  firstName: 'Test',
  email: 'it@skygloss.com',
  company: 'SkyGloss IT',
  roleLabel: 'Hub', // Hub | Representative | Distributor | Promoter
};

const sampleAddress = {
  name: 'Test User',
  line1: '1234 Innovation Drive',
  line2: 'Suite 200',
  city: 'Phoenix',
  state: 'AZ',
  zip: '85001',
  country: 'United States',
};

function formatMoney(symbol, amount) {
  return `${symbol}${Number(amount).toFixed(2)}`;
}

function buildOrderItemsHtml(items, symbol) {
  return items
    .map((item) => {
      const lineTotal = item.price * item.quantity;
      return `
      <tr>
        <td style="padding:12px 0; border-bottom:1px solid #e8eef3; font-size:14px; line-height:1.45; color:#000000; vertical-align:top;">
          <strong style="font-weight:bold; color:#000000;">${item.name}</strong>
          ${item.size ? `<br><span style="font-size:12px; color:#666666;">Size: ${item.size}</span>` : ''}
          ${item.orderType ? `<br><span style="font-size:12px; color:#666666;">Type: ${item.orderType}</span>` : ''}
        </td>
        <td align="center" style="padding:12px 8px; border-bottom:1px solid #e8eef3; font-size:14px; color:#000000; vertical-align:top; white-space:nowrap;">${item.quantity}</td>
        <td align="right" style="padding:12px 0; border-bottom:1px solid #e8eef3; font-size:14px; color:#000000; vertical-align:top; white-space:nowrap;">${formatMoney(symbol, lineTotal)}</td>
      </tr>`;
    })
    .join('');
}

function totalsBlock(symbol, currency, subtotal, shipping, totalLabel) {
  const total = subtotal + shipping;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
      <tbody>
        <tr>
          <td align="right" style="padding:4px 12px 4px 0; font-size:14px; color:#666666;">Subtotal</td>
          <td align="right" width="110" style="padding:4px 0; font-size:14px; font-weight:bold; color:#000000;">${formatMoney(symbol, subtotal)}</td>
        </tr>
        <tr>
          <td align="right" style="padding:4px 12px 4px 0; font-size:14px; color:#666666;">Shipping</td>
          <td align="right" width="110" style="padding:4px 0; font-size:14px; font-weight:bold; color:#000000;">${formatMoney(symbol, shipping)}</td>
        </tr>
        <tr>
          <td align="right" style="padding:12px 12px 0 0; font-size:16px; font-weight:bold; color:#000000; border-top:2px solid ${BRAND_BLUE};">${totalLabel}</td>
          <td align="right" width="110" style="padding:12px 0 0 0; font-size:16px; font-weight:bold; color:${BRAND_BLUE}; border-top:2px solid ${BRAND_BLUE};">
            ${formatMoney(symbol, total)} <span style="font-size:11px; color:#666666; font-weight:normal;">${currency}</span>
          </td>
        </tr>
      </tbody>
    </table>`;
}

function itemsSummarySection(title, items, symbol, currency, shipping, totalLabel) {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  return `
    <tr>
      <td bgcolor="#ffffff" style="padding:28px 40px 8px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif;">
        <p style="margin:0 0 14px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">${title}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tbody>
            <tr>
              <td style="padding:0 0 8px 0; font-size:11px; font-weight:bold; letter-spacing:0.5px; color:#888888; text-transform:uppercase; border-bottom:2px solid #e8eef3;">Item</td>
              <td align="center" style="padding:0 8px 8px 8px; font-size:11px; font-weight:bold; letter-spacing:0.5px; color:#888888; text-transform:uppercase; border-bottom:2px solid #e8eef3;">Qty</td>
              <td align="right" style="padding:0 0 8px 0; font-size:11px; font-weight:bold; letter-spacing:0.5px; color:#888888; text-transform:uppercase; border-bottom:2px solid #e8eef3;">Total</td>
            </tr>
            ${buildOrderItemsHtml(items, symbol)}
          </tbody>
        </table>
        ${totalsBlock(symbol, currency, subtotal, shipping, totalLabel)}
      </td>
    </tr>`;
}

function footerBlocks() {
  return `
          <tr>
            <td bgcolor="#000000" style="padding:0; background-color:#000000;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tbody><tr>
                  <td width="40%" valign="middle" bgcolor="#000000" style="width:40%; padding:28px 22px; background-color:#000000; vertical-align:middle;">
                    <p style="margin:0 0 4px 0; font-family: Arial, Helvetica, sans-serif; font-size:13px; font-weight:bold; color:#ffffff; letter-spacing:0.5px;">SkyGloss Global</p>
                    <p style="margin:0 0 10px 0; font-family: Arial, Helvetica, sans-serif; font-size:12px; font-weight:bold; color:${BRAND_BLUE}; letter-spacing:0.5px;">Certification Department</p>
                    <p style="margin:0 0 4px 0; font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#ffffff;">+1 602 784 4113</p>
                    <p style="margin:0; font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#ffffff;">
                      <a href="mailto:certified@skygloss.com" style="color:#ffffff; text-decoration:none;">Certified@skygloss.com</a>
                    </p>
                  </td>
                  <td width="60%" valign="middle" bgcolor="#000000" style="width:60%; padding:0; background-color:#000000; vertical-align:middle;">
                    <img src="${ASSETS.footerWhiteCar}" alt="SkyGloss team" width="350" style="display:block; width:100%; max-width:368px; height:auto; border:0;">
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#000000" style="padding:20px 0; background-color:#000000;">
              <img src="${ASSETS.footerWhite}" alt="SKYGLOSS" width="${WIDTH}" style="display:block; width:100%; max-width:${WIDTH}px; height:auto; border:0; padding:0; margin:0;">
            </td>
          </tr>`;
}

function wrapEmail(title, bodyRows, draftNote) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
  <!--[if mso]>
  <style type="text/css">body, table, td { font-family: Arial, Helvetica, sans-serif !important; }</style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#e8e8e8; font-family: Arial, Helvetica, sans-serif; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#e8e8e8" style="margin:0; padding:0; width:100%; background-color:#e8e8e8;">
    <tbody><tr>
      <td align="center" style="padding:0;">
        <table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:${WIDTH}px; max-width:${WIDTH}px; margin:0 auto; background-color:#ffffff;">
          <tbody>
          <tr>
            <td bgcolor="#ffffff" style="padding:20px 0; background-color:#ffffff;">
              <img src="${ASSETS.blueLogoHeader}" alt="SKYGLOSS" width="${WIDTH}" style="display:block; width:100%; max-width:${WIDTH}px; height:auto; border:0; outline:none; text-decoration:none; padding:0; margin:0;">
            </td>
          </tr>
          ${bodyRows}
          <tr>
            <td bgcolor="${BRAND_BLUE}" style="padding:36px; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65;">
              <p style="margin:0 0 14px 0; color:#ffffff;">Thank you for choosing SkyGloss.</p>
              <p style="margin:0; color:#ffffff;">Best Regards,<br>The SkyGloss Team</p>
            </td>
          </tr>
          ${footerBlocks()}
          </tbody>
        </table>
        <table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${WIDTH}px; max-width:${WIDTH}px;">
          <tbody><tr>
            <td style="padding:16px 8px; font-family: Arial, Helvetica, sans-serif; font-size:11px; color:#888888; text-align:center;">${draftNote}</td>
          </tr></tbody>
        </table>
      </td>
    </tr></tbody>
  </table>
</body>
</html>`;
}

function pillCta(href, label) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0 0;">
      <tbody><tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tbody><tr>
              <td align="center" bgcolor="${BRAND_BLUE}" style="background-color:${BRAND_BLUE}; border-radius:40px; mso-padding-alt:14px 32px;">
                <a href="${href}" target="_blank" style="display:inline-block; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:13px; font-weight:bold; letter-spacing:0.6px; text-decoration:none; padding:14px 32px; border-radius:40px; border:1px solid ${BRAND_BLUE}; text-transform:uppercase;">${label}</a>
              </td>
            </tr></tbody>
          </table>
        </td>
      </tr></tbody>
    </table>`;
}

function detailsCard(title, rowsHtml) {
  return `
    <tr>
      <td bgcolor="#ffffff" style="padding:22px 40px 8px 40px; background-color:#ffffff;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
          <tbody><tr>
            <td width="4" bgcolor="${BRAND_BLUE}" style="width:4px; background-color:${BRAND_BLUE}; font-size:0; line-height:0;">&nbsp;</td>
            <td bgcolor="#f5f9fc" style="background-color:#f5f9fc; padding:18px 20px; font-family: Arial, Helvetica, sans-serif; color:#000000;">
              <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">${title}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody>${rowsHtml}</tbody></table>
            </td>
          </tr></tbody>
        </table>
      </td>
    </tr>`;
}

function detailRow(label, value, isLast) {
  return `
    <tr>
      <td style="padding:0 ${isLast ? '0' : '0 0 8px 0'}; font-size:14px; line-height:1.5; color:#000000;">
        <span style="color:#666666;">${label}</span><br>
        <strong style="font-weight:bold; color:#000000;">${value}</strong>
      </td>
    </tr>`;
}

function copyBlock(paragraphs) {
  const html = paragraphs
    .map(
      (p, i) =>
        `<p style="margin:0 ${i === paragraphs.length - 1 ? '0' : '0 0 18px 0'}; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">${p}</p>`,
    )
    .join('');
  return `
    <tr>
      <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
        ${html}
      </td>
    </tr>`;
}

function shippingAddressBlock(addr) {
  return `
    <tr>
      <td bgcolor="#ffffff" style="padding:28px 40px 8px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif;">
        <p style="margin:0 0 10px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Shipping To</p>
        <p style="margin:0; font-size:14px; line-height:1.6; color:#000000;">
          <strong style="font-weight:bold;">${addr.name}</strong><br>
          ${addr.line1}<br>
          ${addr.line2 ? `${addr.line2}<br>` : ''}
          ${addr.city}, ${addr.state} ${addr.zip}<br>
          ${addr.country}
        </p>
      </td>
    </tr>`;
}

function helpBlock(text) {
  return `
    <tr>
      <td bgcolor="#ffffff" style="padding:28px 40px 36px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; color:#000000;">
        <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Need Help?</p>
        <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">${text}</p>
      </td>
    </tr>`;
}

// â”€â”€â”€ 1. USA Order Shipped â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildUsaShippedHtml() {
  const orderNumber = 'SGUSAP0117';
  const shipping = 25;
  const trackingUrl = 'https://www.fedex.com/fedextrack/?trknbr=794612345678';

  const body = [
    copyBlock([
      `Hello ${sampleCustomer.name},`,
      `<strong style="font-weight:bold; color:#000000;">Your order is on its way.</strong>`,
      `Great News! Your SkyGloss order has shipped and is heading your way.`,
      `You can track your package using the carrier details below. Delivery times may vary by carrier and destination.`,
    ]),
    detailsCard(
      'Tracking Details',
      detailRow('Order Number', orderNumber) +
        detailRow('Carrier', 'FedEx') +
        detailRow('Tracking Number', '7946 1234 5678', true) +
        `<tr><td style="padding:16px 0 0 0;">${pillCta(trackingUrl, 'TRACK YOUR PACKAGE')}</td></tr>`,
    ),
    itemsSummarySection('Shipped Items', sampleItems, '$', 'USD', shipping, 'Total'),
    shippingAddressBlock(sampleAddress),
    helpBlock(
      `If you have any questions about your U.S. shipment, contact <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a> and include your order number.`,
    ),
  ].join('');

  return wrapEmail(
    'USA Order Shipped â€“ SkyGloss',
    body,
    'DRAFT TEMPLATE â€“ for testing only. Not the live USA order shipped email.',
  );
}

// â”€â”€â”€ 2. USA Order Cancellation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildUsaCancellationHtml() {
  const orderNumber = 'SGUSAP0117';
  const shipping = 25;
  const wasPaid = true;

  const body = [
    copyBlock([
      `Hello ${sampleCustomer.name},`,
      `<strong style="font-weight:bold; color:#000000;">Your order has been cancelled.</strong>`,
      `We're writing to confirm that order <strong style="font-weight:bold;">${orderNumber}</strong> has been cancelled and will not be processed further.`,
      wasPaid
        ? `If payment was collected, the total amount will be refunded to your original payment method. Please allow a few days for the funds to appear in your account.`
        : `No payment was received for this order. You can place a new order at any time from your SkyGloss Portal.`,
    ]),
    detailsCard(
      'Cancellation Details',
      detailRow('Order Number', orderNumber) +
        detailRow('Email', sampleCustomer.email) +
        detailRow('Company', sampleCustomer.company) +
        detailRow('Reason', 'Cancelled at customer request.', true),
    ),
    itemsSummarySection(
      'Cancelled Order Summary',
      sampleItems,
      '$',
      'USD',
      shipping,
      wasPaid ? 'Amount Refunded' : 'Order Total',
    ),
    helpBlock(
      `Questions about this cancellation or refund? Contact <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a> with your order number.`,
    ),
  ].join('');

  return wrapEmail(
    'USA Order Cancelled â€“ SkyGloss',
    body,
    'DRAFT TEMPLATE â€“ for testing only. Not the live USA order cancellation email.',
  );
}

// â”€â”€â”€ 3. USA Hub / Rep / Distributor / Promoter â€“ order before payment â”€
function buildUsaPartnerOrderBeforePaymentHtml() {
  const orderNumber = 'SGUSAP0118';
  const shipping = 25;
  const role = sampleCustomer.roleLabel; // sample: Hub

  const body = [
    copyBlock([
      `Hello ${sampleCustomer.name},`,
      `<strong style="font-weight:bold; color:#000000;">Your order has been created and is awaiting payment.</strong>`,
      `Don't forget to complete payment. We will prepare your order as soon as payment is made.`,
    ]),
    detailsCard(
      'Order Details',
      detailRow('Order Number', orderNumber) +
        detailRow('Account Type', role) +
        detailRow('Email', sampleCustomer.email) +
        detailRow('Company', sampleCustomer.company, true) +
        `<tr><td style="padding:16px 0 0 0;">${pillCta(PAY_URL, 'COMPLETE PAYMENT')}</td></tr>`,
    ),
    itemsSummarySection('Order Summary', sampleItems, '$', 'USD', shipping, 'Total Due'),
    shippingAddressBlock(sampleAddress),
    helpBlock(
      `USA hub representative distributor and promoter orders before payment. Questions? Contact <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a>.`,
    ),
  ].join('');

  return wrapEmail(
    'USA Partner Order â€“ Payment Required â€“ SkyGloss',
    body,
    'DRAFT TEMPLATE â€“ for testing only. Not the live USA partner order (before payment) email.',
  );
}

// â”€â”€â”€ 4. USA Shop Order Payment Reminder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildUsaShopPaymentReminderHtml(dayNumber = 2) {
  const orderNumber = 'SGUSAP0119';
  const shipping = 25;
  const daysRemaining = Math.max(0, 3 - dayNumber);

  const body = [
    copyBlock([
      `Hello ${sampleCustomer.name},`,
      `<strong style="font-weight:bold; color:#000000;">Reminder: Don't forget to complete payment for your order.</strong>`,
      `You started checkout for order <strong style="font-weight:bold;">${orderNumber}</strong>, but payment has not been completed yet.`,
      `We send one payment reminder per day for up to <strong style="font-weight:bold;">3 days</strong>. This is reminder <strong style="font-weight:bold;">${dayNumber} of 3</strong>.${
        daysRemaining > 0
          ? ` You have <strong style="font-weight:bold;">${daysRemaining} day${daysRemaining === 1 ? '' : 's'}</strong> remaining to complete payment.`
          : ''
      }`,
      `If payment is still not completed after 3 days, <strong style="font-weight:bold;">your cart will be automatically cleared</strong> and this pending order will be cancelled.`,
    ]),
    detailsCard(
      'Payment Reminder',
      detailRow('Order Number', orderNumber) +
        detailRow('Reminder', `Day ${dayNumber} of 3`) +
        detailRow('Email', sampleCustomer.email, true) +
        `<tr><td style="padding:16px 0 0 0;">${pillCta(PAY_URL, 'PAY NOW')}</td></tr>`,
    ),
    itemsSummarySection('Order Summary', sampleItems, '$', 'USD', shipping, 'Total Due'),
    helpBlock(
      `If you have already paid, you can ignore this email. Need help? Contact <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a>.`,
    ),
  ].join('');

  return wrapEmail(
    'USA Shop Order Payment Reminder â€“ SkyGloss',
    body,
    'DRAFT TEMPLATE â€“ for testing only. Not the live USA shop payment reminder email.',
  );
}

async function sendAll() {
  const fromUser = 'sales@skygloss.com';
  const fromPass = 'wsux didm itaa zeds';
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: fromUser, pass: fromPass },
  });

  const emails = [
    {
      key: 'usa-order-shipped',
      subject: `[DRAFT TEST] USA Order Shipped â€“ SGUSAP0117 â€“ ${stamp}`,
      html: buildUsaShippedHtml(),
      file: 'usa-order-shipped-email-draft-preview.html',
    },
    {
      key: 'usa-order-cancellation',
      subject: `[DRAFT TEST] USA Order Cancelled & Refunded â€“ SGUSAP0117 â€“ ${stamp}`,
      html: buildUsaCancellationHtml(),
      file: 'usa-order-cancellation-email-draft-preview.html',
    },
    {
      key: 'usa-partner-order-before-payment',
      subject: `[DRAFT TEST] USA Hub/Rep/Distributor/Promoter Order â€“ Payment Required â€“ ${stamp}`,
      html: buildUsaPartnerOrderBeforePaymentHtml(),
      file: 'usa-partner-order-before-payment-email-draft-preview.html',
    },
    {
      key: 'usa-shop-payment-reminder',
      subject: `[DRAFT TEST] USA Shop Order Payment Reminder (Day 2 of 3) â€“ ${stamp}`,
      html: buildUsaShopPaymentReminderHtml(2),
      file: 'usa-shop-payment-reminder-email-draft-preview.html',
    },
  ];

  for (const email of emails) {
    const previewPath = path.join(__dirname, email.file);
    fs.writeFileSync(previewPath, email.html, 'utf8');
    console.log('Local preview written:', previewPath);

    const info = await transporter.sendMail({
      from: `"SkyGloss" <${fromUser}>`,
      to: 'it@skygloss.com',
      subject: email.subject,
      html: email.html,
    });

    console.log(`Sent ${email.key} â†’ it@skygloss.com`);
    console.log('Subject:', email.subject);
    console.log('SMTP:', info.response);
    console.log('---');
  }

  console.log('All 4 USA draft emails sent to it@skygloss.com only.');
  console.log('Live templates in mail.service.ts were NOT changed.');
}

sendAll().catch((error) => {
  console.error('Failed to send USA draft emails:', error.message);
  process.exit(1);
});
