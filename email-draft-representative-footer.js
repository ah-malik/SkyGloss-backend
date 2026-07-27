/**
 * Shared representative footer for draft email templates.
 * Mirrors mail.service.ts buildShopContactFooter + users getLocalRepresentativeForShop:
 * show the shop's assigned representative when available, otherwise Paul Bilabe.
 */

const GLOBAL_HUB_PARTNER_CODES = new Set(['GLOBALHUB', 'GLOBAL77']);

const DEFAULT_FOOTER_CONTACT = {
  name: 'PAUL BILABE',
  title: 'MASTER TRAINER',
  phone: '+1 (602) 784-4113',
  email: 'certified@skygloss.com',
};

function isGlobalHubPartnerCode(code) {
  if (!code?.trim()) return false;
  return GLOBAL_HUB_PARTNER_CODES.has(code.trim().toUpperCase());
}

function formatRepresentativeName(representative) {
  const fullName =
    representative?.fullName ||
    [representative?.firstName, representative?.lastName].filter(Boolean).join(' ').trim();
  return (fullName || representative?.partnerCode || 'Your Representative').toUpperCase();
}

/**
 * Resolve footer contact for a certified shop.
 * Returns Paul Bilabe defaults when no representative is assigned.
 */
function resolveShopFooterContact(shopUser, localRepresentative) {
  const isShopUser = shopUser?.role === 'certified_shop';
  const hasRepresentative =
    isShopUser &&
    localRepresentative &&
    (localRepresentative.partnerCode || localRepresentative.fullName || localRepresentative.firstName) &&
    !isGlobalHubPartnerCode(localRepresentative.partnerCode);

  if (hasRepresentative) {
    return {
      name: formatRepresentativeName(localRepresentative),
      title: 'REPRESENTATIVE',
      phone: localRepresentative.phoneNumber || DEFAULT_FOOTER_CONTACT.phone,
      email: localRepresentative.email || DEFAULT_FOOTER_CONTACT.email,
    };
  }

  return { ...DEFAULT_FOOTER_CONTACT };
}

function buildRepresentativeFooterBlock(contact, brandBlue, assets, width = 600) {
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
                    <p style="margin:0 0 10px 0; font-family: Arial, Helvetica, sans-serif; font-size:12px; font-weight:bold; color:${brandBlue}; letter-spacing:0.5px;">
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
                    <img src="${assets.footerWhiteCar}" alt="SkyGloss team" width="350" style="display:block; width:100%; max-width:368px; height:auto; border:0;">
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>

          <tr>
            <td bgcolor="#000000" style="padding:20px 0; background-color:#000000;">
              <img src="${assets.footerWhite}" alt="SKYGLOSS" width="${width}" style="display:block; width:100%; max-width:${width}px; height:auto; border:0; padding:0; margin:0;">
            </td>
          </tr>`;
}

module.exports = {
  DEFAULT_FOOTER_CONTACT,
  isGlobalHubPartnerCode,
  resolveShopFooterContact,
  buildRepresentativeFooterBlock,
};
