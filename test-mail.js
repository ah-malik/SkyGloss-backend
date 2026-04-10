const nodemailer = require('nodemailer');
require('dotenv').config({ path: './.env' });

async function testEmail() {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS,
        },
    });

    const userDetails = {
        firstName: 'Abdul',
        lastName: 'Malik',
        email: 'malik26040@gmail.com',
        companyName: 'Malik Solutions'
    };

    const mailOptions = {
        from: `"SkyGloss Support" <${process.env.MAIL_USER}>`,
        to: 'malik26040@gmail.com',
        subject: 'Welcome to SkyGloss - Payment Confirmed',
        html: `
      <body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin:20px 0; border-radius:8px; overflow:hidden;">
                <tr>
                  <td align="center" bgcolor="#0ea0dc" style="padding:20px; color:#ffffff; font-size:24px; font-weight:bold;">
                    SkyGloss
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px; color:#333333; font-size:14px; line-height:1.6;">
                    <p>Hello ${userDetails.firstName},</p>
                    <p>Welcome to <strong>SkyGloss</strong>! We’re excited to have you get started.</p>
                    <p>
                      You’ve just taken the first step into a different way of working with paint—one that focuses on building, not cutting.
                      Everything from here is designed to be simple, clear, and easy to implement into your shop.
                    </p>
                    <table width="100%" cellpadding="10" cellspacing="0" style="background:#f0f8fc; border-left:4px solid #0ea0dc; margin:20px 0;">
                      <tr>
                        <td>
                          <strong>Your Details:</strong><br><br>
                          Name: ${userDetails.firstName} ${userDetails.lastName}<br>
                          Email: ${userDetails.email}<br>
                          Company: ${userDetails.companyName || 'N/A'}
                        </td>
                      </tr>
                    </table>
                    <h3 style="color:#0ea0dc;">Getting Started</h3>
                    <p><strong>1. Access the Portal</strong><br>
                    Log in and explore your dashboard.</p>
                    <p><strong>2. Get Familiar + Order Product</strong><br>
                    Place your initial order early.</p>
                    <p><strong>3. Complete Training Courses</strong><br>
                    Learn at your own pace.</p>
                    <p><strong>4. Request Certification</strong><br>
                    Submit your certification request.</p>
                    <p>
                      Once submitted, we’ll guide you through final steps to fully certify you.
                    </p>
                    <h3 style="color:#0ea0dc;">What This Means</h3>
                    <p>SkyGloss isn’t a replacement—it’s a powerful new tool.</p>
                    <p>
                      ✔ A better foundation<br>
                      ✔ A faster process<br>
                      ✔ A healthier finish
                    </p>
                    <p>If you have any questions, we’re here to help.</p>
                    <p>Best Regards,</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:25px; background:#f7f7f7; border-top:1px solid #ddd;">
                    <table width="100%">
                      <tr>
                        <td width="50%" valign="top">
                          <img src="https://res.cloudinary.com/dxhmopbei/image/upload/v1775819331/oh4qwvsxa4m9mjecp5y0.png" width="160"><br><br>
                          <a href="https://skygloss.com" style="color:#0ea0dc; text-decoration:none;">skygloss.com</a>
                        </td>
                        <td width="50%" valign="top" style="font-size:14px; color:#555;">
                          <strong>Certification Department</strong><br>
                          SkyGloss Global<br><br>
                          📞 +1 (602) 784-4113<br>
                          ✉️ certified@skygloss.com<br>
                          📍 Phoenix, AZ, USA
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td>
                    <img src="https://res.cloudinary.com/dxhmopbei/image/upload/v1775819280/wwho4i1gfefqghrykybt.png" width="100%" style="display:block;">
                  </td>
                </tr>
                <tr>
                  <td style="padding:25px; background:#ffffff; border-top:1px solid #eee;">
                    <table width="100%">
                      <tr>
                        <td width="50%" valign="top">
                          <img src="https://res.cloudinary.com/dxhmopbei/image/upload/v1775819331/oh4qwvsxa4m9mjecp5y0.png" width="140"><br><br>
                          <a href="https://skygloss.com" style="color:#0ea0dc; text-decoration:none;">skygloss.com</a>
                        </td>
                        <td width="50%" valign="top" style="font-size:14px; color:#555;">
                          <strong>Nicholas Vaandering</strong><br>
                          Chief Executive Officer<br>
                          SkyGloss Global<br><br>
                          📞 +1 616 402 2559<br>
                          ✉️ nick@skygloss.com
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td>
                    <img src="https://res.cloudinary.com/dxhmopbei/image/upload/v1775819280/wwho4i1gfefqghrykybt.png" width="100%" style="display:block;">
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>`
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ' + info.response);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

testEmail();
