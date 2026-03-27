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
      subject: 'Distributor Registration Payment Completed',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #4caf50; text-align: center;">Payment Successful</h2>
          <p>The following distributor has successfully completed their registration payment and their account is now ACTIVE.</p>
          <h3>User Details:</h3>
          <ul>
            <li><strong>Name:</strong> ${userDetails.firstName} ${userDetails.lastName}</li>
            <li><strong>Email:</strong> ${userDetails.email}</li>
            <li><strong>Company:</strong> ${userDetails.companyName || 'N/A'}</li>
          </ul>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">SkyGloss Automated System</p>
        </div>
      `,
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
}

