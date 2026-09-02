/**
 * Send a test withdrawal request notification to it@skygloss.com
 * Run: npx ts-node --transpile-only test-withdrawal-request-email.ts
 */
import * as nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const request = {
    requestNumber: 'WR-TEST-0001',
    requestedAmount: 250.5,
    currency: 'USD',
    status: 'waiting_hub_approval',
    userPartnerCode: 'SG-TEST-001',
    userRole: 'distributor',
    sourceHubPartnerCode: 'SG-HUB-001',
    createdAt: new Date(),
  };

  const user = {
    firstName: 'Test',
    lastName: 'Partner',
    email: 'test.partner@example.com',
    partnerCode: 'SG-TEST-001',
    role: 'distributor',
    companyName: 'SkyGloss Test Company',
  };

  const currency = (request.currency || 'USD').toUpperCase();
  const amount = `$${request.requestedAmount.toFixed(2)}`;
  const requesterName = `${user.firstName} ${user.lastName}`;
  const submittedAt = new Date(request.createdAt).toLocaleString('en-US', {
    timeZone: 'America/Phoenix',
  });

  const html = `
    <body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin:20px 0; border-radius:8px; overflow:hidden; border: 1px solid #e0e0e0;">
              <tr><td align="center" bgcolor="#0ea0dc" style="padding:20px; color:#ffffff; font-size:24px; font-weight:bold;">Withdrawal Request</td></tr>
              <tr>
                <td style="padding:30px; color:#333333; font-size:14px; line-height:1.6;">
                  <h2 style="color:#0ea0dc; margin-bottom: 5px;">New Withdrawal Request: ${request.requestNumber}</h2>
                  <p style="margin-top: 0; color: #666;">Submitted: ${submittedAt} (Arizona)</p>
                  <p style="color:#c0392b;"><strong>[TEST EMAIL]</strong> This is a test notification to verify delivery.</p>
                  <table width="100%" cellpadding="10" cellspacing="0" style="background:#f0f8fc; border-left:4px solid #0ea0dc; margin:20px 0;">
                    <tr>
                      <td>
                        <strong>Request Details</strong><br><br>
                        Request Number: <strong>${request.requestNumber}</strong><br>
                        Amount: <strong>${amount}</strong>
                      </td>
                    </tr>
                  </table>
                  <table width="100%" cellpadding="10" cellspacing="0" style="background:#fafafa; border-left:4px solid #888; margin:20px 0;">
                    <tr>
                      <td>
                        <strong>Requester</strong><br><br>
                        Name: ${requesterName}<br>
                        Email: ${user.email}<br>
                        Partner Code: ${request.userPartnerCode}<br>
                        Company: ${user.companyName}
                      </td>
                    </tr>
                  </table>
                  <p style="margin-top: 20px;">Please review this withdrawal request in the admin panel.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  `;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'sales@skygloss.com',
      pass: 'wsux didm itaa zeds',
    },
  });

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const info = await transporter.sendMail({
    from: '"SkyGloss IT" <it@skygloss.com>',
    to: 'it@skygloss.com',
    subject: `[TEST] NEW WITHDRAWAL REQUEST: ${request.requestNumber} - ${requesterName} - ${stamp}`,
    html,
  });

  console.log('Test withdrawal request email sent to it@skygloss.com');
  console.log('SMTP response:', info.response);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
