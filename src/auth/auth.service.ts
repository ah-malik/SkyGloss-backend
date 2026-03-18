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
        country: loginAccessCodeDto.country,
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

  async registerDistributor(createUserDto: CreateUserDto) {
    // Override role and status for a new distributor registration
    const distributorDto = {
      ...createUserDto,
      role: UserRole.REGIONAL_DISTRIBUTOR, // Assuming Regional Distributor by default for this flow
      status: UserStatus.PENDING,
      isSelfRegistered: true,
    };

    const user = await this.usersService.create(distributorDto as CreateUserDto);

    // Send Emails asynchronously
    if (user.email) {
      this.mailService.sendDistributorRegistrationUserConfirmation(user.email, user).catch(err => console.error(err));

      this.usersService.findAll().then(users => {
        const adminEmails = users.filter(u => u.role === UserRole.ADMIN && u.email).map(u => u.email as string);
        if (adminEmails.length > 0) {
          this.mailService.sendDistributorRegistrationAdminNotification(adminEmails, user).catch(err => console.error(err));
        }
      }).catch(err => console.error(err));
    }

    try {
      const notification = await this.notificationsService.create({
        type: NotificationType.NEW_USER,
        title: 'New Distributor Registration',
        message: `A new distributor (${user.firstName} ${user.lastName}) has registered and is pending payment.`,
        metadata: {
          userId: user._id.toString(),
          email: user.email,
          role: user.role,
        },
      });
      this.notificationsGateway.broadcastNotification(notification);
    } catch (err) {
      console.error('Failed to create admin notification for new distributor', err);
    }

    // Create Stripe Checkout Session
    const stripeSession = await this.ordersService.createDistributorFeeCheckoutSession(
      user._id.toString(),
      user.email || ''
    );

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
}
