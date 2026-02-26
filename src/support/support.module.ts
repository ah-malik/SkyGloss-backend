import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { SupportTicket, SupportTicketSchema } from './entities/support.entity';

import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SupportTicket.name, schema: SupportTicketSchema }]),
    NotificationsModule,
  ],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule { }
