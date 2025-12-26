import { Controller, Post, Body, UseGuards, Get, Param, Req, BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { GetUser } from '../common/decorators/get-user.decorator';
import type { RawBodyRequest } from '@nestjs/common';

@Controller('orders')
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) { }

    @Post('checkout-session')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SHOP)
    createCheckoutSession(
        @GetUser('_id') userId: string,
        @Body() createOrderDto: CreateOrderDto,
    ) {
        return this.ordersService.createCheckoutSession(userId, createOrderDto);
    }

    @Get('my-orders')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SHOP)
    getMyOrders(@GetUser('_id') userId: string) {
        return this.ordersService.getMyOrders(userId);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SHOP, UserRole.ADMIN)
    getOrderById(@Param('id') id: string) {
        return this.ordersService.getOrderById(id);
    }

    @Get('verify/:orderId')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SHOP)
    verifyPayment(@Param('orderId') orderId: string) {
        return this.ordersService.verifyPayment(orderId);
    }

    @Get('admin/all')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    getAllOrders() {
        return this.ordersService.getAllOrders();
    }

    @Post('admin/:id/status')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    updateStatus(
        @Param('id') id: string,
        @Body('status') status: any,
    ) {
        return this.ordersService.updateStatus(id, status);
    }

    // Not guarding webhook as it comes from Stripe server
    @Post('webhook')
    async handleWebhook(@Req() req: RawBodyRequest<any>) {
        const sig = req.headers['stripe-signature'];
        if (typeof sig !== 'string') {
            throw new BadRequestException('Missing stripe-signature header');
        }
        return this.ordersService.handleWebhook(sig as string, req.rawBody);
    }
}
