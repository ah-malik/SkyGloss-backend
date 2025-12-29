import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { SupportTicket, SupportTicketSchema } from './entities/support.entity';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SupportTicket.name, schema: SupportTicketSchema }]),
  ],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule { }
