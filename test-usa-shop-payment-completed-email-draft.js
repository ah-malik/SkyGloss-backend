/**
 * DRAFT USA Shop Payment Completed Email â€“ visual test only.
 * Does NOT replace the live payment confirmation in mail.service.ts
 * (sendDistributorPaymentConfirmation).
 *
 * Run: node test-usa-shop-payment-completed-email-draft.js
 * Sends to: it@skygloss.com
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './.env' });

const ASSETS = {
  // Blue logo â€“ header only (do NOT use black logo here)
  blueLogoHeader:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784290766/svnkjkigtjacvlsoiktt.png',
  footerWhite:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204256/fsxmdvqtln4zsejc8c53.png',
  footerWhiteCar:
    'https://res.cloudinary.com/dxhmopbei/image/upload/v1784204545/gxnxmjx9e6d48x3u7ifr.png',
};

const BRAND_BLUE = '#00AEEF';
const WIDTH = 600;
const loginLink = 'https://portal.skygloss.com/login/shop';

const sampleUser = {
  firstName: 'Test',
  lastName: 'User',
  name: 'Test User',
  email: 'it@skygloss.com',
  company: 'SkyGloss IT',
  country: 'United States',
};

function buildDraftUsaShopPaymentCompletedHtml(user) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Payment & Activation Confirmed â€“ SkyGloss</title>
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

          <!-- 1. Header: blue logo â€“ L/R padding 0 -->
          <tbody><tr>
            <td bgcolor="#ffffff" style="padding:20px 0; background-color:#ffffff;">
              <img src="${ASSETS.blueLogoHeader}" alt="SKYGLOSS" width="${WIDTH}" style="display:block; width:100%; max-width:${WIDTH}px; height:auto; border:0; outline:none; text-decoration:none; padding:0; margin:0;">
            </td>
          </tr>

          <!-- 2. Payment confirmed copy -->
          <tr>
            <td bgcolor="#ffffff" style="padding:36px 40px 8px 40px; background-color:#ffffff; color:#000000; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.7; text-align:left;">
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Hello ${user.firstName},</p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;"><strong style="font-weight:bold; color:#000000;">Payment received. Your account is activated.</strong></p>
              <p style="margin:0 0 18px 0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">Welcome to <strong style="font-weight:bold;">SkyGloss</strong>. Your registration payment has been successfully processed, and you now have full access to the SkyGloss Portal.</p>
              <p style="margin:0; font-weight:normal; font-size:15px; line-height:1.7; color:#000000;">You've taken the first step into a different way of working with paint&mdash;one that focuses on building, not cutting. Everything from here is designed to be simple, clear, and easy to implement in your shop.</p>
            </td>
          </tr>

          <!-- 3. Your details card -->
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
                            <strong style="font-weight:bold; color:#000000;">${user.firstName} ${user.lastName}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:0 0 8px 0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Email</span><br>
                            <strong style="font-weight:bold; color:#000000;">${user.email}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:0; font-size:14px; line-height:1.5; color:#000000;">
                            <span style="color:#666666;">Company</span><br>
                            <strong style="font-weight:bold; color:#000000;">${user.company}</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>

          <!-- 4. Getting started -->
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
                          <a href="${loginLink}" target="_blank" style="display:inline-block; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:14px; font-weight:bold; letter-spacing:0.8px; text-decoration:none; padding:16px 48px; border-radius:40px; border:1px solid ${BRAND_BLUE}; text-transform:uppercase;">
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

          <!-- 5. What this means -->
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

          <!-- 6. Closing blue -->
          <tr>
            <td bgcolor="${BRAND_BLUE}" style="padding:36px; background-color:${BRAND_BLUE}; color:#ffffff; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65;">
              <p style="margin:0 0 14px 0; color:#ffffff;">Thank you for choosing SkyGloss.</p>
              <p style="margin:0 0 14px 0; color:#ffffff;">We're excited to support you through training, certification, and beyond.</p>
              <p style="margin:0; color:#ffffff;">Best regards,<br>The SkyGloss Team</p>
            </td>
          </tr>

          <!-- 7. Footer: contact + car -->
          <tr>
            <td bgcolor="#000000" style="padding:0; background-color:#000000;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tbody><tr>
                  <td width="40%" valign="middle" bgcolor="#000000" style="width:40%; padding:28px 22px; background-color:#000000; vertical-align:middle;">
                    <p style="margin:0 0 4px 0; font-family: Arial, Helvetica, sans-serif; font-size:13px; font-weight:bold; color:#ffffff; letter-spacing:0.5px;">
                      SkyGloss Global
                    </p>
                    <p style="margin:0 0 10px 0; font-family: Arial, Helvetica, sans-serif; font-size:12px; font-weight:bold; color:${BRAND_BLUE}; letter-spacing:0.5px;">
                      Certification Department
                    </p>
                    <p style="margin:0 0 4px 0; font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#ffffff;">
                      +1 602 784 4113
                    </p>
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

          <!-- 8. Footer white logo -->
          <tr>
            <td bgcolor="#000000" style="padding:20px 0; background-color:#000000;">
              <img src="${ASSETS.footerWhite}" alt="SKYGLOSS" width="${WIDTH}" style="display:block; width:100%; max-width:${WIDTH}px; height:auto; border:0; padding:0; margin:0;">
            </td>
          </tr>

        </tbody></table>

        <table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${WIDTH}px; max-width:${WIDTH}px;">
          <tbody><tr>
            <td style="padding:16px 8px; font-family: Arial, Helvetica, sans-serif; font-size:11px; color:#888888; text-align:center;">
              DRAFT TEMPLATE â€“ for testing only. Not the live USA shop payment completed email.
            </td>
          </tr>
        </tbody></table>

      </td>
    </tr>
  </tbody></table>
</body>
</html>`;
}

async function sendDraftUsaShopPaymentCompletedEmail() {
  // Draft only â€“ not wired to mail.service.ts.
  const fromUser = 'sales@skygloss.com';
  const fromPass = 'wsux didm itaa zeds';

  const html = buildDraftUsaShopPaymentCompletedHtml(sampleUser);

  const previewPath = path.join(__dirname, 'usa-shop-payment-completed-email-draft-preview.html');
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
    subject: `[DRAFT TEST] USA Shop Payment & Activation Confirmed â€“ ${stamp}`,
    html,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log('Draft USA shop payment completed email sent to it@skygloss.com');
  console.log('From:', mailOptions.from);
  console.log('Subject:', mailOptions.subject);
  console.log('SMTP response:', info.response);
  console.log('Live template in mail.service.ts was NOT changed.');
}

sendDraftUsaShopPaymentCompletedEmail().catch((error) => {
  console.error('Failed to send draft USA shop payment completed email:', error.message);
  process.exit(1);
});
