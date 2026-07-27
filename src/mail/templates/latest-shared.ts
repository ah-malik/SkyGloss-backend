export const EMAIL_ASSETS = {
  blueLogoHeader:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784290766/svnkjkigtjacvlsoiktt.png',
  blackLogoTop:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204179/o8eu2kwhtnmsxh0cyleb.png',
  signatureCar:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784207711/zao0iuzxys3pqnh62kfu.png',
  blackTshirtMan:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204504/aadn0mgwqlpvded4xuv3.png',
  footerWhite:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204256/fsxmdvqtln4zsejc8c53.png',
  footerWhiteCar:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204545/gxnxmjx9e6d48x3u7ifr.png',
};

export const BRAND_BLUE = '#00AEEF';
export const EMAIL_WIDTH = 600;

export const DEFAULT_FOOTER_CONTACT = {
  name: 'PAUL BILABE',
  title: 'MASTER TRAINER',
  phone: '+1 (602) 784-4113',
  email: 'certified@skygloss.com',
};

export type FooterContact = {
  name: string;
  title: string;
  phone: string;
  email: string;
};

const GLOBAL_HUB_CODES = new Set(['GLOBALHUB', 'GLOBAL77']);

export function isGlobalHubPartnerCode(code?: string | null): boolean {
  if (!code?.trim()) return false;
  return GLOBAL_HUB_CODES.has(code.trim().toUpperCase());
}

