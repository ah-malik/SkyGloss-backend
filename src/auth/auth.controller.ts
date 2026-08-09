import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService, IssuedAuthTokens } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginAccessCodeDto } from './dto/login-access-code.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ValidateShopRegistrationCouponDto } from '../coupons/dto/validate-shop-registration-coupon.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { getRequestMeta } from '../user-activity/request-meta';
import * as crypto from 'crypto';
import {
  clearAuthCookies,
  CSRF_TOKEN_COOKIE,
  parseDurationToMs,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
  setCsrfCookie,
} from './auth-cookies';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  private attachAuthCookies(res: Response, issued: IssuedAuthTokens) {
    setAuthCookies(res, {
      accessToken: issued.access_token,
      refreshToken: issued.refresh_token,
      csrfToken: issued.csrf_token,
      accessMaxAgeMs: issued.accessMaxAgeMs,
      refreshMaxAgeMs: issued.refreshMaxAgeMs,
    });
  }

  /**
   * Public login payload.
   * csrf_token is returned in JSON because the SPA cannot read cross-origin
   * Set-Cookie values via document.cookie (API host ≠ portal/admin host).
   * Refresh token stays cookie-only.
   */
  private toClientAuthResponse(issued: IssuedAuthTokens) {
    return {
      access_token: issued.access_token,
      csrf_token: issued.csrf_token,
      user: issued.user,
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
      loginDto.portal,
    );
    if (!user) {
      throw new BadRequestException('Invalid credentials');
    }
    const meta = getRequestMeta(req);
    const result = await this.authService.login(user, {
      portal: loginDto.portal,
      ...meta,
    });

    if ((result as any).paymentRequired) {
      return result;
    }

    const issued = result as IssuedAuthTokens;
    this.attachAuthCookies(res, issued);
    return this.toClientAuthResponse(issued);
  }

  @Post('login/access-code')
  @HttpCode(HttpStatus.OK)
  async loginAccessCode(
    @Body() loginAccessCodeDto: LoginAccessCodeDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta = getRequestMeta(req);
    const result = await this.authService.loginWithAccessCode(
      loginAccessCodeDto,
      {
        portal: 'shop',
        ...meta,
      },
    );

    if ((result as any).paymentRequired) {
      return result;
    }

    const issued = result as IssuedAuthTokens;
    this.attachAuthCookies(res, issued);
    return this.toClientAuthResponse(issued);
  }

  @Post('register')
  async register(@Body() createUserDto: CreateUserDto, @Req() req: any) {
    const meta = getRequestMeta(req);
    return this.authService.register(createUserDto, {
      portal: 'partner',
      country: createUserDto.country,
      ...meta,
    });
  }

  @Post('register-partner')
  async registerPartner(@Body() createUserDto: CreateUserDto, @Req() req: any) {
    const meta = getRequestMeta(req);
    return this.authService.registerPartner(createUserDto, {
      portal: 'partner',
      country: createUserDto.country,
      ...meta,
    });
  }

  @Post('register-shop')
  async registerShop(@Body() createUserDto: CreateUserDto, @Req() req: any) {
    const meta = getRequestMeta(req);
    return this.authService.registerShop(createUserDto, {
      portal: 'shop',
      country: createUserDto.country,
      ...meta,
    });
  }

  @Post('validate-shop-registration-coupon')
  @HttpCode(HttpStatus.OK)
  async validateShopRegistrationCoupon(
    @Body() dto: ValidateShopRegistrationCouponDto,
  ) {
    return this.authService.validateShopRegistrationCoupon(dto.code, dto.country);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req, @Res({ passthrough: true }) res: Response) {
    // Sync CSRF to SPA via exposed header (cross-origin cookies are not JS-readable).
    // Reuse existing cookie when present so other open tabs are not invalidated.
    const existing = req.cookies?.[CSRF_TOKEN_COOKIE];
    const refreshMaxAgeMs = parseDurationToMs(
      process.env.JWT_REFRESH_EXPIRATION || '7d',
      7 * 86_400_000,
    );
    if (existing) {
      res.setHeader('X-CSRF-Token', existing);
    } else {
      const csrfToken = crypto.randomBytes(32).toString('hex');
      setCsrfCookie(res, csrfToken, refreshMaxAgeMs);
    }
    return req.user;
  }

  @Get('verify-payment/:userId')
  async verifyPayment(@Request() req) {
    const userId = req.params.userId;
    return this.authService.verifyRegistrationPayment(userId);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Post('impersonate/:userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async impersonate(
    @Param('userId') userId: string,
    @Req() req: any,
  ) {
    const meta = getRequestMeta(req);
    const actorId =
      req.user?.id ||
      req.user?._id?.toString?.() ||
      (typeof req.user?._id === 'string' ? req.user._id : undefined);
    const issued = await this.authService.impersonate(userId, {
      portal: 'admin',
      actorId,
      ...meta,
    });
    // Do not set cookies here — admin browser must not become the target user.
    // Frontend exchanges access_token via /auth/establish-session.
    return this.toClientAuthResponse(issued);
  }

  /**
   * Bootstrap HttpOnly cookies from a one-time Bearer access token
   * (legacy localStorage migration or admin impersonation handoff).
   * Body: { impersonation?: boolean } — when true, do not revoke the real user's refresh session.
   */
  @Post('establish-session')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async establishSession(
    @Req() req: any,
    @Body('impersonation') impersonation: boolean | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.authService.issueAuthTokens(req.user, {
      rotateRefresh: !impersonation,
    });
    this.attachAuthCookies(res, issued);
    return this.toClientAuthResponse(issued);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!refreshToken) {
      clearAuthCookies(res);
      throw new UnauthorizedException('Refresh token missing');
    }

    try {
      const issued = await this.authService.refreshAuthTokens(refreshToken);
      this.attachAuthCookies(res, issued);
      return this.toClientAuthResponse(issued);
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    let userId: string | undefined =
      req.user?._id?.toString?.() ||
      req.user?.id ||
      undefined;

    if (!userId) {
      const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
      if (refreshToken) {
        userId = this.authService.peekRefreshUserId(refreshToken) || undefined;
      }
    }

    if (userId) {
      await this.authService.revokeRefreshToken(userId);
    }

    clearAuthCookies(res);
    return { message: 'Logged out successfully' };
  }
}
