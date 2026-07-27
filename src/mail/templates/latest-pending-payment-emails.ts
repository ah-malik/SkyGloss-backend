import {
  BRAND_BLUE,
  buildLatestOrderItemsHtml,
  buildRepresentativeFooterBlock,
  blueClosingBlock,
  detailsCard,
  detailRow,
  FooterContact,
  formatMoney,
  getCurrencySymbol,
  helpBlock,
  pillCta,
  shippingAddressBlock,
  wrapLatestOrderEmail,
} from './latest-shared';
import {
  formatOrderItemDisplayName,
  formatOrderItemTypeLabel,
} from '../../common/order-type';
import { formatRoleLabel } from '../../common/role-labels';

function customerName(user: any, order?: any): string {
  return (
    [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
    order?.shippingAddress?.firstName ||
    order?.shippingAddress?.name ||
    'there'
  );
}

function orderShippingFee(order: any, subtotal: number): number {
  if (order.shippingFee != null && Number(order.shippingFee) > 0) {
    return Number(order.shippingFee);
  }
  return Math.max(
    0,
    Number(order.totalAmount || 0) - subtotal + Number(order.discount || 0),
  );
}

function orderSummarySection(
  title: string,
  items: any[],
  symbol: string,
  currency: string,
  shipping: number,
  total: number,
  totalLabel: string,
): string {
  const subtotal = items.reduce(
    (sum: number, item: any) =>
      sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );

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
            ${buildLatestOrderItemsHtml(items, symbol, formatOrderItemDisplayName, formatOrderItemTypeLabel)}
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
              <td align="right" style="padding:12px 12px 0 0; font-size:16px; font-weight:bold; color:#000000; border-top:2px solid ${BRAND_BLUE};">${totalLabel}</td>
              <td align="right" width="110" style="padding:12px 0 0 0; font-size:16px; font-weight:bold; color:${BRAND_BLUE}; border-top:2px solid ${BRAND_BLUE};">
                ${formatMoney(symbol, total)} <span style="font-size:11px; color:#666666; font-weight:normal;">${currency}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>`;
}

function copyBlock(paragraphs: string[]): string {
  const html = paragraphs
    .map(
      (p, i) =>
        `<p style="margin:${i === paragraphs.length - 1 ? '0' : '0 0 18px 0'}; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">${p}</p>`,
    )
    .join('');
  return `
    <tr>
      <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
        ${html}
      </td>
    </tr>`;
}

export function buildLatestPendingPaymentHtml(
  order: any,
  user: any,
  options: {
    payUrl: string;
    isFollowUp: boolean;
    footerContact?: FooterContact | null;
    dayNumber?: number;
  },
): string {
  const currency = (order.currency || 'USD').toUpperCase();
  const symbol = getCurrencySymbol(currency);
  const items = order.items || [];
  const subtotal = items.reduce(
    (sum: number, item: any) =>
      sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
  const shipping = orderShippingFee(order, subtotal);
  const total = Number(
    order.totalAmount != null ? order.totalAmount : subtotal + shipping,
  );
  const name = customerName(user, order);
  const email = user?.email || order?.shippingAddress?.email || '';
  const company = user?.companyName || user?.shopName || '';
  const addr = order.shippingAddress || {};

  let body: string;

  if (!options.isFollowUp) {
    body = [
      copyBlock([
        `Hello ${name},`,
        `<strong style="font-weight:bold; color:#000000;">Your order has been created and is awaiting payment.</strong>`,
        `Don't forget to complete payment. We will prepare your order as soon as payment is made.`,
      ]),
      detailsCard(
        'Order Details',
        detailRow('Order Number', order.orderNumber) +
          detailRow('Account Type', formatRoleLabel(user?.role)) +
          detailRow('Email', email) +
          detailRow('Company', company || 'N/A', true) +
          `<tr><td style="padding:16px 0 0 0;">${pillCta(options.payUrl, 'COMPLETE PAYMENT')}</td></tr>`,
      ),
      orderSummarySection(
        'Order Summary',
        items,
        symbol,
        currency,
        shipping,
        total,
        'Total Due',
      ),
      shippingAddressBlock({
        name:
          addr.name ||
          [addr.firstName, addr.lastName].filter(Boolean).join(' ') ||
          name,
        line1: addr.line1 || addr.address,
        line2: addr.line2,
        city: addr.city,
        state: addr.state,
        zip: addr.zip || addr.zipCode,
        country: addr.country,
      }),
      helpBlock(
        `If you have any questions about this order or payment, please contact our sales team at <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a>.`,
      ),
      blueClosingBlock([
        'Thank you for choosing SkyGloss.',
        'Best Regards,<br>The SkyGloss Team',
      ]),
      buildRepresentativeFooterBlock(options.footerContact),
    ].join('');
  } else {
    const dayNumber =
      options.dayNumber ??
      Math.min(3, Math.max(1, (order.paymentReminderCount || 0) + 1));
    const daysRemaining = Math.max(0, 3 - dayNumber);

    body = [
      copyBlock([
        `Hello ${name},`,
        `<strong style="font-weight:bold; color:#000000;">Reminder: Don't forget to complete payment for your order.</strong>`,
        `You started checkout for order <strong style="font-weight:bold;">${order.orderNumber}</strong>, but payment has not been completed yet.`,
        `We send one payment reminder per day for up to <strong style="font-weight:bold;">3 days</strong>. This is reminder <strong style="font-weight:bold;">${dayNumber} of 3</strong>.${
          daysRemaining > 0
            ? ` You have <strong style="font-weight:bold;">${daysRemaining} day${daysRemaining === 1 ? '' : 's'}</strong> remaining to complete payment.`
            : ''
        }`,
        `If payment is still not completed after 3 days, <strong style="font-weight:bold;">your cart will be automatically cleared</strong> and this pending order will be cancelled.`,
      ]),
      detailsCard(
        'Payment Reminder',
        detailRow('Order Number', order.orderNumber) +
          detailRow('Reminder', `Day ${dayNumber} of 3`) +
          detailRow('Email', email, true) +
          `<tr><td style="padding:16px 0 0 0;">${pillCta(options.payUrl, 'PAY NOW')}</td></tr>`,
      ),
      orderSummarySection(
        'Order Summary',
        items,
        symbol,
        currency,
        shipping,
        total,
        'Total Due',
      ),
      helpBlock(
        `If you have already paid, you can ignore this email. Need help? Contact <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a>.`,
      ),
      blueClosingBlock([
        'Thank you for choosing SkyGloss.',
        'Best Regards,<br>The SkyGloss Team',
      ]),
      buildRepresentativeFooterBlock(options.footerContact),
    ].join('');
  }

  return wrapLatestOrderEmail(
    options.isFollowUp
      ? 'Order Payment Reminder – SkyGloss'
      : 'Order – Payment Required – SkyGloss',
    body,
  );
}
