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
import { UsersService } from '../users/users.service';

@Injectable()
export class SupportService {
  constructor(
    @InjectModel(SupportTicket.name)
    private supportTicketModel: Model<SupportTicketDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly usersService: UsersService,
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
    const existingTicket = await this.supportTicketModel.findById(id).exec();
    if (!existingTicket) {
      throw new NotFoundException(`Support ticket #${id} not found`);
    }

    const updateData: any = { ...updateSupportDto };
    let notifyUserEmail = null;

    if (updateSupportDto.adminReply) {
      updateData.adminReplyDate = new Date();
      notifyUserEmail = existingTicket.email;
    }

    const updatedTicket = await this.supportTicketModel
      .findByIdAndUpdate(id, { $set: updateData }, { new: true })
      .exec();

    if (notifyUserEmail) {
      // Find the user by email
      try {
        const user = await this.usersService.findByEmail(notifyUserEmail);
        if (user) {
          const notification = await this.notificationsService.create({
            type: NotificationType.SUPPORT_TICKET,
            title: 'Support Ticket Update',
            message: `SkyGloss Support has replied to your ticket.`,
            user: user._id as any,
            metadata: { ticketId: updatedTicket._id },
            link: '/support',
          });
          this.notificationsGateway.broadcastNotification(notification);
        }
      } catch (e) {
        console.error('Failed to notify user for support reply', e);
      }
    }

    return updatedTicket;
  }

  remove(id: number) {
    return `This action removes a #${id} support`;
  }
}
