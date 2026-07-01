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
import { ProductGroupsService } from '../product-groups/product-groups.service';
import { CouponsService } from '../coupons/coupons.service';
import { RegistrationFeesService } from '../registration-fees/registration-fees.service';
import { ShopRegistrationCouponResult } from '../coupons/coupons.service';
import {
  formatRoleLabel,
  NETWORK_REFERENCE_ID_LABEL,
  isPartnerNetworkRole,
} from '../common/role-labels';
import {
  GLOBAL_HUB_PARTNER_CODE,
  isGlobalHubPartnerCode,
} from '../common/global-hub';

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
    private productGroupsService: ProductGroupsService,
    private couponsService: CouponsService,
    private registrationFeesService: RegistrationFeesService,
  ) { }

  async validateUser(identifier: string, pass: string): Promise<any> {
    console.log(`[Auth] Validating user: ${identifier}`);
    const user = await this.usersService.findByUsernameOrEmail(identifier);
    console.log(`[Auth] User found: ${!!user}`);
    if (user && user.password && (await bcrypt.compare(pass, user.password))) {
      if (user.status === UserStatus.BLOCKED) {
        throw new UnauthorizedException('Your account has been blocked. Please contact your partner or support.');
      }
      const { password, ...result } = user.toObject();
      return result;
    }
    return null;
  }

  async login(user: any) {
    const userId = user._id.toString();

    // Enforce payment for self-registered regional distributors
    if (
      isPartnerNetworkRole(user.role) &&
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

    // Enforce payment for self-registered certified shops has been moved to the frontend
    // Users can login, but will be blocked from accessing specific courses until paid

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
        hasSeenWelcomePopup: user.hasSeenWelcomePopup,
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

          if (user.status === UserStatus.BLOCKED) {
            throw new UnauthorizedException('Your account has been blocked. Please contact your partner or support.');
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
              hasSeenWelcomePopup: user.hasSeenWelcomePopup,
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
          hasSeenWelcomePopup: user.hasSeenWelcomePopup,
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
      role: UserRole.MASTER_PARTNER,
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
        title: `New ${formatRoleLabel(user.role)} Registration`,
        message: `A new ${formatRoleLabel(user.role).toLowerCase()} (${user.firstName} ${user.lastName}) has registered and is pending payment.`,
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
        hasSeenWelcomePopup: user.hasSeenWelcomePopup,
      }
    };
  }

  async validateShopRegistrationCoupon(
    code: string,
    country?: string,
  ): Promise<ShopRegistrationCouponResult> {
    let subtotal = 250;
    try {
      const feeGroup = await this.registrationFeesService.findByCountry(country || '');
      if (feeGroup) {
        subtotal = feeGroup.feeAmount + (feeGroup.taxAmount || 0);
      }
    } catch (err) {
      console.error('[AuthService] Failed to resolve registration fee for coupon:', err);
    }

    return this.couponsService.validateForShopRegistration(code, subtotal);
  }

  async registerShop(createUserDto: CreateUserDto) {
    let partnerId = createUserDto.referredByPartnerCode?.trim().toUpperCase() || '';
    let hearAboutSource = createUserDto.hearAboutUs?.trim() || '';

    if (hearAboutSource === 'Other') {
      const otherText = createUserDto.hearAboutUsOther?.trim();
      if (!otherText) {
        throw new BadRequestException('Please specify how you heard about us.');
      }
      hearAboutSource = otherText;
      createUserDto.hearAboutUs = otherText;
    } else if (hearAboutSource) {
      createUserDto.hearAboutUs = hearAboutSource;
    }

    if (!partnerId) {
      if (!hearAboutSource) {
        throw new BadRequestException(
          `Please enter a valid ${NETWORK_REFERENCE_ID_LABEL} or select where you heard about us.`,
        );
      }
      partnerId = GLOBAL_HUB_PARTNER_CODE;
    } else if (!/^[A-Z0-9]{4,10}$/.test(partnerId)) {
      throw new BadRequestException(
        `${NETWORK_REFERENCE_ID_LABEL} must be 4-10 alphanumeric characters`,
      );
    }

    const partner = await (this.usersService as any).userModel.findOne({
      partnerCode: partnerId,
      role: {
        $in: [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.SUB_PROMOTER, UserRole.DISTRIBUTOR, UserRole.PARTNER],
      },
      status: 'active',
    });

    if (!partner) {
      throw new BadRequestException(
        `Invalid ${NETWORK_REFERENCE_ID_LABEL}. Please check and try again.`,
      );
    }

    createUserDto.referredByPartnerCode = partnerId;

    let registrationCoupon: ShopRegistrationCouponResult | null = null;
    if (createUserDto.couponCode?.trim()) {
      registrationCoupon = await this.validateShopRegistrationCoupon(
        createUserDto.couponCode,
        createUserDto.country,
      );
    }

    const isFullyCovered = registrationCoupon?.isFullyCovered === true;
    const appliedCouponCode = registrationCoupon?.code;

    // Determine product group: country match > partner's group > default group
    let resolvedProductGroup: any = partner.productGroup || undefined;
    try {
      const allGroups = await this.productGroupsService.findAll();
      const countryMatch = allGroups.find(
        (g: any) => (g.countries && g.countries.includes(createUserDto.country)) || g.country === createUserDto.country
      );
      if (countryMatch) {
        resolvedProductGroup = countryMatch._id;
      } else if (!resolvedProductGroup) {
        const defaultGroup = allGroups.find((g: any) => g.isDefault);
        if (defaultGroup) resolvedProductGroup = defaultGroup._id;
      }
    } catch (err) {
      console.error('[AuthService] Failed to resolve product group by country:', err);
    }

    // Force role and status for a new shop registration
    const shopDto = {
      ...createUserDto,
      referredByPartnerCode: partnerId,
      couponCode: appliedCouponCode,
      role: UserRole.CERTIFIED_SHOP,
      status: isFullyCovered ? UserStatus.ACTIVE : UserStatus.PENDING,
      isPartnerPaid: isFullyCovered ? true : false,
      isSelfRegistered: true,
      productGroup: resolvedProductGroup,
    };

    try {
      console.log('[AuthService] Creating Shop user...');
      const user = await this.usersService.create(shopDto as CreateUserDto);
      console.log('[AuthService] Shop user created:', user._id);

      // Send Emails
      if (user.email) {
        let invoiceBuffer: Buffer | undefined;
        let orderNumber: string | undefined;
        if (isFullyCovered && appliedCouponCode) {
          try {
            const regOrder = await this.ordersService.createRegistrationOrder(
              user,
              undefined,
              {
                couponCode: appliedCouponCode,
                discount: registrationCoupon!.discountAmount,
              },
            );
            invoiceBuffer = await this.ordersService.generateInvoicePdf(regOrder);
            orderNumber = regOrder.orderNumber;
            await this.couponsService.recordUsage(appliedCouponCode);
          } catch (orderErr) {
            console.error('[AuthService] Failed to create registration order for coupon bypass:', orderErr);
          }
        }
        const shopPartnerContact = isGlobalHubPartnerCode(partner.partnerCode)
          ? null
          : {
              partnerCode: partner.partnerCode,
              email: partner.email,
              firstName: partner.firstName,
              lastName: partner.lastName,
            };
        this.mailService.sendDistributorRegistrationUserConfirmation(
          user.email,
          user,
          invoiceBuffer,
          orderNumber,
          shopPartnerContact,
        ).catch(err => console.error(err));
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
      if (!isFullyCovered) {
        const checkoutMetadata: Record<string, unknown> = {
          type: 'shop_registration',
          referredByPartnerCode: user.referredByPartnerCode,
          country: user.country,
        };

        if (registrationCoupon) {
          checkoutMetadata.couponCode = registrationCoupon.code;
          checkoutMetadata.registrationDiscount = registrationCoupon.discountAmount;
          checkoutMetadata.finalAmount = registrationCoupon.totalAfterDiscount;
        }

        const stripeSession = await this.ordersService.createDistributorFeeCheckoutSession(
          user._id.toString(),
          user.email || '',
          checkoutMetadata,
        );

        // Store session ID for manual verification fallback
        await this.usersService.update(user._id.toString(), { stripeSessionId: (stripeSession as any).id }, { role: UserRole.ADMIN } as any);

        return {
          message: 'Registration successful. Redirecting to payment...',
          stripeUrl: stripeSession.url,
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
            status: user.status,
            hasSeenWelcomePopup: user.hasSeenWelcomePopup,
          }
        };
      }

      return {
        message: registrationCoupon
          ? 'Registration successful with coupon applied! You can now log in.'
          : 'Registration successful via coupon! You can now log in.',
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          status: user.status,
          isPaid: true,
          hasSeenWelcomePopup: user.hasSeenWelcomePopup,
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
    } as any, { role: UserRole.ADMIN } as any);

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

  async impersonate(targetUserId: string) {
    const user = await (this.usersService as any).userModel.findById(targetUserId);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    const userId = user._id.toString();
    const payload = { email: user.email, sub: userId, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        _id: userId,
        id: userId,
        email: user.email,
        role: user.role,
        country: user.country,
        firstName: user.firstName,
        lastName: user.lastName,
        productGroup: user.productGroup,
        isPartnerPaid: user.isPartnerPaid,
        partnerCode: user.partnerCode,
        hasSeenWelcomePopup: user.hasSeenWelcomePopup,
      },
    };
  }
}
