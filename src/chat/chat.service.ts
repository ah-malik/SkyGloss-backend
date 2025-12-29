import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatRoom, ChatRoomDocument } from './entities/chat-room.entity';
import { ChatMessage, ChatMessageDocument } from './entities/chat-message.entity';

@Injectable()
export class ChatService {
    constructor(
        @InjectModel(ChatRoom.name) private chatRoomModel: Model<ChatRoomDocument>,
        @InjectModel(ChatMessage.name) private chatMessageModel: Model<ChatMessageDocument>,
    ) { }

    async createOrGetRoom(userData: {
        userId?: string;
        userName: string;
        userEmail: string;
        userType: string;
    }): Promise<ChatRoom> {
        // Try to find existing active room for this user
        if (userData.userId) {
            const existingRoom = await this.chatRoomModel
                .findOne({ userId: new Types.ObjectId(userData.userId), status: 'active' })
                .exec();
            if (existingRoom) return existingRoom;
        }

        // Create new room
        const newRoom = new this.chatRoomModel({
            userId: userData.userId ? new Types.ObjectId(userData.userId) : null,
            userName: userData.userName,
            userEmail: userData.userEmail,
            userType: userData.userType,
            status: 'active',
        });
        return newRoom.save();
    }

    async saveMessage(
        roomId: string,
        senderName: string,
        senderType: string,
        message: string,
    ): Promise<ChatMessage> {
        const chatMessage = new this.chatMessageModel({
            roomId: new Types.ObjectId(roomId),
            senderName,
            senderType,
            message,
        });

        // Update room's last message
        await this.chatRoomModel.findByIdAndUpdate(roomId, {
            lastMessage: message,
            lastMessageAt: new Date(),
        });

        return chatMessage.save();
    }

    async getMessages(roomId: string): Promise<ChatMessage[]> {
        return this.chatMessageModel
            .find({ roomId: new Types.ObjectId(roomId) })
            .sort({ createdAt: 1 })
            .exec();
    }

    async getAllRooms(): Promise<ChatRoom[]> {
        return this.chatRoomModel.find().sort({ lastMessageAt: -1, createdAt: -1 }).exec();
    }

    async getRoomById(roomId: string): Promise<ChatRoom | null> {
        return this.chatRoomModel.findById(roomId).exec();
    }

    async closeRoom(roomId: string): Promise<ChatRoom | null> {
        return this.chatRoomModel.findByIdAndUpdate(roomId, { status: 'closed' }, { new: true }).exec();
    }
}
