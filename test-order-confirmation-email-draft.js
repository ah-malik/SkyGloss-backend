/**
 * DRAFT Order Confirmation Email – visual test only.
 * Does NOT replace the live order confirmation template in mail.service.ts.
 *
 * Run: node test-order-confirmation-email-draft.js
 * Sends to: it@skygloss.com
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './.env' });

const ASSETS = {
  // Blue logo – header only (do NOT use black logo here)
  blueLogoHeader:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784290766/svnkjkigtjacvlsoiktt.png',
  footerWhite:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204256/fsxmdvqtln4zsejc8c53.png',
  footerWhiteCar:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204545/gxnxmjx9e6d48x3u7ifr.png',
};

const BRAND_BLUE = '#00AEEF';
const WIDTH = 600;

const sampleOrder = {
  orderNumber: 'SG-ORD-10482',
  currency: 'USD',
  symbol: '$',
  customer: {
    name: 'Test User',
    email: 'it@skygloss.com',
    company: 'SkyGloss IT',
  },
  items: [
    {
      name: 'SkyGloss Fusion Kit',
      size: 'Standard',
      orderType: 'Kit',
      quantity: 2,
      price: 249.0,
    },
    {
      name: 'SkyGloss Compound',
      size: '1L',
      orderType: 'Product',
      quantity: 1,
      price: 89.0,
    },
  ],
  shipping: 25.0,
  shippingAddress: {
    name: 'Test User',
    line1: '1234 Innovation Drive',
    line2: 'Suite 200',
    city: 'Phoenix',
    state: 'AZ',
    zip: '85001',
    country: 'United States',
  },
};

function formatMoney(symbol, amount) {
  return `${symbol}${Number(amount).toFixed(2)}`;
}

function buildOrderItemsHtml(items, symbol) {
  let rows = '';
  items.forEach((item) => {
    const lineTotal = item.price * item.quantity;
    rows += `
      <tr>
        <td style="padding:12px 0; border-bottom:1px solid #e8eef3; font-size:14px; line-height:1.45; color:#000000; vertical-align:top;">
          <strong style="font-weight:bold; color:#000000;">${item.name}</strong>
          ${item.size ? `<br><span style="font-size:12px; color:#666666;">Size: ${item.size}</span>` : ''}
          ${item.orderType ? `<br><span style="font-size:12px; color:#666666;">Type: ${item.orderType}</span>` : ''}
        </td>
        <td align="center" style="padding:12px 8px; border-bottom:1px solid #e8eef3; font-size:14px; color:#000000; vertical-align:top; white-space:nowrap;">
          ${item.quantity}
        </td>
        <td align="right" style="padding:12px 0; border-bottom:1px solid #e8eef3; font-size:14px; color:#000000; vertical-align:top; white-space:nowrap;">
          ${formatMoney(symbol, lineTotal)}
        </td>
      </tr>`;
  });
  return rows;
}

function buildDraftOrderConfirmationHtml(order) {
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shipping = Number(order.shipping) || 0;
  const total = subtotal + shipping;
  const { symbol, currency, customer } = order;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Order Confirmation – SkyGloss</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#e8e8e8; font-family: Arial, Helvetica, sans-serif; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#e8e8e8" style="margin:0; padding:0; width:100%; background-color:#e8e8e8;">
    <tbody><tr>
      <td align="center" style="padding:0;">

        <table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:${WIDTH}px; max-width:${WIDTH}px; margin:0 auto; background-color:#ffffff;">

          <!-- 1. Header: blue logo – L/R padding 0 -->
          <tbody><tr>
            <td bgcolor="#ffffff" style="padding:20px 0; background-color:#ffffff;">
              <img src="${ASSETS.blueLogoHeader}" alt="SKYGLOSS" width="${WIDTH}" style="display:block; width:100%; max-width:${WIDTH}px; height:auto; border:0; outline:none; text-decoration:none; padding:0; margin:0;">
            </td>
          </tr>

          <!-- 2. Confirmation copy -->
          <tr>
            <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Hello ${customer.name},</p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">Thank you for your order.</strong></p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">We've received your payment and your order is now confirmed. Our team is preparing your items for shipment.</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">You'll receive a separate notification once your order has shipped, including tracking details when available.</p>
            </td>
          </tr>

          <!-- 3. Order details card -->
          <tr>
            <td bgcolor="#ffffff" style="padding:22px 40px 8px 40px; background-color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                <tbody><tr>
                  <td width="4" bgcolor="${BRAND_BLUE}" style="width:4px; background-color:${BRAND_BLUE}; font-size:0; line-height:0;">&nbsp;</td>
                  <td bgcolor="#f5f9fc" style="background-color:#f5f9fc; padding:18px 20px; font-family: Arial, Helvetica, sans-serif; color:#000000;">
                    <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">
                      Order Details
                    </p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tbody>
                        <tr>
                          <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Order Number</span><br>
                            <strong style="font-weight:bold; color:#000000;">${order.orderNumber}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Email</span><br>
                            <strong style="font-weight:bold; color:#000000;">${customer.email}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Company</span><br>
                            <strong style="font-weight:bold; color:#000000;">${customer.company}</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>

          <!-- 4. Order summary -->
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 8px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif;">
              <p style="margin:0 0 14px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">
                Order Summary
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tbody>
                  <tr>
                    <td style="padding:0 0 8px 0; font-size:11px; font-weight:bold; letter-spacing:0.5px; color:#888888; text-transform:uppercase; border-bottom:2px solid #e8eef3;">Item</td>
                    <td align="center" style="padding:0 8px 8px 8px; font-size:11px; font-weight:bold; letter-spacing:0.5px; color:#888888; text-transform:uppercase; border-bottom:2px solid #e8eef3;">Qty</td>
                    <td align="right" style="padding:0 0 8px 0; font-size:11px; font-weight:bold; letter-spacing:0.5px; color:#888888; text-transform:uppercase; border-bottom:2px solid #e8eef3;">Total</td>
                  </tr>
                  ${buildOrderItemsHtml(order.items, symbol)}
                </tbody>
              </table>

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
                    <td align="right" style="padding:12px 12px 0 0; font-size:16px; font-weight:bold; color:#000000; border-top:2px solid ${BRAND_BLUE};">Total Paid</td>
                    <td align="right" width="110" style="padding:12px 0 0 0; font-size:16px; font-weight:bold; color:${BRAND_BLUE}; border-top:2px solid ${BRAND_BLUE};">
                      ${formatMoney(symbol, total)} <span style="font-size:11px; color:#666666; font-weight:normal;">${currency}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>

          <!-- 5. Shipping address -->
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 8px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif;">
              <p style="margin:0 0 10px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">
                Shipping To
              </p>
              <p style="margin:0; font-size:14px; line-height:1.6; color:#000000;">
                <strong style="font-weight:bold;">${order.shippingAddress.name}</strong><br>
                ${order.shippingAddress.line1}<br>
                ${order.shippingAddress.line2 ? `${order.shippingAddress.line2}<br>` : ''}
                ${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.zip}<br>
                ${order.shippingAddress.country}
              </p>
            </td>
          </tr>

          <!-- 6. What's next -->
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 36px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; color:#000000;">
              <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">
                What Happens Next
              </p>
              <p style="margin:0 0 14px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Our fulfillment team will carefully prepare your order. Once it ships, we'll send you tracking information so you can follow its progress.</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">If you have any questions about this order, please contact our sales team at <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a> and include your order number.</p>
            </td>
          </tr>

          <!-- 7. Closing blue -->
          <tr>
            <td bgcolor="${BRAND_BLUE}" style="padding:36px; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65;">
              <p style="margin:0 0 14px 0; color:#ffffff;">Thank you for choosing SkyGloss.</p>
              <p style="margin:0 0 14px 0; color:#ffffff;">We appreciate your business and look forward to supporting you with the products and resources you need.</p>
              <p style="margin:0; color:#ffffff;">Best regards,<br>The SkyGloss Team</p>
            </td>
          </tr>

          <!-- 8. Footer: contact + car -->
          <tr>
            <td bgcolor="#000000" style="padding:0; background-color:#000000;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tbody><tr>
                  <td width="40%" valign="middle" bgcolor="#000000" style="width:40%; padding:28px 22px; background-color:#000000; vertical-align:middle;">
                    <p style="margin:0 0 4px 0; font-family: Arial, Helvetica, sans-serif; font-size:13px; font-weight:bold; color:#ffffff; letter-spacing:0.5px;">
                      PAUL BILABE
                    </p>
                    <p style="margin:0 0 10px 0; font-family: Arial, Helvetica, sans-serif; font-size:12px; font-weight:bold; color:${BRAND_BLUE}; letter-spacing:0.5px;">
                      MASTER TRAINER
                    </p>
                    <p style="margin:0 0 4px 0; font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#ffffff;">
                      +1 (602) 784-4113
                    </p>
                    <p style="margin:0; font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#ffffff;">
                      <a href="mailto:certified@skygloss.com" style="color:#ffffff; text-decoration:none;">certified@skygloss.com</a>
                    </p>
                  </td>
                  <td width="60%" valign="middle" bgcolor="#000000" style="width:60%; padding:0; background-color:#000000; vertical-align:middle;">
                    <img src="${ASSETS.footerWhiteCar}" alt="SkyGloss team" width="350" style="display:block; width:100%; max-width:368px; height:auto; border:0;">
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>

          <!-- 9. Footer white logo – separate bottom row, L/R 0, top/bottom padding -->
          <tr>
            <td bgcolor="#000000" style="padding:20px 0; background-color:#000000;">
              <img src="${ASSETS.footerWhite}" alt="SKYGLOSS" width="${WIDTH}" style="display:block; width:100%; max-width:${WIDTH}px; height:auto; border:0; padding:0; margin:0;">
            </td>
          </tr>

        </tbody></table>

        <table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${WIDTH}px; max-width:${WIDTH}px;">
          <tbody><tr>
            <td style="padding:16px 8px; font-family: Arial, Helvetica, sans-serif; font-size:11px; color:#888888; text-align:center;">
              DRAFT TEMPLATE – for testing only. Not the live order confirmation email.
            </td>
          </tr>
        </tbody></table>

      </td>
    </tr>
  </tbody></table>
</body>
</html>`;
}

async function sendDraftOrderConfirmationEmail() {
  // Order confirmation uses sales mailbox (matches live flow). Draft only – not wired to mail.service.ts.
  const fromUser = 'sales@skygloss.com';
  const fromPass = 'wsux didm itaa zeds';

  const html = buildDraftOrderConfirmationHtml(sampleOrder);

  const previewPath = path.join(__dirname, 'order-confirmation-email-draft-preview.html');
  fs.writeFileSync(previewPath, html, 'utf8');
  console.log('Local preview written:', previewPath);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: fromUser,
      pass: fromPass,
    },
  });

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const mailOptions = {
    from: `"SkyGloss" <${fromUser}>`,
    to: 'it@skygloss.com',
    subject: `[DRAFT TEST] Order Confirmation – ${sampleOrder.orderNumber} – ${stamp}`,
    html,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log('Draft order confirmation email sent to it@skygloss.com');
  console.log('From:', mailOptions.from);
  console.log('Subject:', mailOptions.subject);
  console.log('SMTP response:', info.response);
  console.log('Live template in mail.service.ts was NOT changed.');
}

sendDraftOrderConfirmationEmail().catch((error) => {
  console.error('Failed to send draft order confirmation email:', error.message);
  process.exit(1);
});
