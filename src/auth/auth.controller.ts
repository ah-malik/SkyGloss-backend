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
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginAccessCodeDto } from './dto/login-access-code.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ValidateShopRegistrationCouponDto } from '../coupons/dto/validate-shop-registration-coupon.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
      loginDto.portal,
    );
    if (!user) {
      throw new BadRequestException('Invalid credentials');
    }
    return this.authService.login(user); // user is the plain object from validateUser
  }

  @Post('login/access-code')
  @HttpCode(HttpStatus.OK)
  async loginAccessCode(@Body() loginAccessCodeDto: LoginAccessCodeDto) {
    return this.authService.loginWithAccessCode(loginAccessCodeDto);
  }

  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @Post('register-partner')
  async registerPartner(@Body() createUserDto: CreateUserDto) {
    return this.authService.registerPartner(createUserDto);
  }

  @Post('register-shop')
  async registerShop(@Body() createUserDto: CreateUserDto) {
    return this.authService.registerShop(createUserDto);
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
  getProfile(@Request() req) {
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
  async impersonate(@Param('userId') userId: string) {
    return this.authService.impersonate(userId);
  }
}
