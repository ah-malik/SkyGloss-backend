import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
    constructor(private readonly chatService: ChatService) { }

    @Post('room')
    async createRoom(
        @Body()
        userData: {
            userId?: string;
            userName: string;
            userEmail: string;
            userType: string;
        },
    ) {
        return this.chatService.createOrGetRoom(userData);
    }

    @Get('rooms')
    async getAllRooms() {
        return this.chatService.getAllRooms();
    }

    @Get('room/:id')
    async getRoom(@Param('id') id: string) {
        return this.chatService.getRoomById(id);
    }

    @Get('room/:id/messages')
    async getRoomMessages(@Param('id') id: string) {
        return this.chatService.getMessages(id);
    }

    @Post('room/:id/close')
    async closeRoom(@Param('id') id: string) {
        return this.chatService.closeRoom(id);
    }
}
