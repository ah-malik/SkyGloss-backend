import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: this.configService.get<string>('MAIL_USER'),
        pass: this.configService.get<string>('MAIL_PASS'),
      },
    });

    this.transporter.verify((error, success) => {
      if (error) {
        this.logger.error('Transporter verification failed', error.stack);
      } else {
        this.logger.log('Transporter is ready to send emails');
      }
    });
  }

  async sendPasswordResetEmail(to: string, token: string) {
    const resetLink = `https://portal.skygloss.com/reset-password?token=${token}`;

    const mailOptions = {
      from: `"SkyGloss Support" <${this.configService.get<string>('MAIL_USER')}>`,
      to,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #0EA0DC; text-align: center;">Password Reset</h2>
          <p>Hello,</p>
          <p>You requested a password reset for your SkyGloss account. Click the button below to set a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #0EA0DC; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
          </div>
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #666;"><a href="${resetLink}">${resetLink}</a></p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">&copy; 2026 SkyGloss. All rights reserved.</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Password reset email sent to ${to}`);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${to}`,
        error.stack,
      );
      throw error;
    }
  }

  async sendDistributorRegistrationUserConfirmation(to: string, userDetails: any) {
    const loginLink = `https://portal.skygloss.com/login/distributor`;

    const mailOptions = {
      from: `"SkyGloss Support" <${this.configService.get<string>('MAIL_USER')}>`,
      to,
      subject: 'Welcome to SkyGloss - Registration Confirmation',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #0EA0DC; text-align: center;">Registration Confirmation</h2>
          <p>Hello ${userDetails.firstName},</p>
          <p>Thank you for registering as a SkyGloss Distributor. We have successfully received your registration details:</p>
          <ul>
            <li><strong>Name:</strong> ${userDetails.firstName} ${userDetails.lastName}</li>
            <li><strong>Email:</strong> ${userDetails.email}</li>
            <li><strong>Location:</strong> ${userDetails.city}, ${userDetails.country}</li>
            <li><strong>Address:</strong> ${userDetails.address}</li>
            <li><strong>Phone:</strong> ${userDetails.phoneNumber}</li>
          </ul>
          <p>Once your payment of **$250** is successfully processed, you will be able to access the Distributor Portal.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginLink}" style="background-color: #0EA0DC; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Login to Portal</a>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">&copy; ${new Date().getFullYear()} SkyGloss. All rights reserved.</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Distributor registration confirmation email sent to ${to}`);
    } catch (error) {
      this.logger.error(
        `Failed to send distributor registration confirmation email to ${to}`,
        error.stack,
      );
      // Not throwing error to avoid breaking registration flow
    }
  }

  async sendDistributorRegistrationAdminNotification(adminEmails: string[], userDetails: any) {
    const mailOptions = {
      from: `"SkyGloss System" <${this.configService.get<string>('MAIL_USER')}>`,
      to: adminEmails.join(', '),
      subject: 'New Distributor Registration (Pending Payment)',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #ff9800; text-align: center;">New Registration Received</h2>
          <p>A new user has registered as a Distributor and is currently pending payment.</p>
          <h3>User Details:</h3>
          <ul>
            <li><strong>Name:</strong> ${userDetails.firstName} ${userDetails.lastName}</li>
            <li><strong>Email:</strong> ${userDetails.email}</li>
            <li><strong>Phone:</strong> ${userDetails.phoneNumber || 'N/A'}</li>
            <li><strong>Address:</strong> ${userDetails.address}, ${userDetails.city}, ${userDetails.country}</li>
          </ul>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">SkyGloss Automated System</p>
        </div>
      `,
    };

    try {
      if (adminEmails && adminEmails.length > 0) {
        await this.transporter.sendMail(mailOptions);
        this.logger.log(`Admin notification (new registration) sent to ${adminEmails.join(', ')}`);
      }
    } catch (error) {
      this.logger.error(`Failed to send admin notification for new registration`, error.stack);
    }
  }

  async sendDistributorPaymentCompletedAdminNotification(adminEmails: string[], userDetails: any) {
    const mailOptions = {
      from: `"SkyGloss System" <${this.configService.get<string>('MAIL_USER')}>`,
      to: adminEmails.join(', '),
      subject: 'Welcome to SkyGloss Certified! ',
      // html: `
      //   <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
      //     <h2 style="color: #4caf50; text-align: center;">123 Payment Successful</h2>
      //     <p>The following distributor has successfully completed their registration payment and their account is now ACTIVE.</p>
      //     <h3>User Details:</h3>
      //     <ul>
      //       <li><strong>Name:</strong> ${userDetails.firstName} ${userDetails.lastName}</li>
      //       <li><strong>Email:</strong> ${userDetails.email}</li>
      //       <li><strong>Company:</strong> ${userDetails.companyName || 'N/A'}</li>
      //     </ul>
      //     <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      //     <p style="font-size: 12px; color: #999; text-align: center;">SkyGloss Automated System</p>
      //   </div>
      // `,
      html: `
  <body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8">
    <tr>
      <td align="center">

        <!-- Main Container -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin:20px 0; border-radius:8px; overflow:hidden;">
          
          <!-- Header -->
          <tr>
            <td align="center" bgcolor="#0ea0dc" style="padding:20px; color:#ffffff; font-size:24px; font-weight:bold;">
              SkyGloss
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:30px; color:#333333; font-size:14px; line-height:1.6;">
              <p>Hello ${userDetails.firstName},</p>

              <p>Welcome to <strong>SkyGloss</strong>! We’re excited to have you get started.</p>

              <p>
                You’ve just taken the first step into a different way of working with paint—one that focuses on building, not cutting.
                Everything from here is designed to be simple, clear, and easy to implement into your shop.
              </p>

              <!-- User Details Box -->
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

          <!-- Footer -->
          <tr>
            <td style="padding:25px; background:#f7f7f7; border-top:1px solid #ddd;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  
                  <!-- Left -->
                  <td width="50%" valign="top">
                    <img src="https://res.cloudinary.com/dxhmopbei/image/upload/v1775819331/oh4qwvsxa4m9mjecp5y0.png" width="160" style="display:block;"><br><br>
                    <a href="https://skygloss.com" style="color:#0ea0dc; text-decoration:none;">skygloss.com</a>
                  </td>

                  <!-- Right -->
                  <td width="50%" valign="top" style="font-size:14px; color:#555;">
                    <strong>Certification Department</strong><br>
                    SkyGloss Global<br><br>
                    📞 +1 (602) 784-4113<br>
                    ✉️ certified@skygloss.com
                  </td>

                </tr>
              </table>
            </td>
          </tr>

          <!-- Banner Image -->
          <tr>
            <td>
              <img src="https://res.cloudinary.com/dxhmopbei/image/upload/v1775819280/wwho4i1gfefqghrykybt.png" width="100%" style="display:block;">
            </td>
          </tr>

          <!-- Bottom Spacer -->
          <tr>
            <td style="padding:25px; background:#ffffff; border-top:1px solid #eee;">
            </td>
          </tr>

        </table>
        <!-- End Main Container -->

      </td>
    </tr>
  </table>
</body>`,
    };

    try {
      if (adminEmails && adminEmails.length > 0) {
        await this.transporter.sendMail(mailOptions);
        this.logger.log(`Admin notification (payment completed) sent to ${adminEmails.join(', ')}`);
      }
    } catch (error) {
      this.logger.error(`Failed to send admin notification for payment completed`, error.stack);
    }
  }

  async sendDistributorPaymentConfirmation(to: string, userDetails: any) {
    const mailOptions = {
      from: `"SkyGloss Support" <${this.configService.get<string>('MAIL_USER')}>`,
      to,
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
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Payment confirmation email sent to user ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send payment confirmation email to ${to}`, error.stack);
    }
  }
}

