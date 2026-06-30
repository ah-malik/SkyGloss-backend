const nodemailer = require('nodemailer');
require('dotenv').config({ path: './.env' });

const userDetails = {
  firstName: 'Test',
  lastName: 'User',
  email: 'it@skygloss.com',
  companyName: 'SkyGloss IT',
  role: 'certified_shop',
};

const loginLink = 'https://portal.skygloss.com/login/shop';

const portalButton = `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:25px 0;">
    <tr>
      <td align="center">
        <a href="${loginLink}" style="background-color:#0ea0dc; color:#ffffff; padding:14px 28px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block;">
          Access SkyGloss Portal
        </a>
      </td>
    </tr>
  </table>`;

async function sendTestPaymentWelcomeEmail() {
  const salesUser = process.env.SALES_MAIL_USER || 'sales@skygloss.com';
  const salesPass = process.env.SALES_MAIL_PASS;

  const transporter = salesPass
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: salesUser, pass: salesPass },
      })
    : nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.MAIL_USER,
          pass: process.env.MAIL_PASS,
        },
      });

  const fromAddress = salesPass
    ? `"SkyGloss Sales" <${salesUser}>`
    : `"SkyGloss Support" <${process.env.MAIL_USER}>`;

  const mailOptions = {
    from: fromAddress,
    to: 'it@skygloss.com',
    subject: 'SkyGloss - Payment & Activation Confirmed (Test)',
    html: `
      <body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin:20px 0; border-radius:8px;">
              <tr><td align="center" bgcolor="#0ea0dc" style="padding:20px; color:#ffffff; font-size:24px; font-weight:bold;">SkyGloss</td></tr>
              <tr><td style="padding:30px; color:#333333; font-size:14px; line-height:1.6;">
                <p>Hello ${userDetails.firstName},</p>
                <p>Welcome to <strong>SkyGloss</strong>! We’re excited to have you get started.</p>
                <h3 style="color:#0ea0dc;">Getting Started</h3>
                <p><strong>1. Access the Portal</strong><br>Log in and explore your dashboard.</p>
                <p>Thank you. Your payment has been successfully processed. You may now access the SkyGloss Portal.</p>
                ${portalButton}
                <p>Best Regards,<br>SkyGloss Team</p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>`,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`Test payment welcome email sent to it@skygloss.com via ${fromAddress}`);
  console.log('SMTP response:', info.response);
}

sendTestPaymentWelcomeEmail().catch((error) => {
  console.error('Failed to send test email:', error.message);
  process.exit(1);
});
