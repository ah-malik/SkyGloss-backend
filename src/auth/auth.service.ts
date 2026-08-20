import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { AccessCodesService } from '../access-codes/access-codes.service';
import { UserRole, UserStatus } from '../users/entities/user.entity';
import { AuthPortal } from './dto/login.dto';
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
  PARTNER_NETWORK_ROLES,
} from '../common/role-labels';
import {
  GLOBAL_HUB_PARTNER_CODE,
  isGlobalHubPartnerCode,
} from '../common/global-hub';
import {
  PARTNER_CODE_MAX_LENGTH,
  PARTNER_CODE_MIN_LENGTH,
  PARTNER_CODE_REGEX,
} from '../common/partner-code';
import {
  hubCountryMismatchError,
  hubOwnsCountry,
  normalizeCountryName,
} from '../common/hub-countries';
import { UserActivityService } from '../user-activity/user-activity.service';
import { UserActivityAction } from '../user-activity/entities/user-activity-log.entity';
import { parseDurationToMs } from './auth-cookies';

export interface IssuedAuthTokens {
  access_token: string;
  refresh_token: string;
  csrf_token: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
  user: Record<string, any>;
}

export interface AuthActivityContext {
  portal?: string;
  country?: string;
  ipAddress?: string;
  userAgent?: string;
  browser?: string;
  os?: string;
  device?: string;
  actorId?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private accessCodesService: AccessCodesService,
    private mailService: MailService,
    private ordersService: OrdersService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
    private productGroupsService: ProductGroupsService,
    private couponsService: CouponsService,
    private registrationFeesService: RegistrationFeesService,
    private userActivityService: UserActivityService,
  ) { }

  private accessExpiresIn(): string {
    return (
      this.configService.get<string>('JWT_ACCESS_EXPIRATION') ||
      this.configService.get<string>('JWT_EXPIRATION') ||
      '15m'
    );
  }

  private refreshExpiresIn(): string {
    return this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d';
  }

  private toPublicUser(user: any, userId: string) {
    return {
      id: userId,
      _id: userId,
      email: user.email,
      role: user.role,
      country: user.country,
      firstName: user.firstName,
      lastName: user.lastName,
      productGroup: user.productGroup,
      isPartnerPaid: user.isPartnerPaid,
      partnerCode: user.partnerCode,
      hasSeenWelcomePopup: user.hasSeenWelcomePopup,
      preferredLanguage: user.preferredLanguage,
      status: user.status,
    };
  }

  /**
   * Issues access + refresh + CSRF tokens and persists refresh hash (revokes prior refresh).
   * Pass rotateRefresh=false for admin impersonation handoff so the real user's
   * refresh session is not revoked.
   */
  async issueAuthTokens(
    user: any,
    options?: { rotateRefresh?: boolean },
  ): Promise<IssuedAuthTokens> {
    const rotateRefresh = options?.rotateRefresh !== false;
    const userId = (user._id || user.id || user.sub).toString();
    const accessExpiresIn = this.accessExpiresIn();
    const refreshExpiresIn = this.refreshExpiresIn();

    const access_token = this.jwtService.sign(
      { email: user.email, sub: userId, role: user.role },
      { expiresIn: accessExpiresIn as any },
    );

    let refresh_token = '';
    let refreshMaxAgeMs = 0;
    if (rotateRefresh) {
      // jti is hashed (bcrypt 72-byte limit) — full refresh JWT is only in HttpOnly cookie.
      const refreshJti = crypto.randomBytes(32).toString('hex');
      refresh_token = this.jwtService.sign(
        { sub: userId, typ: 'refresh', jti: refreshJti },
        { expiresIn: refreshExpiresIn as any },
      );
      const refreshTokenHash = await bcrypt.hash(refreshJti, 10);
      await this.usersService.setRefreshTokenHash(userId, refreshTokenHash);
      refreshMaxAgeMs = parseDurationToMs(refreshExpiresIn, 7 * 86_400_000);
    }

    const csrf_token = crypto.randomBytes(32).toString('hex');

    return {
      access_token,
      refresh_token,
      csrf_token,
      accessMaxAgeMs: parseDurationToMs(accessExpiresIn, 15 * 60_000),
      refreshMaxAgeMs,
      user: this.toPublicUser(user, userId),
    };
  }

  async refreshAuthTokens(refreshToken: string): Promise<IssuedAuthTokens> {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing');
    }

    let userId: string | null = null;
    let jti: string | null = null;
    try {
      const decoded = this.jwtService.verify(refreshToken) as {
        sub?: string;
        typ?: string;
        jti?: string;
      };
      if (decoded?.typ === 'refresh' && decoded.sub && decoded.jti) {
        userId = decoded.sub;
        jti = decoded.jti;
      }
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!userId || !jti) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const record = await this.usersService.getRefreshTokenRecord(userId);
    if (!record?.refreshTokenHash) {
      throw new UnauthorizedException('Session revoked');
    }
    if (record.status === UserStatus.BLOCKED) {
      throw new UnauthorizedException('Account is blocked');
    }

    const matches = await bcrypt.compare(jti, record.refreshTokenHash);
    if (!matches) {
      // Possible theft/reuse — revoke all sessions for this user
      await this.usersService.setRefreshTokenHash(userId, null);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findOneForAuth(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.issueAuthTokens(user);
  }

  async revokeRefreshToken(userId: string): Promise<void> {
    if (!userId) return;
    await this.usersService.setRefreshTokenHash(userId, null);
  }

  /** Decode refresh JWT without rotating — used for logout revoke. */
  peekRefreshUserId(refreshToken: string): string | null {
    try {
      const decoded = this.jwtService.verify(refreshToken) as {
        sub?: string;
        typ?: string;
      };
      if (decoded?.typ === 'refresh' && decoded.sub) {
        return decoded.sub;
      }
    } catch {
      return null;
    }
    return null;
  }

  private rolesForPortal(portal: AuthPortal): UserRole[] {
    if (portal === 'shop') {
      return [UserRole.CERTIFIED_SHOP];
    }
    // Admin signs in via the partner portal (no dedicated admin login page).
    return [...PARTNER_NETWORK_ROLES, UserRole.ADMIN] as UserRole[];
  }

  private otherPortalRoles(portal: AuthPortal): UserRole[] {
    return portal === 'shop'
      ? ([...PARTNER_NETWORK_ROLES, UserRole.ADMIN] as UserRole[])
      : [UserRole.CERTIFIED_SHOP];
  }

  async validateUser(
    identifier: string,
    pass: string,
    portal: AuthPortal,
  ): Promise<any> {
    console.log(`[Auth] Validating user: ${identifier} (portal=${portal})`);
    const portalRoles = this.rolesForPortal(portal);
    const user = await this.usersService.findByUsernameOrEmailForRoles(
      identifier,
      portalRoles,
    );
    console.log(`[Auth] User found for portal: ${!!user}`);

    if (!user) {
      const otherUser = await this.usersService.findByUsernameOrEmailForRoles(
        identifier,
        this.otherPortalRoles(portal),
      );
      if (otherUser) {
        // Use BadRequest (not 401) so the frontend login toast is shown instead of
        // the global 401 interceptor redirecting to the landing page.
        throw new BadRequestException(
          portal === 'shop'
            ? 'This account belongs to the Partner portal. Please sign in at Partner Login.'
            : 'This account belongs to the Shop portal. Please sign in at Shop Login.',
        );
      }
      return null;
    }

    if (user.password && (await bcrypt.compare(pass, user.password))) {
      if (user.status === UserStatus.BLOCKED) {
        throw new UnauthorizedException(
          'Your account has been blocked. Please contact your partner or support.',
        );
      }
      const { password, ...result } = user.toObject();
      return result;
    }
    return null;
  }

  async login(user: any, activity?: AuthActivityContext) {
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
        stripeUrl: (stripeSession as { url?: string }).url,
      };
    }

    // Enforce payment for self-registered certified shops has been moved to the frontend
    // Users can login, but will be blocked from accessing specific courses until paid

    await this.userActivityService.log({
      userId,
      action: UserActivityAction.LOGIN,
      portal: activity?.portal,
      country: user.country || activity?.country,
      ipAddress: activity?.ipAddress,
      userAgent: activity?.userAgent,
      browser: activity?.browser,
      os: activity?.os,
      device: activity?.device,
      metadata: {
        method: 'password',
        role: user.role,
        email: user.email,
        country: user.country,
        partnerCode: user.partnerCode,
        status: user.status,
      },
    });

    return this.issueAuthTokens(user);
  }

  async loginWithAccessCode(
    loginAccessCodeDto: LoginAccessCodeDto,
    activity?: AuthActivityContext,
  ) {
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
          await this.userActivityService.log({
            userId: user._id.toString(),
            action: UserActivityAction.LOGIN_ACCESS_CODE,
            portal: activity?.portal || 'shop',
            country: user.country || activity?.country,
            ipAddress: activity?.ipAddress,
            userAgent: activity?.userAgent,
            browser: activity?.browser,
            os: activity?.os,
            device: activity?.device,
            metadata: {
              method: 'access_code',
              role: user.role,
              email: user.email,
              country: user.country,
              partnerCode: user.partnerCode,
              status: user.status,
              freshCode: false,
            },
          });
          return this.issueAuthTokens(user);
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

      const accessCodeActivity = {
        portal: activity?.portal || 'shop',
        country: user.country || activity?.country || loginAccessCodeDto.country,
        ipAddress: activity?.ipAddress,
        userAgent: activity?.userAgent,
        browser: activity?.browser,
        os: activity?.os,
        device: activity?.device,
        metadata: {
          method: 'access_code',
          role: user.role,
          email: user.email,
          country: user.country || loginAccessCodeDto.country,
          partnerCode: user.partnerCode,
          status: user.status,
          freshCode: true,
        },
      };
      await this.userActivityService.log({
        userId: user._id.toString(),
        action: UserActivityAction.REGISTER,
        ...accessCodeActivity,
        metadata: {
          ...accessCodeActivity.metadata,
          method: 'access_code_register',
          registrationType: 'access_code',
        },
      });
      await this.userActivityService.log({
        userId: user._id.toString(),
        action: UserActivityAction.LOGIN_ACCESS_CODE,
        ...accessCodeActivity,
      });
      return this.issueAuthTokens(user);
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

  async register(
    createUserDto: CreateUserDto,
    activity?: AuthActivityContext,
  ) {
    const user = await this.usersService.create(createUserDto);
    await this.userActivityService.log({
      userId: user._id.toString(),
      action: UserActivityAction.REGISTER,
      portal: activity?.portal || 'partner',
      country: user.country || createUserDto.country || activity?.country,
      ipAddress: activity?.ipAddress,
      userAgent: activity?.userAgent,
      browser: activity?.browser,
      os: activity?.os,
      device: activity?.device,
      metadata: {
        method: 'register',
        registrationType: 'generic',
        role: user.role,
        email: user.email,
        country: user.country || createUserDto.country,
        partnerCode: user.partnerCode,
        status: user.status,
      },
    });
    return user;
  }

  async registerPartner(
    createUserDto: CreateUserDto,
    activity?: AuthActivityContext,
  ) {
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

    await this.userActivityService.log({
      userId: user._id.toString(),
      action: UserActivityAction.REGISTER,
      portal: activity?.portal || 'partner',
      country: user.country || createUserDto.country || activity?.country,
      ipAddress: activity?.ipAddress,
      userAgent: activity?.userAgent,
      browser: activity?.browser,
      os: activity?.os,
      device: activity?.device,
      metadata: {
        method: 'register',
        registrationType: 'partner',
        role: user.role,
        email: user.email,
        country: user.country || createUserDto.country,
        partnerCode: user.partnerCode,
        status: user.status,
      },
    });

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
      stripeUrl: (stripeSession as { url?: string }).url,
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
    existingUserCouponCode?: string,
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

    return this.couponsService.validateForShopRegistration(
      code,
      subtotal,
      existingUserCouponCode,
    );
  }

  async registerShop(
    createUserDto: CreateUserDto,
    activity?: AuthActivityContext,
  ) {
    let partnerId = createUserDto.referredByPartnerCode?.trim().toUpperCase() || '';
    let hearAboutSource = createUserDto.hearAboutUs?.trim() || '';
    const hearAboutDetails = createUserDto.hearAboutUsOther?.trim() || '';

    if (hearAboutSource) {
      createUserDto.hearAboutUs = hearAboutDetails
        ? `${hearAboutSource}: ${hearAboutDetails}`
        : hearAboutSource;
      hearAboutSource = createUserDto.hearAboutUs;
    }

    const userEnteredPartnerId = !!partnerId;

    if (!partnerId) {
      if (!hearAboutSource) {
        throw new BadRequestException(
          `Please enter a valid ${NETWORK_REFERENCE_ID_LABEL} or select where you heard about us.`,
        );
      }
      // Unassigned path: stamp GLOBALHUB as referrer (not a valid entered Partner ID).
      partnerId = GLOBAL_HUB_PARTNER_CODE;
    } else if (!PARTNER_CODE_REGEX.test(partnerId)) {
      throw new BadRequestException(
        `${NETWORK_REFERENCE_ID_LABEL} must be ${PARTNER_CODE_MIN_LENGTH}-${PARTNER_CODE_MAX_LENGTH} alphanumeric characters`,
      );
    }

    let partner: any;
    if (userEnteredPartnerId) {
      // Entered ID may be Distributor, Representative, Promoter, or Hub.
      // Hub IDs additionally require selected country ∈ Hub.countries.
      const candidate = await (this.usersService as any).userModel.findOne({
        partnerCode: partnerId,
        status: 'active',
      });

      if (!candidate) {
        throw new BadRequestException(
          `Invalid ${NETWORK_REFERENCE_ID_LABEL}. Please check and try again.`,
        );
      }

      if (
        candidate.role !== UserRole.DISTRIBUTOR &&
        candidate.role !== UserRole.MASTER_PARTNER &&
        candidate.role !== UserRole.REGIONAL_PARTNER &&
        candidate.role !== UserRole.PARTNER
      ) {
        throw new BadRequestException(
          `Invalid ${NETWORK_REFERENCE_ID_LABEL}. Please check and try again.`,
        );
      }

      if (candidate.role === UserRole.PARTNER) {
        const selectedCountry = normalizeCountryName(createUserDto.country);
        if (!selectedCountry) {
          throw new BadRequestException(
            'Select a country to register with this Hub ID.',
          );
        }
        const hubCountries = candidate.countries?.length
          ? candidate.countries
          : candidate.country
            ? [candidate.country]
            : [];
        if (!hubOwnsCountry(hubCountries, selectedCountry)) {
          throw new BadRequestException(
            hubCountryMismatchError(candidate.partnerCode, selectedCountry),
          );
        }
      }

      partner = candidate;
    } else {
      partner = await (this.usersService as any).userModel.findOne({
        partnerCode: partnerId,
        role: UserRole.PARTNER,
        status: 'active',
      });
      if (!partner) {
        throw new BadRequestException(
          `Unable to complete registration. Please try again or contact support.`,
        );
      }
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

    // Force role and status for a new shop registration.
    // Payment is no longer part of the registration form — unpaid shops can log in
    // with Fusion product/course locked until they pay from the dashboard.
    const shopDto = {
      ...createUserDto,
      referredByPartnerCode: partnerId,
      couponCode: appliedCouponCode,
      role: UserRole.CERTIFIED_SHOP,
      status: UserStatus.ACTIVE,
      isPartnerPaid: isFullyCovered ? true : false,
      isSelfRegistered: true,
      productGroup: resolvedProductGroup,
    };

    try {
      console.log('[AuthService] Creating Shop user...');
      const user = await this.usersService.create(shopDto as CreateUserDto);
      console.log('[AuthService] Shop user created:', user._id);

      await this.userActivityService.log({
        userId: user._id.toString(),
        action: UserActivityAction.REGISTER,
        portal: activity?.portal || 'shop',
        country: user.country || createUserDto.country || activity?.country,
        ipAddress: activity?.ipAddress,
        userAgent: activity?.userAgent,
        browser: activity?.browser,
        os: activity?.os,
        device: activity?.device,
        metadata: {
          method: 'register',
          registrationType: 'shop',
          role: user.role,
          email: user.email,
          country: user.country || createUserDto.country,
          partnerCode: user.partnerCode,
          referredBy: partnerId,
          status: user.status,
          couponCode: appliedCouponCode,
        },
      });

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

      return {
        message: isFullyCovered
          ? 'Registration successful with coupon applied! You can now log in.'
          : 'Registration successful! You can now log in.',
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          status: user.status,
          isPaid: isFullyCovered,
          hasSeenWelcomePopup: user.hasSeenWelcomePopup,
        }
      };
    } catch (err: any) {
      console.error('[AuthService] CRITICAL: registerShop failed:', err);
      throw new BadRequestException(`Registration error: ${err.message || 'Unknown server error'}`);
    }

  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const portalRoles = this.rolesForPortal(forgotPasswordDto.portal);
    const user = await this.usersService.findByEmailForRoles(
      forgotPasswordDto.email,
      portalRoles,
    );
    if (!user) {
      const otherUser = await this.usersService.findByEmailForRoles(
        forgotPasswordDto.email,
        this.otherPortalRoles(forgotPasswordDto.portal),
      );
      if (otherUser) {
        throw new BadRequestException(
          forgotPasswordDto.portal === 'shop'
            ? 'This email is registered on the Partner portal. Use Partner Login → Forgot Password.'
            : 'This email is registered on the Shop portal. Use Shop Login → Forgot Password.',
        );
      }
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
    user.refreshTokenHash = undefined;
    await user.save();

    return { message: 'Password has been reset successfully' };
  }

  async verifyRegistrationPayment(userId: string) {
    return this.ordersService.verifyRegistrationPayment(userId);
  }

  /**
   * One-time access JWT for admin→portal handoff.
   * Does NOT rotate refresh tokens (avoids kicking the real user's session).
   * Frontend exchanges via POST /auth/establish-session.
   */
  async impersonate(targetUserId: string, activity?: AuthActivityContext) {
    const user = await (this.usersService as any).userModel.findById(targetUserId);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    const userId = user._id.toString();
    await this.userActivityService.log({
      userId,
      action: UserActivityAction.IMPERSONATE,
      actorId: activity?.actorId,
      portal: activity?.portal || 'admin',
      country: user.country || activity?.country,
      ipAddress: activity?.ipAddress,
      userAgent: activity?.userAgent,
      browser: activity?.browser,
      os: activity?.os,
      device: activity?.device,
      metadata: {
        method: 'impersonate',
        targetRole: user.role,
        targetEmail: user.email,
        targetName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
        country: user.country,
        partnerCode: user.partnerCode,
        status: user.status,
      },
    });

    const accessExpiresIn = this.accessExpiresIn();
    const access_token = this.jwtService.sign(
      { email: user.email, sub: userId, role: user.role },
      { expiresIn: accessExpiresIn as any },
    );

    return {
      access_token,
      refresh_token: '',
      csrf_token: '',
      accessMaxAgeMs: parseDurationToMs(accessExpiresIn, 15 * 60_000),
      refreshMaxAgeMs: 0,
      user: this.toPublicUser(user, userId),
    } as IssuedAuthTokens;
  }
}
