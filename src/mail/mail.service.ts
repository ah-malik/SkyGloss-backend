import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private salesTransporter: nodemailer.Transporter;
  private certifiedTransporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: ConfigService) {
    // Default Transporter (Support/General)
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: this.configService.get<string>('MAIL_USER'),
        pass: this.configService.get<string>('MAIL_PASS'),
      },
    });

    // Sales Transporter
    this.salesTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'sales@skygloss.com',
        pass: 'wsux didm itaa zeds',
      },
    });

    // Certified Transporter
    this.certifiedTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'certified@skygloss.com',
        pass: 'qjyi fuku tgbb xqor',
      },
    });

    this.verifyTransporters();
  }

  private verifyTransporters() {
    this.transporter.verify((error) => {
      if (error) this.logger.error('Default Transporter failed', error.stack);
      else this.logger.log('Default Transporter ready');
    });

    this.salesTransporter.verify((error) => {
      if (error) this.logger.error('Sales Transporter failed', error.stack);
      else this.logger.log('Sales Transporter ready');
    });

    this.certifiedTransporter.verify((error) => {
      if (error) this.logger.error('Certified Transporter failed', error.stack);
      else this.logger.log('Certified Transporter ready');
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
    const recipients = [to, 'certified@skygloss.com'];

    const mailOptions = {
      from: `"SkyGloss Sales" <certified@skygloss.com>`,
      to: recipients.join(', '),
      subject: 'Welcome to SkyGloss - Registration Confirmation',
      // html: `
      //   <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
      //     <h2 style="color: #0EA0DC; text-align: center;">Registration Confirmation</h2> 
      //     <p>Hello ${userDetails.firstName},</p>
      //     <p>Thank you for registering your account with SkyGloss.</p>
      //     <ul>
      //       <li><strong>Name:</strong> ${userDetails.firstName} ${userDetails.lastName}</li>
      //       <li><strong>Email:</strong> ${userDetails.email}</li>
      //       <li><strong>Location:</strong> ${userDetails.city}, ${userDetails.country}</li>
      //       <li><strong>Address:</strong> ${userDetails.address}</li>
      //       <li><strong>Phone:</strong> ${userDetails.phoneNumber}</li>
      //     </ul>
      //     <p>Thank you so much. Your payment has been successfully processed. You may now access the SkyGloss Portal.</p>
      //     <div style="text-align: center; margin: 30px 0;">
      //       <a href="${loginLink}" style="background-color: #0EA0DC; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Login to Portal</a>
      //     </div>
      //     <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      //     <p style="font-size: 12px; color: #999; text-align: center;">&copy; ${new Date().getFullYear()} SkyGloss, Inc. All Rights Reserved.</p>
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
      await this.certifiedTransporter.sendMail(mailOptions);
      this.logger.log(`Registration confirmation email sent via Certified to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send registration confirmation email to ${to}`, error.stack);
    }
  }

  async sendDistributorRegistrationAdminNotification(adminEmails: string[], userDetails: any) {
    // Note: adminEmails is ignored per user request, routing to sales@skygloss.com + user email
    const recipients = ['sales@skygloss.com'];
    if (userDetails.email) recipients.push(userDetails.email);

    const mailOptions = {
      from: `"SkyGloss System" <sales@skygloss.com>`,
      to: recipients.join(', '),
      subject: `New Distributor Registration: ${userDetails.firstName} ${userDetails.lastName}`,
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
          <p style="font-size: 12px; color: #999; text-align: center;">SkyGloss Automated Sales System</p>
        </div>
      `,
    };

    try {
      await this.salesTransporter.sendMail(mailOptions);
      this.logger.log(`Sales notification (new registration) sent to ${recipients.join(', ')}`);
    } catch (error) {
      this.logger.error(`Failed to send sales notification for new registration`, error.stack);
    }
  }

  async sendDistributorPaymentCompletedAdminNotification(adminEmails: string[], userDetails: any) {
    // Note: adminEmails is ignored per user request, routing to sales@skygloss.com + user email
    const recipients = ['sales@skygloss.com'];
    if (userDetails.email) recipients.push(userDetails.email);

    const mailOptions = {
      from: `"SkyGloss Sales" <sales@skygloss.com>`,
      to: recipients.join(', '),
      subject: `Order Payment Confirmed: ${userDetails.firstName} ${userDetails.lastName}`,
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
      await this.salesTransporter.sendMail(mailOptions);
      this.logger.log(`Sales notification (payment completed) sent to ${recipients.join(', ')}`);
    } catch (error) {
      this.logger.error(`Failed to send sales notification for payment completed`, error.stack);
    }
  }

  async sendDistributorPaymentConfirmation(to: string, userDetails: any) {
    const recipients = [to, 'sales@skygloss.com'];

    const mailOptions = {
      from: `"SkyGloss Sales" <sales@skygloss.com>`,
      to: recipients.join(', '),
      subject: 'SkyGloss - Payment & Activation Confirmed',
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
      await this.salesTransporter.sendMail(mailOptions);
      this.logger.log(`Payment confirmation email sent via Sales to ${recipients.join(', ')}`);
    } catch (error) {
      this.logger.error(`Failed to send payment confirmation email via Sales`, error.stack);
    }
  }

  async sendTrainingCompleteNotification(user: any) {
    // 1. Send Congratulations to the User
    const userMailOptions = {
      from: `"SkyGloss Certification" <certified@skygloss.com>`,
      to: user.email,
      subject: `Congratulations! Training Completed`,
      html: `
        <body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin:20px 0; border-radius:8px; overflow:hidden;">
                  <tr><td align="center" bgcolor="#0ea0dc" style="padding:20px; color:#ffffff; font-size:24px; font-weight:bold;">SkyGloss Certification</td></tr>
                  <tr>
                    <td style="padding:30px; color:#333333; font-size:14px; line-height:1.6;">
                      <h2 style="color:#0ea0dc; text-align:center;">Congratulations, ${user.firstName}!</h2>
                      <p>You have successfully completed all 8 SkyGloss training courses. Our certification department has been notified and will review your status shortly.</p>
                      <p>We will review your progress and reach out shortly to finalize your certification status.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:25px; background:#f7f7f7; border-top:1px solid #ddd; text-align:center;">
                       <span style="color:#555; font-size:14px; font-weight:bold;">Certification Department</span><br>
                       <span style="color:#555; font-size:12px;">✉️ certified@skygloss.com</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      `,
    };

    // 2. Send Certification Request to certified@skygloss.com
    const adminMailOptions = {
      from: `"SkyGloss Portal" <portal@skygloss.com>`,
      to: 'certified@skygloss.com',
      subject: `NEW CERTIFICATION REQUEST: ${user.firstName} ${user.lastName}`,
      html: `
        <body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin:20px 0; border-radius:8px; overflow:hidden;">
                  <tr><td align="center" bgcolor="#272727" style="padding:20px; color:#ffffff; font-size:24px; font-weight:bold;">New Request</td></tr>
                  <tr>
                    <td style="padding:30px; color:#333333; font-size:14px; line-height:1.6;">
                      <h2 style="color:#0ea0dc;">New Certification Request Received</h2>
                      <p>A shop user has completed all training modules and is requesting certification.</p>
                      <table width="100%" cellpadding="10" cellspacing="0" style="background:#f0f8fc; border-left:4px solid #0ea0dc; margin:20px 0;">
                        <tr>
                          <td>
                            <strong>Student Details:</strong><br>
                            Name: ${user.firstName} ${user.lastName}<br>
                            Email: ${user.email}<br>
                            Country: ${user.country}<br>
                            Date Completed: ${new Date().toLocaleDateString()}<br>
                            Partner Code: ${user.referredByPartnerCode || 'Direct'}
                          </td>
                        </tr>
                      </table>
                      <p>Please log in to the admin panel to review and approve this request.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      `,
    };

    try {
      // Send both emails
      await Promise.all([
        this.certifiedTransporter.sendMail(userMailOptions),
        this.certifiedTransporter.sendMail(adminMailOptions)
      ]);
      this.logger.log(`Training completion emails sent for ${user.email}`);
    } catch (error) {
      this.logger.error(`Failed to send training completion notification`, error.stack);
    }
  }

  async sendNewOrderNotification(order: any, user: any) {
    const subtotal = order.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * 0.08; // 8% tax as calculated in OrdersService

    const currencySymbols: { [key: string]: string } = {
      USD: '$',
      AUD: '$',
      EUR: '€',
      GBP: '£',
    };
    const currency = (order.currency || 'USD').toUpperCase();
    const symbol = currencySymbols[currency] || '$';

    const mailOptions = {
      from: `"SkyGloss Portal" <portal@skygloss.com>`,
      to: 'sales@skygloss.com',
      subject: `NEW ORDER PAID: ${order.orderNumber} - ${user.firstName} ${user.lastName}`,
      html: `
        <body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin:20px 0; border-radius:8px; overflow:hidden; border: 1px solid #e0e0e0;">
                  <tr><td align="center" bgcolor="#272727" style="padding:20px; color:#ffffff; font-size:24px; font-weight:bold;">Order Paid</td></tr>
                  <tr>
                    <td style="padding:30px; color:#333333; font-size:14px; line-height:1.6;">
                      <h2 style="color:#0ea0dc; margin-bottom: 5px;">Payment Confirmed for Order ${order.orderNumber}</h2>
                      <p style="margin-top: 0; color: #666;">Date: ${new Date().toLocaleString()}</p>
                      
                      <table width="100%" cellpadding="10" cellspacing="0" style="background:#f0f8fc; border-left:4px solid #0ea0dc; margin:20px 0;">
                        <tr>
                          <td>
                            <strong>Customer Details:</strong><br>
                            Name: ${user.firstName} ${user.lastName}<br>
                            Email: ${user.email}<br>
                            Order Number: ${order.orderNumber}<br>
                            Currency: ${currency}
                          </td>
                        </tr>
                      </table>

                      <h3 style="color: #272727; border-bottom: 1px solid #eee; padding-bottom: 10px;">Order Summary</h3>
                      ${this.renderOrderItems(order.items, symbol)}

                      <table width="100%" cellpadding="5" cellspacing="0" style="margin-top: 20px; border-top: 2px solid #0ea0dc; padding-top: 10px;">
                        <tr>
                          <td align="right" style="color: #666;">Subtotal:</td>
                          <td align="right" width="100" style="font-weight: bold;">${symbol}${subtotal.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td align="right" style="color: #666;">Tax (8%):</td>
                          <td align="right" style="font-weight: bold;">${symbol}${tax.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td align="right" style="font-size: 18px; color: #272727; font-weight: bold;">Total Paid:</td>
                          <td align="right" style="font-size: 18px; color: #0ea0dc; font-weight: bold;">${symbol}${order.totalAmount.toFixed(2)} <span style="font-size:12px; color:#666;">${currency}</span></td>
                        </tr>
                      </table>

                      <p style="margin-top: 30px; text-align: center; color: #999; font-size: 12px;">
                        Please log in to the admin panel to view full shipping details and process this order.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      `,
    };

    try {
      await this.salesTransporter.sendMail(mailOptions);
      this.logger.log(`New order notification sent to sales@skygloss.com for ${order.orderNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send new order notification`, error.stack);
    }
  }

  async sendNewOrderRequestNotification(order: any, user: any) {
    const subtotal = order.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * 0.08;

    const currencySymbols: { [key: string]: string } = {
      USD: '$',
      AUD: '$',
      EUR: '€',
      GBP: '£',
    };
    const currency = (order.currency || 'USD').toUpperCase();
    const symbol = currencySymbols[currency] || '$';

    const mailOptions = {
      from: `"SkyGloss Portal" <portal@skygloss.com>`,
      to: 'sales@skygloss.com',
      subject: `NEW ORDER REQUEST: ${order.orderNumber} - ${user.firstName} ${user.lastName}`,
      html: `
        <body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin:20px 0; border-radius:8px; overflow:hidden; border: 1px solid #e0e0e0;">
                  <tr><td align="center" bgcolor="#0ea0dc" style="padding:20px; color:#ffffff; font-size:24px; font-weight:bold;">Order Request</td></tr>
                  <tr>
                    <td style="padding:30px; color:#333333; font-size:14px; line-height:1.6;">
                      <h2 style="color:#0ea0dc; margin-bottom: 5px;">New Manual Order Request: ${order.orderNumber}</h2>
                      <p style="margin-top: 0; color: #666;">Date: ${new Date().toLocaleString()}</p>

                      <table width="100%" cellpadding="10" cellspacing="0" style="background:#f0f8fc; border-left:4px solid #0ea0dc; margin:20px 0;">
                        <tr>
                          <td>
                            <strong>Customer Details:</strong><br>
                            Name: ${user.firstName} ${user.lastName}<br>
                            Email: ${user.email}<br>
                            Country: ${order.country || user.country}<br>
                            Order Number: ${order.orderNumber}<br>
                            Currency: ${currency}
                          </td>
                        </tr>
                      </table>

                      <h3 style="color: #272727; border-bottom: 1px solid #eee; padding-bottom: 10px;">Requested Items</h3>
                      ${this.renderOrderItems(order.items, symbol)}

                      <table width="100%" cellpadding="5" cellspacing="0" style="margin-top: 20px; border-top: 2px solid #0ea0dc; padding-top: 10px;">
                        <tr>
                          <td align="right" style="color: #666;">Subtotal:</td>
                          <td align="right" width="100" style="font-weight: bold;">${symbol}${subtotal.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td align="right" style="color: #666;">Estimated Tax (8%):</td>
                          <td align="right" style="font-weight: bold;">${symbol}${tax.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td align="right" style="font-size: 18px; color: #272727; font-weight: bold;">Estimated Total:</td>
                          <td align="right" style="font-size: 18px; color: #0ea0dc; font-weight: bold;">${symbol}${order.totalAmount.toFixed(2)} <span style="font-size:12px; color:#666;">${currency}</span></td>
                        </tr>
                      </table>

                      <p style="margin-top: 30px; text-align: center; color: #999; font-size: 12px;">
                        Please log in to the admin panel to generate a formal invoice for this customer.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      `,
    };

    try {
      await this.salesTransporter.sendMail(mailOptions);
      this.logger.log(`New order request notification sent to sales@skygloss.com for ${order.orderNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send new order request notification`, error.stack);
    }
  }

  async sendOrderRequestCustomerConfirmation(order: any, user: any) {
    const subtotal = order.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * 0.08;

    const currencySymbols: { [key: string]: string } = {
      USD: '$',
      AUD: '$',
      EUR: '€',
      GBP: '£',
    };
    const currency = (order.currency || 'USD').toUpperCase();
    const symbol = currencySymbols[currency] || '$';

    const mailOptions = {
      from: `"SkyGloss Portal" <sales@skygloss.com>`,
      to: user.email,
      subject: `Order Request Received: ${order.orderNumber}`,
      html: `
        <body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin:20px 0; border-radius:8px; overflow:hidden; border: 1px solid #e0e0e0;">
                  <tr><td align="center" bgcolor="#0ea0dc" style="padding:20px; color:#ffffff; font-size:24px; font-weight:bold;">Order Request Received</td></tr>
                  <tr>
                    <td style="padding:30px; color:#333333; font-size:14px; line-height:1.6;">
                      <h2 style="color:#272727; margin-bottom: 5px;">Hi ${user.firstName},</h2>
                      <p style="margin-top: 0; color: #666;">Thank you for submitting your order request (<strong>${order.orderNumber}</strong>).</p>
                      
                      <p>Our sales team has received your request and will review it shortly. Once approved, you will receive an invoice to complete your purchase.</p>

                      <h3 style="color: #272727; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-top: 30px;">Requested Items Summary</h3>
                      ${this.renderOrderItems(order.items, symbol)}

                      <table width="100%" cellpadding="5" cellspacing="0" style="margin-top: 20px; border-top: 2px solid #0ea0dc; padding-top: 10px;">
                        <tr>
                          <td align="right" style="color: #666;">Subtotal:</td>
                          <td align="right" width="100" style="font-weight: bold;">${symbol}${subtotal.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td align="right" style="color: #666;">Estimated Tax (8%):</td>
                          <td align="right" style="font-weight: bold;">${symbol}${tax.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td align="right" style="font-size: 18px; color: #272727; font-weight: bold;">Estimated Total:</td>
                          <td align="right" style="font-size: 18px; color: #0ea0dc; font-weight: bold;">${symbol}${order.totalAmount.toFixed(2)} <span style="font-size:12px; color:#666;">${currency}</span></td>
                        </tr>
                      </table>

                      <p style="margin-top: 30px; text-align: center; color: #999; font-size: 12px;">
                        If you have any questions, please contact our support team.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Order request confirmation sent to customer ${user.email} for ${order.orderNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send order request confirmation to customer`, error.stack);
    }
  }

  async sendOrderPaidCustomerConfirmation(order: any, user: any) {
    const subtotal = order.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * 0.08;

    const currencySymbols: { [key: string]: string } = {
      USD: '$',
      AUD: '$',
      EUR: '€',
      GBP: '£',
    };
    const currency = (order.currency || 'USD').toUpperCase();
    const symbol = currencySymbols[currency] || '$';

    const mailOptions = {
      from: `"SkyGloss Portal" <sales@skygloss.com>`,
      to: user.email,
      subject: `Order Confirmation: ${order.orderNumber}`,
      html: `
        <body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin:20px 0; border-radius:8px; overflow:hidden; border: 1px solid #e0e0e0;">
                  <tr><td align="center" bgcolor="#0ea0dc" style="padding:20px; color:#ffffff; font-size:24px; font-weight:bold;">Payment Confirmed</td></tr>
                  <tr>
                    <td style="padding:30px; color:#333333; font-size:14px; line-height:1.6;">
                      <h2 style="color:#272727; margin-bottom: 5px;">Hi ${user.firstName},</h2>
                      <p style="margin-top: 0; color: #666;">Thank you for your purchase! Your order (<strong>${order.orderNumber}</strong>) has been successfully paid and is now being processed.</p>
                      
                      <p>We will notify you once your items have been shipped.</p>

                      <h3 style="color: #272727; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-top: 30px;">Order Summary</h3>
                      ${this.renderOrderItems(order.items, symbol)}

                      <table width="100%" cellpadding="5" cellspacing="0" style="margin-top: 20px; border-top: 2px solid #0ea0dc; padding-top: 10px;">
                        <tr>
                          <td align="right" style="color: #666;">Subtotal:</td>
                          <td align="right" width="100" style="font-weight: bold;">${symbol}${subtotal.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td align="right" style="color: #666;">Estimated Tax (8%):</td>
                          <td align="right" style="font-weight: bold;">${symbol}${tax.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td align="right" style="font-size: 18px; color: #272727; font-weight: bold;">Total Paid:</td>
                          <td align="right" style="font-size: 18px; color: #0ea0dc; font-weight: bold;">${symbol}${order.totalAmount.toFixed(2)} <span style="font-size:12px; color:#666;">${currency}</span></td>
                        </tr>
                      </table>

                      <p style="margin-top: 30px; text-align: center; color: #999; font-size: 12px;">
                        If you have any questions, please contact our support team.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Order paid confirmation sent to customer ${user.email} for ${order.orderNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send order paid confirmation to customer`, error.stack);
    }
  }

  private renderOrderItems(items: any[], symbol: string = '$') {
    let itemsHtml = `
      <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse: collapse; margin-top: 10px;">
        <thead>
          <tr style="background-color: #f8f9fa; border-bottom: 1px solid #dee2e6;">
            <th align="left" style="padding: 10px; font-size: 11px; color: #666; text-transform: uppercase;">Product</th>
            <th align="center" style="padding: 10px; font-size: 11px; color: #666; text-transform: uppercase;">Qty</th>
            <th align="right" style="padding: 10px; font-size: 11px; color: #666; text-transform: uppercase;">Price</th>
            <th align="right" style="padding: 10px; font-size: 11px; color: #666; text-transform: uppercase;">Total</th>
          </tr>
        </thead>
        <tbody>
    `;

    items.forEach((item) => {
      itemsHtml += `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px; vertical-align: middle;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${item.image ? `<td style="padding-right: 10px;"><img src="${item.image}" width="45" height="45" style="border-radius: 6px; object-fit: cover; border: 1px solid #eee;"></td>` : ''}
                <td>
                  <div style="font-weight: bold; font-size: 13px; color: #272727;">${item.name}</div>
                  ${item.size ? `<div style="font-size: 11px; color: #888;">Size: ${item.size}</div>` : ''}
                </td>
              </tr>
            </table>
          </td>
          <td align="center" style="padding: 10px; font-size: 13px; color: #272727;">${item.quantity}</td>
          <td align="right" style="padding: 10px; font-size: 13px; color: #272727;">${symbol}${item.price.toFixed(2)}</td>
          <td align="right" style="padding: 10px; font-size: 13px; font-weight: bold; color: #272727;">${symbol}${(item.price * item.quantity).toFixed(2)}</td>
        </tr>
      `;
    });

    itemsHtml += `
        </tbody>
      </table>
    `;

    return itemsHtml;
  }
}

