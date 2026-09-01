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

function orderTotalsRows(
  symbol: string,
  currency: string,
  subtotal: number,
  shipping: number,
  total: number,
  totalLabel: string,
  options?: { amountPaid?: number; remainingAmount?: number },
): string {
  const amountPaid = Number(options?.amountPaid) || 0;
  const remaining =
    options?.remainingAmount != null
      ? Number(options.remainingAmount)
      : Math.max(0, total - amountPaid);
  const showBalance = amountPaid > 0.01;

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
                  ${
                    showBalance
                      ? `
                  <tr>
                    <td align="right" style="padding:8px 12px 4px 0; font-size:14px; color:#666666;">You Already Paid</td>
                    <td align="right" width="110" style="padding:8px 0 4px 0; font-size:14px; font-weight:bold; color:#16a34a;">${formatMoney(symbol, amountPaid)}</td>
                  </tr>
                  <tr>
                    <td align="right" style="padding:4px 12px 0 0; font-size:16px; font-weight:bold; color:#000000;">Remaining Amount</td>
                    <td align="right" width="110" style="padding:4px 0 0 0; font-size:16px; font-weight:bold; color:#dc2626;">
                      ${formatMoney(symbol, remaining)} <span style="font-size:11px; color:#666666; font-weight:normal;">${currency}</span>
                    </td>
                  </tr>`
                      : ''
                  }
                </tbody>
              </table>`;
}

function itemsSection(
  title: string,
  items: any[],
  symbol: string,
  currency: string,
  shipping: number,
  total: number,
  totalLabel: string,
  options?: { amountPaid?: number; remainingAmount?: number },
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
              ${orderTotalsRows(symbol, currency, subtotal, shipping, total, totalLabel, options)}
            </td>
          </tr>`;
}

/** Customer-facing: order request received (non-USA / invoice later flow). */
export function buildLatestOrderRequestCustomerHtml(
  order: any,
  user: any,
  footerContact?: FooterContact | null,
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
  const email = user?.email || order.shippingAddress?.email || '';
  const company = user?.companyName || user?.shopName || '';
  const addr = order.shippingAddress || {};

  const body = `
          <tr>
            <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Hello ${name},</p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">We've received your order request.</strong></p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Thank you for submitting order request <strong style="font-weight:bold;">${order.orderNumber}</strong>.</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Our sales team will review it shortly. Once approved, you will receive an invoice to complete your purchase.</p>
            </td>
          </tr>
          ${detailsCard(
            'Request Details',
            detailRow('Order Number', order.orderNumber) +
              (email ? detailRow('Email', email) : '') +
              (company ? detailRow('Company', company, true) : detailRow('Status', 'Awaiting sales review', true)),
          )}
          ${itemsSection('Requested Items', items, symbol, currency, shipping, total, 'Estimated Total')}
          ${shippingAddressBlock({
            name: addr.name || name,
            line1: addr.line1 || addr.address,
            line2: addr.line2,
            city: addr.city,
            state: addr.state,
            zip: addr.zip || addr.zipCode,
            country: addr.country,
          })}
          ${helpBlock(
            `If you have any questions about this request, please contact our sales team at <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a> and include your order number.`,
          )}
          ${blueClosingBlock([
            'Thank you for choosing SkyGloss.',
            'Best regards,<br>The SkyGloss Team',
          ])}
          ${buildRepresentativeFooterBlock(footerContact)}`;

  return wrapLatestOrderEmail('Order Request Received – SkyGloss', body);
}

/** Sales/admin: new order request notification (latest branded layout). */
export function buildLatestNewOrderRequestSalesHtml(
  order: any,
  user: any,
  footerContact?: FooterContact | null,
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
  const email = user?.email || order.shippingAddress?.email || '';
  const company = user?.companyName || user?.shopName || '';
  const country =
    user?.country ||
    order.shippingAddress?.country ||
    '';
  const stamp = new Date().toLocaleString();

  const body = `
          <tr>
            <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">New manual order request: ${order.orderNumber}</strong></p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">A shop submitted an order request that needs a formal invoice. Date: ${stamp}</p>
            </td>
          </tr>
          ${detailsCard(
            'Customer Details',
            detailRow('Name', name) +
              detailRow('Email', email || 'N/A') +
              (company ? detailRow('Company', company) : '') +
              (country ? detailRow('Country', country) : '') +
              detailRow('Order Number', order.orderNumber) +
              detailRow('Currency', currency, true),
          )}
          ${itemsSection('Requested Items', items, symbol, currency, shipping, total, 'Estimated Total')}
          ${helpBlock(
            'Please log in to the admin panel to generate a formal invoice for this customer.',
          )}
          ${blueClosingBlock([
            'SkyGloss Portal notification.',
            'Best regards,<br>The SkyGloss Team',
          ])}
          ${buildRepresentativeFooterBlock(footerContact)}`;

  return wrapLatestOrderEmail('Order Request – SkyGloss', body);
}

