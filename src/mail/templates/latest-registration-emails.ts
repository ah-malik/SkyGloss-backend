import {
  EMAIL_ASSETS,
  BRAND_BLUE,
  EMAIL_WIDTH,
  FooterContact,
  buildRepresentativeFooterBlock,
  wrapLatestEmail,
  wrapLatestOrderEmail,
} from './latest-shared';

function resolveRegistrationName(userDetails: any): string {
  const full = [userDetails?.firstName, userDetails?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return full || userDetails?.firstName || userDetails?.name || 'there';
}

function resolveRegistrationCompany(userDetails: any): string {
  return userDetails?.companyName || userDetails?.shopName || userDetails?.company || 'N/A';
}

function widePillCta(href: string, label: string): string {
  return `
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px 0;">
                      <tbody><tr>
                        <td align="center">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                            <tbody><tr>
                              <td align="center" bgcolor="${BRAND_BLUE}" style="background-color:${BRAND_BLUE}; border-radius:40px; mso-padding-alt:16px 48px;">
                                <a href="${href}" target="_blank" style="display:inline-block; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:14px; font-weight:bold; letter-spacing:0.8px; text-decoration:none; padding:16px 48px; border-radius:40px; border:1px solid ${BRAND_BLUE}; text-transform:uppercase;">
                                  ${label}
                                </a>
                              </td>
                            </tr>
                          </tbody></table>
                        </td>
                      </tr>
                    </tbody></table>`;
}

function succeedSection(includePaymentInHelp: boolean): string {
  const helpLine = includePaymentInHelp
    ? `Whether you have questions about payment, training, products, certification, or implementing SkyGloss in your shop, our team is here to support you.`
    : `Whether you have questions about training, products, certification or implementing SkyGloss within your business, our team is here to support you.`;

  return `
          <tr>
            <td bgcolor="#ffffff" style="padding:42px 36px 32px 36px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif;">
              <p style="margin:0 0 6px 0; text-align:center; font-size:13px; letter-spacing:2px; font-weight:bold; color:#111111; text-transform:uppercase;">
                WE'RE HERE TO HELP YOU
              </p>
              <p style="margin:0 0 24px 0; text-align:center; font-size:42px; line-height:1; font-weight:bold; color:${BRAND_BLUE}; letter-spacing:2px; text-transform:uppercase;">
                SUCCEED
              </p>
              <p style="margin:0 0 14px 0; color:#111111; font-size:15px; line-height:1.65; text-align:left;">
                Your success is important to us.
              </p>
              <p style="margin:0 0 14px 0; color:#111111; font-size:15px; line-height:1.65; text-align:left;">
                ${helpLine}
              </p>
              <p style="margin:0 0 14px 0; color:#111111; font-size:15px; line-height:1.65; text-align:left;">
                Don't hesitate to reach out at any point along the way. We're committed to providing the guidance, resources, and support you need to get the most from your SkyGloss experience.
              </p>
              <p style="margin:0; color:#111111; font-size:15px; line-height:1.65; text-align:left; font-weight:bold;">
                You're never on your own.
              </p>
            </td>
          </tr>`;
}

function buildActivatedWelcomeBody(
  name: string,
  email: string,
  company: string,
  loginLink: string,
  footerContact?: FooterContact | null,
): string {
  return `
          <tr>
            <td bgcolor="#ffffff" style="padding:0; background-color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tbody><tr>
                  <td bgcolor="#ffffff" style="padding:28px 0 0 0; background-color:#ffffff;">
                    <img src="${EMAIL_ASSETS.blackLogoTop}" alt="SKYGLOSS" width="${EMAIL_WIDTH}" style="display:block; width:100%; max-width:${EMAIL_WIDTH}px; height:auto; border:0; outline:none; text-decoration:none;">
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Hello ${name},</p>
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">Welcome to SkyGloss</strong>, and thank you for registering.</p>
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">We're excited you've decided to join us.</p>
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Your account has been successfully created, giving you access to the SkyGloss Portal&mdash;your home for training, product information, certification, and the resources you'll need as you begin your SkyGloss journey.</p>
                    <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Whether you're here to expand your services, strengthen your skills, or explore a different approach to paint restoration, we're committed to helping you succeed every step of the way.</p>
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#ffffff" style="padding:22px 40px 28px 40px; background-color:#ffffff;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                      <tbody><tr>
                        <td width="4" bgcolor="${BRAND_BLUE}" style="width:4px; background-color:${BRAND_BLUE}; font-size:0; line-height:0;">&nbsp;</td>
                        <td bgcolor="#f5f9fc" style="background-color:#f5f9fc; padding:18px 20px; font-family: Arial, Helvetica, sans-serif; color:#000000;">
                          <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">
                            Your Details
                          </p>
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tbody>
                              <tr>
                                <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                                  <span style="color:#666666;">Name</span><br>
                                  <strong style="font-weight:bold; color:#000000;">${name}</strong>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                                  <span style="color:#666666;">Email</span><br>
                                  <strong style="font-weight:bold; color:#000000;">${email}</strong>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding:0; font-size:14px; line-height:1.5; color:#000000;">
                                  <span style="color:#666666;">Company</span><br>
                                  <strong style="font-weight:bold; color:#000000;">${company}</strong>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody></table>
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:0; background-color:#ffffff;">
              <img src="${EMAIL_ASSETS.signatureCar}" alt="Factory Forever – SkyGloss" width="${EMAIL_WIDTH}" style="display:block; width:100%; max-width:${EMAIL_WIDTH}px; height:auto; border:0;">
            </td>
          </tr>
          <tr>
            <td bgcolor="#000000" style="padding:0; background-color:#000000;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tbody><tr>
                  <td align="center" bgcolor="#000000" style="padding:18px 28px 18px 28px; background-color:#000000; text-align:center;">
                    <p style="margin:0;font-family: Arial, Helvetica, sans-serif;font-size:44px;line-height:1;font-weight:800;color:${BRAND_BLUE};letter-spacing:0.5rem;text-transform:uppercase;text-align:center;">
                      GET STARTED
                    </p>
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#000000" style="padding:20px 40px 44px 40px; background-color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65; color:#ffffff; text-align:left;">
                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">1. Access Your Portal</p>
                    <p style="margin:0 0 22px 0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">Log in to your SkyGloss Portal to access your dashboard, online training, product information, resources, and account settings.</p>
                    ${widePillCta(loginLink, 'ACCESS SKYGLOSS PORTAL')}
                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">2. Explore the Platform</p>
                    <p style="margin:0 0 28px 0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">Take a few minutes to become familiar with everything available to you. From technical resources to product information and training materials, we've built the portal to support you throughout your certification and beyond.</p>
                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">3. Complete Your Online Training</p>
                    <p style="margin:0 0 28px 0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">Complete the online certification courses at your own pace. Each lesson is designed to help you understand the SkyGloss process and prepare you for hands-on certification.</p>
                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">4. Complete Your Certification</p>
                    <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">Once you've completed your online training, you can submit a request for final certification with your local SkyGloss representative. They'll guide you through the remaining steps to complete your certification and become officially <strong style="font-weight:bold; color:#ffffff;">SkyGloss Certified.</strong></p>
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#000000" style="padding:0; background-color:#000000;">
              <img src="${EMAIL_ASSETS.blackTshirtMan}" alt="SkyGloss technician" width="${EMAIL_WIDTH}" style="display:block; width:100%; max-width:${EMAIL_WIDTH}px; height:auto; border:0;">
            </td>
          </tr>
          ${succeedSection(false)}
          <tr>
            <td bgcolor="${BRAND_BLUE}" style="padding:36px; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65;">
              <p style="margin:0 0 14px 0; color:#ffffff;">Thank you again for choosing SkyGloss.</p>
              <p style="margin:0 0 14px 0; color:#ffffff;">We appreciate the opportunity to be part of your business and look forward to supporting you throughout your certification and beyond.</p>
              <p style="margin:0 0 14px 0; color:#ffffff;">We're excited to be part of your journey.</p>
              <p style="margin:0; color:#ffffff;">Best regards,</p>
            </td>
          </tr>
          ${buildRepresentativeFooterBlock(footerContact)}`;
}

function buildPendingPaymentWelcomeBody(
  name: string,
  email: string,
  company: string,
  country: string,
  loginLink: string,
  footerContact?: FooterContact | null,
): string {
  return `
          <tr>
            <td bgcolor="#ffffff" style="padding:0; background-color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tbody><tr>
                  <td bgcolor="#ffffff" style="padding:28px 0 0 0; background-color:#ffffff;">
                    <img src="${EMAIL_ASSETS.blackLogoTop}" alt="SKYGLOSS" width="${EMAIL_WIDTH}" style="display:block; width:100%; max-width:${EMAIL_WIDTH}px; height:auto; border:0; outline:none; text-decoration:none;">
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Hello ${name},</p>
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">Welcome to SkyGloss, thank you for registering.</strong></p>
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">We're excited to show you around!</p>
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Your account has been successfully created. To activate full access to the SkyGloss Portal&mdash;including training, product ordering, certification, and resources&mdash;please complete your registration payment.</p>
                    <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Whether you're here to expand your services, strengthen your skills, or explore a different approach to paint restoration, we are committed to helping you every setps of the way</p>
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#ffffff" style="padding:22px 40px 28px 40px; background-color:#ffffff;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                      <tbody><tr>
                        <td width="4" bgcolor="${BRAND_BLUE}" style="width:4px; background-color:${BRAND_BLUE}; font-size:0; line-height:0;">&nbsp;</td>
                        <td bgcolor="#f5f9fc" style="background-color:#f5f9fc; padding:18px 20px; font-family: Arial, Helvetica, sans-serif; color:#000000;">
                          <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">
                            Your Details
                          </p>
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tbody>
                              <tr>
                                <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                                  <span style="color:#666666;">Name</span><br>
                                  <strong style="font-weight:bold; color:#000000;">${name}</strong>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                                  <span style="color:#666666;">Email</span><br>
                                  <strong style="font-weight:bold; color:#000000;">${email}</strong>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                                  <span style="color:#666666;">Company</span><br>
                                  <strong style="font-weight:bold; color:#000000;">${company}</strong>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding:0; font-size:14px; line-height:1.5; color:#000000;">
                                  <span style="color:#666666;">Location</span><br>
                                  <strong style="font-weight:bold; color:#000000;">${country}</strong>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody></table>
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:0; background-color:#ffffff;">
              <img src="${EMAIL_ASSETS.signatureCar}" alt="Factory Forever – SkyGloss" width="${EMAIL_WIDTH}" style="display:block; width:100%; max-width:${EMAIL_WIDTH}px; height:auto; border:0;">
            </td>
          </tr>
          <tr>
            <td bgcolor="#000000" style="padding:0; background-color:#000000;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tbody><tr>
                  <td align="center" bgcolor="#000000" style="padding:18px 28px 18px 28px; background-color:#000000; text-align:center;">
                    <p style="margin:0;font-family: Arial, Helvetica, sans-serif;font-size:44px;line-height:1;font-weight:800;color:${BRAND_BLUE};letter-spacing:0.5rem;text-transform:uppercase;text-align:center;">
                      GET STARTED
                    </p>
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#000000" style="padding:20px 40px 44px 40px; background-color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65; color:#ffffff; text-align:left;">
                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">1. Get SkyGloss Certified</p>
                    <p style="margin:0 0 22px 0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">Get SkyGloss Certified with FUSION by completing the payment and starting the courses.</p>
                    ${widePillCta(loginLink, 'COMPLETE PAYMENT &amp; ACTIVATE')}
                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">2. Check out the Portal</p>
                    <p style="margin:0 0 28px 0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">SkyGloss is continuing to build a robust portal to have access to everything you need all in one place. From training courses to certification to marketing resources. Take a look around!</p>
                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">3. Complete Your Online Training</p>
                    <p style="margin:0 0 28px 0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">Complete the online certification courses at your own pace. Each lesson is designed to help you understand the SkyGloss process and prepare you for hands-on certification.</p>
                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">4. Complete Your Certification</p>
                    <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">Once you completed your online training, submit a request for final certification. This is where your local representative will work out the details to make sure that you're fully certified.</p>
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#000000" style="padding:0; background-color:#000000;">
              <img src="${EMAIL_ASSETS.blackTshirtMan}" alt="SkyGloss technician" width="${EMAIL_WIDTH}" style="display:block; width:100%; max-width:${EMAIL_WIDTH}px; height:auto; border:0;">
            </td>
          </tr>
          ${succeedSection(true)}
          <tr>
            <td bgcolor="${BRAND_BLUE}" style="padding:36px; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65;">
              <p style="margin:0 0 14px 0; color:#ffffff;">Thank you again for choosing SkyGloss.</p>
              <p style="margin:0 0 14px 0; color:#ffffff;">We appreciate the opportunity to be part of your business and look forward to Supporting you throughout the on boarding process and certification. </p>
              <p style="margin:0 0 14px 0; color:#ffffff;">We're excited to be part of your journey.</p>
              <p style="margin:0; color:#ffffff;">Best regards,</p>
            </td>
          </tr>
          ${buildRepresentativeFooterBlock(footerContact)}`;
}

export function buildLatestWelcomeRegistrationHtml(
  userDetails: any,
  options: {
    loginLink: string;
    isActivated: boolean;
    footerContact?: FooterContact | null;
  },
): string {
  const name = resolveRegistrationName(userDetails);
  const email = userDetails?.email || '';
  const company = resolveRegistrationCompany(userDetails);
  const country = userDetails?.country || '';

  const body = options.isActivated
    ? buildActivatedWelcomeBody(
        name,
        email,
        company,
        options.loginLink,
        options.footerContact,
      )
    : buildPendingPaymentWelcomeBody(
        name,
        email,
        company,
        country,
        options.loginLink,
        options.footerContact,
      );

  return wrapLatestEmail('Welcome to SkyGloss', body);
}

export function buildLatestRegistrationPaymentConfirmedHtml(
  userDetails: any,
  options: {
    loginLink: string;
    footerContact?: FooterContact | null;
  },
): string {
  const firstName = userDetails?.firstName || resolveRegistrationName(userDetails);
  const name = resolveRegistrationName(userDetails);
  const email = userDetails?.email || '';
  const company = resolveRegistrationCompany(userDetails);

  const body = `
          <tr>
            <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Hello ${firstName},</p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">Payment received. Your account is activated.</strong></p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Welcome to <strong style="font-weight:bold;">SkyGloss</strong>. Your registration payment has been successfully processed, and you now have full access to the SkyGloss Portal.</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">You've taken the first step into a different way of working with paint&mdash;one that focuses on building, not cutting. Everything from here is designed to be simple, clear, and easy to implement in your shop.</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:22px 40px 8px 40px; background-color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                <tbody><tr>
                  <td width="4" bgcolor="${BRAND_BLUE}" style="width:4px; background-color:${BRAND_BLUE}; font-size:0; line-height:0;">&nbsp;</td>
                  <td bgcolor="#f5f9fc" style="background-color:#f5f9fc; padding:18px 20px; font-family: Arial, Helvetica, sans-serif; color:#000000;">
                    <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">
                      Your Details
                    </p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tbody>
                        <tr>
                          <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Name</span><br>
                            <strong style="font-weight:bold; color:#000000;">${name}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Email</span><br>
                            <strong style="font-weight:bold; color:#000000;">${email}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Company</span><br>
                            <strong style="font-weight:bold; color:#000000;">${company}</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 8px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; color:#000000;">
              <p style="margin:0 0 18px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">
                Getting Started
              </p>
              <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#000000;">1. Access the Portal</p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Log in to explore your dashboard, training, product information, and account settings.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
                <tbody><tr>
                  <td align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tbody><tr>
                        <td align="center" bgcolor="${BRAND_BLUE}" style="background-color:${BRAND_BLUE}; border-radius:40px; mso-padding-alt:16px 48px;">
                          <a href="${options.loginLink}" target="_blank" style="display:inline-block; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:14px; font-weight:bold; letter-spacing:0.8px; text-decoration:none; padding:16px 48px; border-radius:40px; border:1px solid ${BRAND_BLUE}; text-transform:uppercase;">
                            ACCESS SKYGLOSS PORTAL
                          </a>
                        </td>
                      </tr>
                    </tbody></table>
                  </td>
                </tr>
              </tbody></table>
              <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#000000;">2. Get Familiar + Order Product</p>
              <p style="margin:0 0 22px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Take a few minutes to explore the platform, then place your initial product order when you're ready.</p>
              <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#000000;">3. Complete Training Courses</p>
              <p style="margin:0 0 22px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Complete the online certification courses at your own pace. Each lesson is designed to help you understand the SkyGloss process.</p>
              <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#000000;">4. Request Certification</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Once your online training is complete, submit a certification request. We'll guide you through the final steps to become officially SkyGloss Certified.</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 40px 36px 40px; background-color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; color:#000000;">
              <p style="margin:0 0 12px 0; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:${BRAND_BLUE}; text-transform:uppercase;">
                What This Means
              </p>
              <p style="margin:0 0 14px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">SkyGloss isn't a replacement&mdash;it's a powerful new tool for your shop.</p>
              <p style="margin:0 0 6px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">A better foundation</p>
              <p style="margin:0 0 6px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">A faster process</p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">A healthier finish</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">If you have any questions, please contact us at <a href="mailto:sales@skygloss.com" style="color:${BRAND_BLUE}; text-decoration:none;">sales@skygloss.com</a>.</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="${BRAND_BLUE}" style="padding:36px; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65;">
              <p style="margin:0 0 14px 0; color:#ffffff;">Thank you for choosing SkyGloss.</p>
              <p style="margin:0 0 14px 0; color:#ffffff;">We're excited to support you through training, certification, and beyond.</p>
              <p style="margin:0; color:#ffffff;">Best regards,<br>The SkyGloss Team</p>
            </td>
          </tr>
          ${buildRepresentativeFooterBlock(options.footerContact)}`;

  return wrapLatestOrderEmail('Payment & Activation Confirmed – SkyGloss', body);
}
