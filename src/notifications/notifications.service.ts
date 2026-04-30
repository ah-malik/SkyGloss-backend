import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
  ) { }

  async create(data: {
    type: NotificationType;
    title: string;
    message: string;
    metadata?: any;
    user?: string;
    triggeredBy?: string;
    link?: string;
  }): Promise<NotificationDocument> {
    console.log(
      '[DEBUG] NotificationsService.create called with:',
      JSON.stringify(data),
    );
    try {
      const notification = new this.notificationModel(data);
      const saved = await notification.save();
      console.log('[DEBUG] Notification saved successfully:', saved._id);
      return saved;
    } catch (error) {
      console.error('[DEBUG] Error saving notification:', error);
      throw error;
    }
  }

  async createOrUpdateChatNotification(data: {
    type: NotificationType;
    title: string;
    message: string;
    metadata?: any;
    link?: string;
    triggeredBy?: string;
  }): Promise<{ notification: NotificationDocument; isNew: boolean }> {
    // Find existing unread chat notification for this specific room
    const existingNotification = await this.notificationModel.findOne({
      type: NotificationType.CHAT_MESSAGE,
      'metadata.roomId': data.metadata?.roomId,
      isRead: false,
    });

    if (existingNotification) {
      // Update the existing notification
      existingNotification.message = data.message;
      existingNotification.title = data.title;
      existingNotification.triggeredBy = data.triggeredBy as any;
      const currentCount = existingNotification.metadata?.unreadCount || 1;

      // Re-assign metadata to trigger Mongoose Mixed type update
      existingNotification.metadata = {
        ...existingNotification.metadata,
        ...data.metadata,
        unreadCount: currentCount + 1,
      };

      // Mark as 'modified' so Mongoose saves the Mixed object correctly
      existingNotification.markModified('metadata');

      const saved = await existingNotification.save();
      return { notification: saved, isNew: false };
    } else {
      // Create a completely new notification
      const newNotifData = {
        ...data,
        triggeredBy: data.triggeredBy,
        metadata: {
          ...data.metadata,
          unreadCount: 1,
        },
      };
      const notification = new this.notificationModel(newNotifData);
      const saved = await notification.save();
      return { notification: saved, isNew: true };
    }
  }

  async findAllAdmin(): Promise<NotificationDocument[]> {
    return this.notificationModel
      .find()
      .populate('user', 'firstName lastName email role')
      .sort({ createdAt: -1 })
      .limit(100)
      .exec();
  }

  async markAsRead(id: string): Promise<NotificationDocument> {
    const notification = await this.notificationModel.findByIdAndUpdate(
      id,
      { isRead: true },
      { new: true },
    );
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    return notification;
  }

  async markAllAsRead(): Promise<void> {
    await this.notificationModel
      .updateMany({ isRead: false }, { isRead: true })
      .exec();
  }

  async getUnreadCount(): Promise<number> {
    return this.notificationModel.countDocuments({ isRead: false }).exec();
  }

  async getUnreadCountForUser(userId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({
        user: userId,
        isRead: false,
        triggeredBy: { $ne: userId as any },
      } as any)
      .exec();
  }

  async markChatNotificationsAsReadForUser(userId: string): Promise<void> {
    await this.notificationModel
      .updateMany(
        {
          user: userId as any,
          type: NotificationType.CHAT_MESSAGE,
          isRead: false,
        },
        { isRead: true },
      )
      .exec();
  }

  async markChatNotificationsAsReadByTriggeredBy(userId: string, triggeredById: string): Promise<void> {
    await this.notificationModel
      .updateMany(
        {
          user: userId as any,
          triggeredBy: triggeredById as any,
          type: NotificationType.CHAT_MESSAGE,
          isRead: false,
        },
        { isRead: true },
      )
      .exec();
  }

  async markAllAsReadForUser(userId: string): Promise<void> {
    await this.notificationModel
      .updateMany(
        {
          user: userId as any,
          isRead: false,
        },
        { isRead: true },
      )
      .exec();
  }




  async deleteOldNotifications(days: number = 30): Promise<void> {
    const date = new Date();
    date.setDate(date.getDate() - days);
    await this.notificationModel
      .deleteMany({ createdAt: { $lt: date } })
      .exec();
  }

  async findAllForUser(userId: string): Promise<NotificationDocument[]> {
    return this.notificationModel
      .find({
        user: userId as any,
        triggeredBy: { $ne: userId as any }, // Exclude self-triggered notifications
      })
      .sort({ createdAt: -1 })
      .limit(20)
      .exec();
  }
}
