import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PublicUsersController } from './public-users.controller';
import { User, UserSchema } from './entities/user.entity';
import { SoftDeleteScheduler } from './soft-delete.scheduler';

import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatModule } from '../chat/chat.module';
import { MailModule } from 'src/mail/mail.module';
import { ProductGroup, ProductGroupSchema } from '../product-groups/entities/product-group.entity';
import { Order, OrderSchema } from '../orders/entities/order.entity';
import { BackblazeModule } from '../backblaze/backblaze.module';
import { PartnerAgreementFilesService } from './partner-agreement-files.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ProductGroup.name, schema: ProductGroupSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    CloudinaryModule,
    forwardRef(() => NotificationsModule),
    forwardRef(() => ChatModule),
    MailModule,
    BackblazeModule,
  ],
  controllers: [UsersController, PublicUsersController],
  providers: [UsersService, SoftDeleteScheduler, PartnerAgreementFilesService],
  exports: [UsersService, MongooseModule, PartnerAgreementFilesService],
})
export class UsersModule { }
