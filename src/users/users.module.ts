import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PublicUsersController } from './public-users.controller';
import { User, UserSchema } from './entities/user.entity';

import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatModule } from '../chat/chat.module';
import { MailModule } from 'src/mail/mail.module';
import { ProductGroup, ProductGroupSchema } from '../product-groups/entities/product-group.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ProductGroup.name, schema: ProductGroupSchema }
    ]),
    CloudinaryModule,
    forwardRef(() => NotificationsModule),
    forwardRef(() => ChatModule),
    MailModule,
  ],
  controllers: [UsersController, PublicUsersController],
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule { }
