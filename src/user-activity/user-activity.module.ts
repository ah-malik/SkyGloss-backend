import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UserActivityLog,
  UserActivityLogSchema,
} from './entities/user-activity-log.entity';
import { UserActivityService } from './user-activity.service';
import { UserActivityController } from './user-activity.controller';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserActivityLog.name, schema: UserActivityLogSchema },
    ]),
  ],
  controllers: [UserActivityController],
  providers: [UserActivityService],
  exports: [UserActivityService],
})
export class UserActivityModule {}
