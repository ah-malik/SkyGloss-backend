import { Module, forwardRef } from '@nestjs/common';
import { MailService } from './mail.service';
import { ConfigModule } from '@nestjs/config';
import { EmailSettingsModule } from '../email-settings/email-settings.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    ConfigModule,
    EmailSettingsModule,
    forwardRef(() => UsersModule),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