export function resolveShopFooterContact(
  shopUser?: {
    role?: string;
  } | null,
  localRepresentative?: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    partnerCode?: string;
    phoneNumber?: string | null;
    email?: string | null;
  } | null,
): FooterContact {
  const isShopUser = shopUser?.role === 'certified_shop';
  const hasRepresentative =
    isShopUser &&
    localRepresentative &&
    (localRepresentative.partnerCode ||
      localRepresentative.fullName ||
      localRepresentative.firstName) &&
    !isGlobalHubPartnerCode(localRepresentative.partnerCode);

  if (hasRepresentative) {
    const fullName =
      localRepresentative.fullName ||
      [localRepresentative.firstName, localRepresentative.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
    return {
      name: (
        fullName ||
        localRepresentative.partnerCode ||
        'Your Representative'
      ).toUpperCase(),
      title: 'REPRESENTATIVE',
      phone: localRepresentative.phoneNumber || DEFAULT_FOOTER_CONTACT.phone,
      email: localRepresentative.email || DEFAULT_FOOTER_CONTACT.email,
    };
  }

  return { ...DEFAULT_FOOTER_CONTACT };
}

export function buildRepresentativeFooterBlock(
  contact?: FooterContact | null,
): string {
  const footer = contact || DEFAULT_FOOTER_CONTACT;

  return `
          <tr>
            <td bgcolor="#000000" style="padding:0; background-color:#000000;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tbody><tr>
                  <td width="40%" valign="middle" bgcolor="#000000" style="width:40%; padding:28px 22px; background-color:#000000; vertical-align:middle;">
                    <p style="margin:0 0 4px 0; font-family: Arial, Helvetica, sans-serif; font-size:13px; font-weight:bold; color:#ffffff; letter-spacing:0.5px;">
                      ${footer.name}
                    </p>
                    <p style="margin:0 0 10px 0; font-family: Arial, Helvetica, sans-serif; font-size:12px; font-weight:bold; color:${BRAND_BLUE}; letter-spacing:0.5px;">
                      ${footer.title}
                    </p>
                    <p style="margin:0 0 4px 0; font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#ffffff;">
                      ${footer.phone}
                    </p>
                    <p style="margin:0; font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#ffffff;">
                      <a href="mailto:${footer.email}" style="color:#ffffff; text-decoration:none;">${footer.email}</a>
                    </p>
                  </td>
                  <td width="60%" valign="middle" bgcolor="#000000" style="width:60%; padding:0; background-color:#000000; vertical-align:middle;">
                    <img src="${EMAIL_ASSETS.footerWhiteCar}" alt="SkyGloss team" width="350" style="display:block; width:100%; max-width:368px; height:auto; border:0;">
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#000000" style="padding:20px 0; background-color:#000000;">
              <img src="${EMAIL_ASSETS.footerWhite}" alt="SKYGLOSS" width="${EMAIL_WIDTH}" style="display:block; width:100%; max-width:${EMAIL_WIDTH}px; height:auto; border:0; padding:0; margin:0;">
            </td>
          </tr>`;
}

export function getCurrencySymbol(currency?: string): string {
  const map: Record<string, string> = {
    USD: '$',
    AUD: '$',
    CAD: '$',
    EUR: '€',
    GBP: '£',
    INR: '₹',
    AED: 'AED ',
  };
  const code = (currency || 'USD').toUpperCase();
  return map[code] || `${code} `;
}

export function formatMoney(symbol: string, amount: number): string {
  return `${symbol}${Number(amount).toFixed(2)}`;
}

export function buildLatestOrderItemsHtml(
  items: any[],
  symbol: string,
  displayName: (item: any) => string,
  typeLabel: (orderType?: string) => string,
): string {
  return (items || [])
    .map((item) => {
      const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
      const size = item.size || item.variant || '';
      const type = typeLabel(item.orderType);
      return `
      <tr>
        <td style="padding:12px 0; border-bottom:1px solid #e8eef3; font-size:14px; line-height:1.45; color:#000000; vertical-align:top;">
          <strong style="font-weight:bold; color:#000000;">${displayName(item)}</strong>
          ${size ? `<br><span style="font-size:12px; color:#666666;">Size: ${size}</span>` : ''}
          ${type ? `<br><span style="font-size:12px; color:#666666;">Type: ${type}</span>` : ''}
        </td>
        <td align="center" style="padding:12px 8px; border-bottom:1px solid #e8eef3; font-size:14px; color:#000000; vertical-align:top; white-space:nowrap;">
          ${item.quantity}
        </td>
        <td align="right" style="padding:12px 0; border-bottom:1px solid #e8eef3; font-size:14px; color:#000000; vertical-align:top; white-space:nowrap;">
          ${formatMoney(symbol, lineTotal)}
        </td>
      </tr>`;
    })
    .join('');
}

export function wrapLatestEmail(title: string, bodyRows: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
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
        <table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:${EMAIL_WIDTH}px; max-width:${EMAIL_WIDTH}px; margin:0 auto; background-color:#ffffff;">
          <tbody>
          ${bodyRows}
          </tbody>
        </table>
      </td>
    </tr></tbody>
  </table>
</body>
</html>`;
}

export function wrapLatestOrderEmail(title: string, bodyRows: string): string {
  return wrapLatestEmail(
    title,
    `
          <tr>
            <td bgcolor="#ffffff" style="padding:20px 0; background-color:#ffffff;">
              <img src="${EMAIL_ASSETS.blueLogoHeader}" alt="SKYGLOSS" width="${EMAIL_WIDTH}" style="display:block; width:100%; max-width:${EMAIL_WIDTH}px; height:auto; border:0; outline:none; text-decoration:none; padding:0; margin:0;">
            </td>
          </tr>
          ${bodyRows}`,
  );
}

export function pillCta(href: string, label: string): string {
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

export function detailsCard(title: string, rowsHtml: string): string {
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

export function detailRow(label: string, value: string, isLast = false): string {
  return `
    <tr>
      <td style="padding:${isLast ? '0' : '0 0 8px 0'}; font-size:14px; line-height:1.5; color:#000000;">
        <span style="color:#666666;">${label}</span><br>
        <strong style="font-weight:bold; color:#000000;">${value}</strong>
      </td>
    </tr>`;
}

export function shippingAddressBlock(addr: {
  name?: string;
  line1?: string;
  address?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  zipCode?: string;
  country?: string;
}): string {
  const line1 = addr.line1 || addr.address || '';
  if (!line1 && !addr.city) return '';
  return `
    <tr>
      <td bgcolor="#ffffff" style="padding:28px 40px 8px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif;">
        <p style="margin:0 0 10px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Shipping To</p>
        <p style="margin:0; font-size:14px; line-height:1.6; color:#000000;">
          <strong style="font-weight:bold;">${addr.name || ''}</strong><br>
          ${line1}<br>
          ${addr.line2 ? `${addr.line2}<br>` : ''}
          ${[addr.city, addr.state, addr.zip || addr.zipCode].filter(Boolean).join(', ')}<br>
          ${addr.country || ''}
        </p>
      </td>
    </tr>`;
}

export function helpBlock(text: string): string {
  return `
    <tr>
      <td bgcolor="#ffffff" style="padding:28px 40px 36px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; color:#000000;">
        <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">Need Help?</p>
        <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">${text}</p>
      </td>
    </tr>`;
}

export function blueClosingBlock(paragraphs: string[]): string {
  const html = paragraphs
    .map(
      (p, i) =>
        `<p style="margin:0 ${i === paragraphs.length - 1 ? '0' : '0 0 14px 0'}; color:#ffffff;">${p}</p>`,
    )
    .join('');
  return `
    <tr>
      <td bgcolor="${BRAND_BLUE}" style="padding:36px; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65;">
        ${html}
      </td>
    </tr>`;
}