/** Sales/admin: paid order notification (latest branded layout). */
export function buildLatestNewOrderPaidSalesHtml(
  order: any,
  user: any,
  footerContact?: FooterContact | null,
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
  const email = user?.email || order.shippingAddress?.email || '';
  const company = user?.companyName || user?.shopName || '';
  const stamp = new Date().toLocaleString();

  const body = `
          <tr>
            <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">New paid order: ${order.orderNumber}</strong></p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Payment was received. Date: ${stamp}</p>
            </td>
          </tr>
          ${detailsCard(
            'Customer Details',
            detailRow('Name', name) +
              detailRow('Email', email || 'N/A') +
              (company ? detailRow('Company', company) : '') +
              detailRow('Order Number', order.orderNumber) +
              detailRow('Currency', currency, true),
          )}
          ${itemsSection('Order Items', items, symbol, currency, shipping, total, 'Total Paid')}
          ${blueClosingBlock([
            'SkyGloss Portal notification.',
            'Best regards,<br>The SkyGloss Team',
          ])}
          ${buildRepresentativeFooterBlock(footerContact)}`;

  return wrapLatestOrderEmail('New Order – SkyGloss', body);
}

/** Customer-facing: Hub/Admin sent a formal invoice after adding shipping. */
export function buildLatestOrderRequestInvoiceHtml(
  order: any,
  user: any,
  options?: {
    viewUrl?: string;
    footerContact?: FooterContact | null;
    amountPaid?: number;
    remainingAmount?: number;
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
  const amountPaid = Number(
    options?.amountPaid ?? order.amountPaid ?? 0,
  );
  const remainingAmount =
    options?.remainingAmount != null
      ? Number(options.remainingAmount)
      : Math.max(0, total - amountPaid);
  const name = customerName(user, order);
  const email = user?.email || order.shippingAddress?.email || '';
  const company = user?.companyName || user?.shopName || '';
  const addr = order.shippingAddress || {};
  const viewUrl = options?.viewUrl;
  const hasBalance = amountPaid > 0.01;
  const dueLabel = hasBalance ? 'Order Total' : 'Amount Due';

  const body = `
          <tr>
            <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Hello ${name},</p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">Your invoice is ready.</strong></p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Please find the invoice for order <strong style="font-weight:bold;">${order.orderNumber}</strong> attached.${hasBalance ? ' Additional items were added to your existing order.' : ' The total includes shipping.'}</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">${
                hasBalance
                  ? `You already paid <strong>${formatMoney(symbol, amountPaid)}</strong>. Please pay the remaining amount of <strong>${formatMoney(symbol, remainingAmount)}</strong> to complete your order.`
                  : 'Complete payment using the attached invoice to proceed with your order.'
              }</p>
            </td>
          </tr>
          ${detailsCard(
            'Invoice Details',
            detailRow('Order Number', order.orderNumber) +
              (email ? detailRow('Email', email) : '') +
              (company ? detailRow('Company', company) : '') +
              detailRow(
                'Shipping',
                formatMoney(symbol, shipping),
                !viewUrl,
              ) +
              (viewUrl
                ? `<tr><td style="padding:16px 0 0 0;">${pillCta(viewUrl, 'VIEW ORDER')}</td></tr>`
                : ''),
          )}
          ${itemsSection('Invoice Summary', items, symbol, currency, shipping, total, dueLabel, {
            amountPaid,
            remainingAmount,
          })}
          ${shippingAddressBlock({
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
          })}
          ${helpBlock(
            `If you have any questions about this invoice, please contact our sales team at <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a> and include your order number.`,
          )}
          ${blueClosingBlock([
            'Thank you for choosing SkyGloss.',
            'Best regards,<br>The SkyGloss Team',
          ])}
          ${buildRepresentativeFooterBlock(options?.footerContact)}`;

  return wrapLatestOrderEmail('Order Invoice – SkyGloss', body);
}
