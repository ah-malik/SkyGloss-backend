import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AccountActivationRequest,
  AccountActivationRequestSchema,
} from './entities/account-activation-request.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { AccountActivationService } from './account-activation.service';
import { AccountActivationController } from './account-activation.controller';
import { UsersModule } from '../users/users.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: AccountActivationRequest.name,
        schema: AccountActivationRequestSchema,
      },
      { name: User.name, schema: UserSchema },
    ]),
    UsersModule,
    PayoutsModule,
    NotificationsModule,
    MediaModule,
  ],
  controllers: [AccountActivationController],
  providers: [AccountActivationService],
  exports: [AccountActivationService],
})
export class AccountActivationModule {}
