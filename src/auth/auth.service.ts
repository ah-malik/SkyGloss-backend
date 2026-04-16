import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { AccessCodesService } from '../access-codes/access-codes.service';
import { UserRole, UserStatus } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { LoginAccessCodeDto } from './dto/login-access-code.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { User, UserDocument } from '../users/entities/user.entity';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import * as crypto from 'crypto';
import { MailService } from '../mail/mail.service';
import { OrdersService } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationType } from '../notifications/entities/notification.entity';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private accessCodesService: AccessCodesService,
    private mailService: MailService,
    private ordersService: OrdersService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
  ) { }

  async validateUser(identifier: string, pass: string): Promise<any> {
    console.log(`[Auth] Validating user: ${identifier}`);
    const user = await this.usersService.findByUsernameOrEmail(identifier);
    console.log(`[Auth] User found: ${!!user}`);
    if (user && user.password && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user.toObject();
      return result;
    }
    return null;
  }

  async login(user: any) {
    const userId = user._id.toString();

    // Enforce payment for self-registered regional distributors
    if (
      user.role === UserRole.REGIONAL_PARTNER &&
      user.isSelfRegistered &&
      !user.isPartnerPaid
    ) {
      const stripeSession = await this.ordersService.createDistributorFeeCheckoutSession(
        userId,
        user.email || '',
      );
      return {
        paymentRequired: true,
        message: 'Payment of $250 registration fee is required to access the dashboard.',
        stripeUrl: stripeSession.url,
      };
    }

    const payload = { email: user.email, sub: userId, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: userId,
        email: user.email,
        role: user.role,
        country: user.country,
        firstName: user.firstName,
        lastName: user.lastName,
        productGroup: user.productGroup,
        isPartnerPaid: user.isPartnerPaid,
        partnerCode: user.partnerCode,
      },
    };
  }

  async loginWithAccessCode(loginAccessCodeDto: LoginAccessCodeDto) {
    try {
      // Try validating without allowing used first to see if it's a fresh login
      let code;
      try {
        code = await this.accessCodesService.validateCode(
          loginAccessCodeDto.accessCode,
          false,
        );
      } catch (error: any) {
        // If it's already used, we allow it if we can find a user associated with it
        if (
          error instanceof BadRequestException &&
          error.message === 'Access code has already been used.'
        ) {
          code = await this.accessCodesService.validateCode(
            loginAccessCodeDto.accessCode,
            true,
          );
          const user = await this.usersService.findByAccessCode(
            loginAccessCodeDto.accessCode,
          );
          if (!user) {
            throw new BadRequestException(
              'Access code has already been used by another account.',
            );
          }

          // Return login for existing user
          const payload = { sub: user._id.toString(), role: user.role };
          return {
            access_token: this.jwtService.sign(payload),
            user: {
              id: user._id.toString(),
              role: user.role,
              country: user.country,
              firstName: user.firstName,
              lastName: user.lastName,
              productGroup: user.productGroup,
              partnerCode: user.partnerCode,
            },
          };
        }
        throw error;
      }

      // If we reach here, it's a fresh (unused) code
      const user = await this.usersService.create({
        email: code.generatedForEmail,
        role: code.targetRole,
        status: 'active',
        country: loginAccessCodeDto.country || 'Other',
        accessCode: loginAccessCodeDto.accessCode,
      } as CreateUserDto);

      // Mark code as used
      await this.accessCodesService.markAsUsed(code.code);

      const payload = { sub: user._id.toString(), role: user.role };
      return {
        access_token: this.jwtService.sign(payload),
        user: {
          id: user._id.toString(),
          role: user.role,
          country: user.country,
          productGroup: user.productGroup,
          partnerCode: user.partnerCode,
        },
      };
    } catch (err: any) {
      console.error('Critical login error:', err);
      const allCodes = await (
        this.accessCodesService as any
      ).accessCodeModel.find();
      console.log(
        'Available codes in DB:',
        allCodes.map((c: any) => c.code),
      );

      throw new BadRequestException(
        `Login error: ${err.message || 'Unknown'}. Status: ${err.status || 'N/A'}`,
      );
    }
  }

  async register(createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  async registerPartner(createUserDto: CreateUserDto) {
    // Generate a unique 6-digit partner code for self-registration
    let partnerCode = '';
    let isUnique = false;
    while (!isUnique) {
      partnerCode = Math.floor(100000 + Math.random() * 900000).toString();
      const existing = await (this.usersService as any).userModel.findOne({ partnerCode });
      if (!existing) isUnique = true;
    }

    // Override role and status for a new partner registration
    const partnerDto = {
      ...createUserDto,
      role: UserRole.REGIONAL_PARTNER, // Assuming Regional Partner by default for this flow
      status: UserStatus.PENDING,
      isSelfRegistered: true,
      partnerCode,
    };

    const user = await this.usersService.create(partnerDto as CreateUserDto);

    // Send Emails asynchronously
    if (user.email) {
      this.mailService.sendDistributorRegistrationUserConfirmation(user.email, user).catch(err => console.error(err));
      // Admin notification is now handled internally by MailService for sales@skygloss.com
      this.mailService.sendDistributorRegistrationAdminNotification([], user).catch(err => console.error(err));
    }

    try {
      const notification = await this.notificationsService.create({
        type: NotificationType.NEW_USER,
        title: 'New Partner Registration',
        message: `A new partner (${user.firstName} ${user.lastName}) has registered and is pending payment.`,
        metadata: {
          userId: user._id.toString(),
          email: user.email,
          role: user.role,
        },
      });
      this.notificationsGateway.broadcastNotification(notification);
    } catch (err) {
      console.error('Failed to create admin notification for new partner', err);
    }

    // Create Stripe Checkout Session
    const stripeSession = await this.ordersService.createDistributorFeeCheckoutSession(
      user._id.toString(),
      user.email || '',
      { country: user.country }
    );

    return {
      message: 'Registration successful. Redirecting to payment...',
      stripeUrl: stripeSession.url,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        status: user.status,
        partnerCode: user.partnerCode,
      }
    };
  }

  async registerShop(createUserDto: CreateUserDto) {
    let partnerId = createUserDto.referredByPartnerCode;

    // Direct registration logic: if hearAboutUs or couponCode is present, assign Global Partner
    if ((createUserDto.hearAboutUs || createUserDto.couponCode === 'CERTIFICATIONONUS') && !partnerId) {
      partnerId = 'GLOBAL77';
      createUserDto.referredByPartnerCode = partnerId;
    }

    if (!partnerId) {
      throw new BadRequestException('Partner ID is required unless a hearing source is provided');
    }

    // Validate Partner ID length and format (4-10 alphanumeric)
    if (!/^[a-zA-Z0-9]{4,10}$/.test(partnerId)) {
      throw new BadRequestException('Partner ID must be 4-10 alphanumeric characters');
    }

    // Validate Partner ID exists and belongs to a partner
    let partner = await (this.usersService as any).userModel.findOne({
      partnerCode: partnerId,
      role: { $in: [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER] }
    });

    // Self-healing: If Global Partner is requested but missing, create it
    if (!partner && partnerId === 'GLOBAL77') {
      try {
        console.log('[AuthService] Global Partner missing during registration. Creating...');
        const hashedPass = await bcrypt.hash('SkyGlossGlobal77!', 10);
        partner = await (this.usersService as any).userModel.create({
          firstName: 'Global',
          lastName: 'Partner',
          email: 'certified@skygloss.com',
          password: hashedPass,
          role: UserRole.MASTER_PARTNER,
          status: 'active',
          country: 'United States',
          address: 'Main Office',
          city: 'Global',
          partnerCode: 'GLOBAL77',
          isSelfRegistered: false,
        });
        console.log('[AuthService] Global Partner created at certified@skygloss.com');
      } catch (err: any) {
        console.error('[AuthService] Failed to create Global Partner:', err);
        // If it failed because it exists now (race condition), try finding it one last time
        partner = await (this.usersService as any).userModel.findOne({ partnerCode: 'GLOBAL77' });
        if (!partner) throw err;
      }
    }

    if (!partner) {
      throw new BadRequestException('Invalid Partner ID. Please check and try again.');
    }


    // Handle Coupon Code Bypass
    const isCouponBypass = createUserDto.couponCode === 'CERTIFICATIONONUS';
    if (isCouponBypass) {
      partnerId = 'GLOBAL77';
    }

    // Force role and status for a new shop registration
    const shopDto = {
      ...createUserDto,
      referredByPartnerCode: partnerId,
      role: UserRole.CERTIFIED_SHOP,
      status: isCouponBypass ? UserStatus.ACTIVE : UserStatus.PENDING,
      isPartnerPaid: isCouponBypass ? true : false,
      isSelfRegistered: true,
      productGroup: partner.productGroup || undefined, // Inherit from partner
    };

    try {
      console.log('[AuthService] Creating Shop user...');
      const user = await this.usersService.create(shopDto as CreateUserDto);
      console.log('[AuthService] Shop user created:', user._id);

      // Send Emails
      if (user.email) {
        this.mailService.sendDistributorRegistrationUserConfirmation(user.email, user).catch(err => console.error(err));
      }

      try {
        const notification = await this.notificationsService.create({
          type: NotificationType.NEW_USER,
          title: 'New Shop Registration',
          message: `A new shop (${user.firstName} ${user.lastName}) has registered under Partner ${partner.firstName} ${partner.lastName}.`,
          metadata: {
            userId: user._id.toString(),
            email: user.email,
            role: user.role,
            referredBy: partner.partnerCode,
          },
        });
        this.notificationsGateway.broadcastNotification(notification);
      } catch (err) {
        console.error('Failed to create admin notification for new shop', err);
      }

      // Create Stripe Checkout Session (unless bypassed by coupon)
      if (!isCouponBypass) {
        const stripeSession = await this.ordersService.createDistributorFeeCheckoutSession(
          user._id.toString(),
          user.email || '',
          {
            type: 'shop_registration',
            referredByPartnerCode: user.referredByPartnerCode,
            country: user.country
          }
        );

        // Store session ID for manual verification fallback
        await this.usersService.update(user._id.toString(), { stripeSessionId: (stripeSession as any).id });

        return {
          message: 'Registration successful. Redirecting to payment...',
          stripeUrl: stripeSession.url,
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
            status: user.status,
          }
        };
      }

      return {
        message: 'Registration successful via Certification Bonus! You can now log in.',
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          status: user.status,
          isPaid: true
        }
      };
    } catch (err: any) {
      console.error('[AuthService] CRITICAL: registerShop failed:', err);
      throw new BadRequestException(`Registration error: ${err.message || 'Unknown server error'}`);
    }

  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.usersService.findByEmail(forgotPasswordDto.email);
    if (!user) {
      throw new BadRequestException('User with this email does not exist');
    }

    const token = crypto.randomBytes(20).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 1); // 1 hour expiry

    await this.usersService.update(user._id.toString(), {
      resetPasswordToken: token,
      resetPasswordExpires: expires,
    } as any);

    // Send actual email
    if (user.email) {
      try {
        await this.mailService.sendPasswordResetEmail(user.email, token);
      } catch (error) {
        throw new BadRequestException(
          'Failed to send reset email. The mail server might be down or credentials incorrect.',
        );
      }
    }

    return {
      message: 'Password reset link has been sent to your email',
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const user = await (this.usersService as any).userModel.findOne({
      resetPasswordToken: resetPasswordDto.token,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      throw new BadRequestException(
        'Password reset token is invalid or has expired',
      );
    }

    const hashedPassword = await bcrypt.hash(resetPasswordDto.newPassword, 10);
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return { message: 'Password has been reset successfully' };
  }

  async verifyRegistrationPayment(userId: string) {
    return this.ordersService.verifyRegistrationPayment(userId);
  }
}
