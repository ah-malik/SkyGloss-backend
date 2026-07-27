import {
  BRAND_BLUE,
  buildLatestOrderItemsHtml,
  buildRepresentativeFooterBlock,
  FooterContact,
  formatMoney,
  getCurrencySymbol,
  wrapLatestOrderEmail,
} from './latest-shared';
import {
  formatOrderItemDisplayName,
  formatOrderItemTypeLabel,
} from '../../common/order-type';

function customerName(user: any, order?: any): string {
  return (
    [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
    order?.shippingAddress?.firstName ||
    'there'
  );
}

function orderShippingFee(order: any, subtotal: number): number {
  if (order.shippingFee != null && Number(order.shippingFee) > 0) {
    return Number(order.shippingFee);
  }
  return Math.max(0, Number(order.totalAmount || 0) - subtotal + Number(order.discount || 0));
}

export function buildLatestOrderCancelledHtml(
  order: any,
  user: any,
  options: {
    wasPaid?: boolean;
    cancellationReason?: string;
    footerContact?: FooterContact | null;
  },
): string {
  const wasPaid = options.wasPaid !== false;
  const reason =
    options.cancellationReason ||
    order.cancellationReason ||
    'Your order was cancelled.';
  const currency = (order.currency || 'USD').toUpperCase();
  const symbol = getCurrencySymbol(currency);
  const items = order.items || [];
  const subtotal = items.reduce(
    (sum: number, item: any) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
  const shipping = orderShippingFee(order, subtotal);
  const total = Number(order.totalAmount != null ? order.totalAmount : subtotal + shipping);
  const name = customerName(user, order);
  const email = user?.email || order.shippingAddress?.email || '';
  const company = user?.companyName || user?.shopName || '';

  const refundCopy = wasPaid
    ? `The total amount for this order has been refunded to your original payment method. Please allow a few business days for the funds to appear in your account.`
    : `No payment was received for this order. You can place a new order at any time from your SkyGloss Portal dashboard.`;

  const body = `
          <tr>
            <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Hello ${name},</p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">Your order has been cancelled.</strong></p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">We're writing to confirm that order <strong style="font-weight:bold;">${order.orderNumber}</strong> has been cancelled and will not be processed further.</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">${refundCopy}</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:22px 40px 8px 40px; background-color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                <tbody><tr>
                  <td width="4" bgcolor="${BRAND_BLUE}" style="width:4px; background-color:${BRAND_BLUE}; font-size:0; line-height:0;">&nbsp;</td>
                  <td bgcolor="#f5f9fc" style="background-color:#f5f9fc; padding:18px 20px; font-family: Arial, Helvetica, sans-serif; color:#000000;">
                    <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Cancellation Details</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tbody>
                        <tr>
                          <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Order Number</span><br>
                            <strong style="font-weight:bold; color:#000000;">${order.orderNumber}</strong>
                          </td>
                        </tr>
                        ${email ? `<tr>
                          <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Email</span><br>
                            <strong style="font-weight:bold; color:#000000;">${email}</strong>
                          </td>
                        </tr>` : ''}
                        ${company ? `<tr>
                          <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Company</span><br>
                            <strong style="font-weight:bold; color:#000000;">${company}</strong>
                          </td>
                        </tr>` : ''}
                        <tr>
                          <td style="padding:0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Reason</span><br>
                            <strong style="font-weight:bold; color:#000000;">${reason}</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr></tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 8px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif;">
              <p style="margin:0 0 14px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Cancelled Order Summary</p>
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
                    <td align="right" style="padding:12px 12px 0 0; font-size:16px; font-weight:bold; color:#000000; border-top:2px solid ${BRAND_BLUE};">${wasPaid ? 'Amount Refunded' : 'Order Total'}</td>
                    <td align="right" width="110" style="padding:12px 0 0 0; font-size:16px; font-weight:bold; color:${BRAND_BLUE}; border-top:2px solid ${BRAND_BLUE};">
                      ${formatMoney(symbol, total)} <span style="font-size:11px; color:#666666; font-weight:normal;">${currency}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 36px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; color:#000000;">
              <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Need Help?</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">If you have any questions about this cancellation${wasPaid ? ' or your refund' : ''}, please contact our sales team at <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a> and include your order number.</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="${BRAND_BLUE}" style="padding:36px; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65;">
              <p style="margin:0 0 14px 0; color:#ffffff;">We're sorry we weren't able to complete this order for you.</p>
              <p style="margin:0 0 14px 0; color:#ffffff;">If you'd like to place a new order or need assistance with anything else, our team is here to help.</p>
              <p style="margin:0; color:#ffffff;">Best regards,<br>The SkyGloss Team</p>
            </td>
          </tr>
          ${buildRepresentativeFooterBlock(options.footerContact)}`;

  return wrapLatestOrderEmail('Order Cancelled – SkyGloss', body);
}

export function buildLatestOrderPaidHtml(
  order: any,
  user: any,
  footerContact?: FooterContact | null,
): string {
  const currency = (order.currency || 'USD').toUpperCase();
  const symbol = getCurrencySymbol(currency);
  const items = order.items || [];
  const subtotal = items.reduce(
    (sum: number, item: any) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
  const shipping = orderShippingFee(order, subtotal);
  const total = Number(order.totalAmount != null ? order.totalAmount : subtotal + shipping);
  const name = customerName(user, order);
  const addr = order.shippingAddress || {};

  const body = `
          <tr>
            <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Hello ${name},</p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">Thank you — your payment is confirmed.</strong></p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">We've received payment for order <strong style="font-weight:bold;">${order.orderNumber}</strong> and your order is now being processed. We'll notify you when it ships.</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 8px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif;">
              <p style="margin:0 0 14px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Order Summary</p>
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
                    <td align="right" style="padding:12px 12px 0 0; font-size:16px; font-weight:bold; color:#000000; border-top:2px solid ${BRAND_BLUE};">Total Paid</td>
                    <td align="right" width="110" style="padding:12px 0 0 0; font-size:16px; font-weight:bold; color:${BRAND_BLUE}; border-top:2px solid ${BRAND_BLUE};">
                      ${formatMoney(symbol, total)} <span style="font-size:11px; color:#666666; font-weight:normal;">${currency}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
          ${addr.line1 || addr.address ? `
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 8px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif;">
              <p style="margin:0 0 10px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Shipping To</p>
              <p style="margin:0; font-size:14px; line-height:1.6; color:#000000;">
                <strong style="font-weight:bold;">${addr.name || name}</strong><br>
                ${addr.line1 || addr.address || ''}<br>
                ${addr.line2 ? `${addr.line2}<br>` : ''}
                ${[addr.city, addr.state, addr.zip || addr.zipCode].filter(Boolean).join(', ')}<br>
                ${addr.country || ''}
              </p>
            </td>
          </tr>` : ''}
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 36px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; color:#000000;">
              <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">What Happens Next</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">If you have any questions about this order, please contact our sales team at <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a> and include your order number.</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="${BRAND_BLUE}" style="padding:36px; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65;">
              <p style="margin:0 0 14px 0; color:#ffffff;">Thank you for choosing SkyGloss.</p>
              <p style="margin:0 0 14px 0; color:#ffffff;">We appreciate your business and look forward to supporting you with the products and resources you need.</p>
              <p style="margin:0; color:#ffffff;">Best regards,<br>The SkyGloss Team</p>
            </td>
          </tr>
          ${buildRepresentativeFooterBlock(footerContact)}`;

  return wrapLatestOrderEmail('Order Confirmation – SkyGloss', body);
}

export function buildLatestOrderShippedHtml(
  order: any,
  user: any,
  options: {
    trackingUrl?: string | null;
    footerContact?: FooterContact | null;
  },
): string {
  const trackingId = (order.trackingId || '').trim();
  const shippingCompany = (order.shippingCompany || '').trim();
  const currency = (order.currency || 'USD').toUpperCase();
  const symbol = getCurrencySymbol(currency);
  const items = order.items || [];
  const subtotal = items.reduce(
    (sum: number, item: any) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
  const shipping = orderShippingFee(order, subtotal);
  const total = Number(order.totalAmount != null ? order.totalAmount : subtotal + shipping);
  const name = customerName(user, order);

  const body = `
          <tr>
            <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Hello ${name},</p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">Your order is on its way.</strong></p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Great news — order <strong style="font-weight:bold;">${order.orderNumber}</strong> has shipped.</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:22px 40px 8px 40px; background-color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                <tbody><tr>
                  <td width="4" bgcolor="${BRAND_BLUE}" style="width:4px; background-color:${BRAND_BLUE}; font-size:0; line-height:0;">&nbsp;</td>
                  <td bgcolor="#f5f9fc" style="background-color:#f5f9fc; padding:18px 20px; font-family: Arial, Helvetica, sans-serif; color:#000000;">
                    <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Tracking Details</p>
                    <p style="margin:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                      <span style="color:#666666;">Carrier</span><br>
                      <strong style="font-weight:bold; color:#000000;">${shippingCompany || 'N/A'}</strong>
                    </p>
                    <p style="margin:0 0 12px 0; font-size:14px; line-height:1.5; color:#000000;">
                      <span style="color:#666666;">Tracking Number</span><br>
                      <strong style="font-weight:bold; color:#000000;">${trackingId || 'N/A'}</strong>
                    </p>
                    ${
                      options.trackingUrl
                        ? `<p style="margin:0;"><a href="${options.trackingUrl}" style="display:inline-block; background:${BRAND_BLUE}; color:#ffffff; text-decoration:none; padding:10px 18px; border-radius:6px; font-weight:bold; font-size:14px;">Track Your Package</a></p>`
                        : ''
                    }
                  </td>
                </tr></tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 8px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif;">
              <p style="margin:0 0 14px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Shipped Items</p>
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
                    <td align="right" style="padding:12px 12px 0 0; font-size:16px; font-weight:bold; color:#000000; border-top:2px solid ${BRAND_BLUE};">Order Total</td>
                    <td align="right" width="110" style="padding:12px 0 0 0; font-size:16px; font-weight:bold; color:${BRAND_BLUE}; border-top:2px solid ${BRAND_BLUE};">
                      ${formatMoney(symbol, total)} <span style="font-size:11px; color:#666666; font-weight:normal;">${currency}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 36px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; color:#000000;">
              <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Need Help?</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Questions about your shipment? Contact <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a> and include your order number.</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="${BRAND_BLUE}" style="padding:36px; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65;">
              <p style="margin:0 0 14px 0; color:#ffffff;">Thank you for choosing SkyGloss.</p>
              <p style="margin:0; color:#ffffff;">Best regards,<br>The SkyGloss Team</p>
            </td>
          </tr>
          ${buildRepresentativeFooterBlock(options.footerContact)}`;

  return wrapLatestOrderEmail('Order Shipped – SkyGloss', body);
}
