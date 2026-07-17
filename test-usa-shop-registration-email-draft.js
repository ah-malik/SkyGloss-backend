/**
 * DRAFT USA Shop Registration Email – visual test only.
 * Same design as Welcome Email; content tailored for USA shops.
 * Does NOT replace the live registration template in mail.service.ts.
 *
 * Run: node test-usa-shop-registration-email-draft.js
 * Sends to: it@skygloss.com
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './.env' });

const ASSETS = {
  blackLogoTop:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204179/o8eu2kwhtnmsxh0cyleb.png',
  signatureCar:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784207711/zao0iuzxys3pqnh62kfu.png',
  footerWhite:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204256/fsxmdvqtln4zsejc8c53.png',
  blackTshirtMan:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204504/aadn0mgwqlpvded4xuv3.png',
  footerWhiteCar:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204545/gxnxmjx9e6d48x3u7ifr.png',
};

const BRAND_BLUE = '#00AEEF';
const WIDTH = 600;

const userDetails = {
  name: 'Test User',
  email: 'it@skygloss.com',
  company: 'SkyGloss IT',
  country: 'United States',
};

const paymentLink = 'https://portal.skygloss.com/login/shop';
const loginLink = 'https://portal.skygloss.com/login/shop';

function buildDraftUsaShopRegistrationHtml(details) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Welcome to SkyGloss – USA Shop Registration</title>
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

          <!-- 1. Section 1: logo + welcome copy -->
          <tbody><tr>
            <td bgcolor="#ffffff" style="padding:0; background-color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tbody><tr>
                  <td bgcolor="#ffffff" style="padding:28px 0 0 0; background-color:#ffffff;">
                    <img src="${ASSETS.blackLogoTop}" alt="SKYGLOSS" width="${WIDTH}" style="display:block; width:100%; max-width:${WIDTH}px; height:auto; border:0; outline:none; text-decoration:none;">
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Hello ${details.name},</p>
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">Welcome to SkyGloss</strong>, and thank you for registering your shop in the United States.</p>
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">We're excited you've decided to join us.</p>
                    <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Your shop account has been successfully created. To activate full access to the SkyGloss Portal&mdash;including training, product ordering, certification, and resources&mdash;please complete your registration payment.</p>
                    <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Whether you're here to expand your services, strengthen your skills, or explore a different approach to paint restoration, we're committed to helping your U.S. shop succeed every step of the way.</p>
                  </td>
                </tr>

                <!-- YOUR DETAILS – below welcome text (email-safe card) -->
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
                                  <strong style="font-weight:bold; color:#000000;">${details.name}</strong>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                                  <span style="color:#666666;">Email</span><br>
                                  <strong style="font-weight:bold; color:#000000;">${details.email}</strong>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                                  <span style="color:#666666;">Company</span><br>
                                  <strong style="font-weight:bold; color:#000000;">${details.company}</strong>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding:0; font-size:14px; line-height:1.5; color:#000000;">
                                  <span style="color:#666666;">Location</span><br>
                                  <strong style="font-weight:bold; color:#000000;">${details.country}</strong>
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

          <!-- 2. Signature + Car image (above black section) -->
          <tr>
            <td bgcolor="#ffffff" style="padding:0; background-color:#ffffff;">
              <img src="${ASSETS.signatureCar}" alt="Factory Forever – SkyGloss" width="${WIDTH}" style="display:block; width:100%; max-width:${WIDTH}px; height:auto; border:0;">
            </td>
          </tr>

          <!-- 2b. Black section: GET STARTED + steps (below the image) -->
          <tr>
            <td bgcolor="#000000" style="padding:0; background-color:#000000;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                <!-- GET STARTED – centered -->
                <tbody><tr>
                  <td align="center" bgcolor="#000000" style="padding:18px 28px 18px 28px; background-color:#000000; text-align:center;">
                    <p style="margin:0;font-family: Arial, Helvetica, sans-serif;font-size:44px;line-height:1;font-weight:800;color:${BRAND_BLUE};letter-spacing:0.5rem;text-transform:uppercase;text-align:center;">
                      GET STARTED
                    </p>
                  </td>
                </tr>

                <!-- Steps on solid black -->
                <tr>
                  <td bgcolor="#000000" style="padding:20px 40px 44px 40px; background-color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65; color:#ffffff; text-align:left;">

                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">1. Complete Your Payment</p>
                    <p style="margin:0 0 22px 0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">As a U.S. shop, your registration is activated once payment is complete. Secure checkout is available through the SkyGloss Portal.</p>

                    <!-- CTA – wide pill button, centered -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px 0;">
                      <tbody><tr>
                        <td align="center">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                            <tbody><tr>
                              <td align="center" bgcolor="${BRAND_BLUE}" style="background-color:${BRAND_BLUE}; border-radius:40px; mso-padding-alt:16px 48px;">
                                <a href="${paymentLink}" target="_blank" style="display:inline-block; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:14px; font-weight:bold; letter-spacing:0.8px; text-decoration:none; padding:16px 48px; border-radius:40px; border:1px solid ${BRAND_BLUE}; text-transform:uppercase;">
                                  COMPLETE PAYMENT &amp; ACTIVATE
                                </a>
                              </td>
                            </tr>
                          </tbody></table>
                        </td>
                      </tr>
                    </tbody></table>

                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">2. Access Your Portal</p>
                    <p style="margin:0 0 28px 0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">After payment, log in to your SkyGloss Portal to access your dashboard, online training, product information, ordering, resources, and account settings.</p>

                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">3. Complete Your Online Training</p>
                    <p style="margin:0 0 28px 0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">Complete the online certification courses at your own pace. Each lesson is designed to help you understand the SkyGloss process and prepare you for hands-on certification.</p>

                    <p style="margin:0 0 8px 0; font-weight:bold; font-size:15px; line-height:1.5; color:#ffffff;">4. Complete Your Certification</p>
                    <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.65; color:#ffffff;">Once you've completed your online training, submit a request for final certification. Our U.S. team will guide you through the remaining steps&mdash;including hands-on certification support based out of <strong style="font-weight:bold; color:#ffffff;">Phoenix, AZ</strong>&mdash;to become officially <strong style="font-weight:bold; color:#ffffff;">SkyGloss Certified.</strong></p>

                  </td>
                </tr>

              </tbody></table>
            </td>
          </tr>

          <!-- 5. Black T-shirt Man -->
          <tr>
            <td bgcolor="#000000" style="padding:0; background-color:#000000;">
              <img src="${ASSETS.blackTshirtMan}" alt="SkyGloss technician" width="${WIDTH}" style="display:block; width:100%; max-width:${WIDTH}px; height:auto; border:0;">
            </td>
          </tr>

          <!-- 6. Succeed -->
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
                Whether you have questions about payment, training, products, certification, or implementing SkyGloss in your U.S. shop, our team is here to support you.
              </p>
              <p style="margin:0 0 14px 0; color:#111111; font-size:15px; line-height:1.65; text-align:left;">
                Don't hesitate to reach out at any point along the way. We're committed to providing the guidance, resources, and support you need to get the most from your SkyGloss experience.
              </p>
              <p style="margin:0; color:#111111; font-size:15px; line-height:1.65; text-align:left; font-weight:bold;">
                You're never on your own.
              </p>
            </td>
          </tr>

          <!-- 7. Closing blue -->
          <tr>
            <td bgcolor="${BRAND_BLUE}" style="padding:36px; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65;">
              <p style="margin:0 0 14px 0; color:#ffffff;">Thank you again for choosing SkyGloss.</p>
              <p style="margin:0 0 14px 0; color:#ffffff;">We appreciate the opportunity to be part of your business and look forward to supporting you throughout payment, certification, and beyond.</p>
              <p style="margin:0 0 14px 0; color:#ffffff;">We're excited to be part of your journey.</p>
              <p style="margin:0; color:#ffffff;">Best regards,</p>
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
              DRAFT TEMPLATE – for testing only. Not the live USA shop registration email.
            </td>
          </tr>
        </tbody></table>

      </td>
    </tr>
  </tbody></table>
</body>
</html>`;
}

async function sendDraftUsaShopRegistrationEmail() {
  // Same as welcome draft – certified mailbox. Draft only – not wired to mail.service.ts.
  const fromUser = 'certified@skygloss.com';
  const fromPass = 'qjyi fuku tgbb xqor';

  const html = buildDraftUsaShopRegistrationHtml(userDetails);

  const previewPath = path.join(__dirname, 'usa-shop-registration-email-draft-preview.html');
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
    subject: `[DRAFT TEST] USA Shop Registration Welcome – ${stamp}`,
    html,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log('Draft USA shop registration email sent to it@skygloss.com');
  console.log('From:', mailOptions.from);
  console.log('Subject:', mailOptions.subject);
  console.log('SMTP response:', info.response);
  console.log('Live template in mail.service.ts was NOT changed.');
}

sendDraftUsaShopRegistrationEmail().catch((error) => {
  console.error('Failed to send draft USA shop registration email:', error.message);
  process.exit(1);
});
