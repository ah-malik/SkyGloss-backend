import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateSupportDto } from './dto/create-support.dto';
import { UpdateSupportDto } from './dto/update-support.dto';
import {
  SupportTicket,
  SupportTicketDocument,
} from './entities/support.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationType } from '../notifications/entities/notification.entity';

@Injectable()
export class SupportService {
  constructor(
    @InjectModel(SupportTicket.name)
    private supportTicketModel: Model<SupportTicketDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async create(createSupportDto: CreateSupportDto): Promise<SupportTicket> {
    const createdTicket = new this.supportTicketModel(createSupportDto);
    const savedTicket = await createdTicket.save();

    // Notify admins about the new support ticket
    const notification = await this.notificationsService.create({
      type: NotificationType.SUPPORT_TICKET,
      title: 'New Support Ticket',
      message: `A new support ticket has been submitted by ${savedTicket.name}.`,
      metadata: { ticketId: savedTicket._id, email: savedTicket.email },
      link: '/support-tickets',
    });
    this.notificationsGateway.broadcastNotification(notification);

    return savedTicket;
  }

  async findAll(): Promise<SupportTicket[]> {
    return this.supportTicketModel.find().sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string): Promise<SupportTicket | null> {
    return this.supportTicketModel.findById(id).exec();
  }

  async findByEmail(email: string): Promise<SupportTicket[]> {
    return this.supportTicketModel.find({ email: new RegExp('^' + email + '$', 'i') }).sort({ createdAt: -1 }).exec();
  }

  async update(
    id: string,
    updateSupportDto: UpdateSupportDto,
  ): Promise<SupportTicket> {
    const updateData: any = { ...updateSupportDto };
    if (updateSupportDto.adminReply) {
      updateData.adminReplyDate = new Date();
      // Optionally also set status to resolved if a reply is made
      // updateData.status = TicketStatus.RESOLVED; 
    }

    const existingTicket = await this.supportTicketModel
      .findByIdAndUpdate(id, { $set: updateData }, { new: true })
      .exec();

    if (!existingTicket) {
      throw new NotFoundException(`Support ticket #${id} not found`);
    }

    return existingTicket;
  }

  remove(id: number) {
    return `This action removes a #${id} support`;
  }
}
