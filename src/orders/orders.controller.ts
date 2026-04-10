import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  Req,
  BadRequestException,
} from '@nestjs/common';
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
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout-session')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CERTIFIED_SHOP)
  createCheckoutSession(
    @GetUser('_id') userId: string,
    @GetUser('role') role: string,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.ordersService.createCheckoutSession(
      userId,
      createOrderDto,
      role,
    );
  }

  @Get('my-orders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CERTIFIED_SHOP,
    UserRole.PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.MASTER_PARTNER,
  )
  getMyOrders(@GetUser('_id') userId: string) {
    return this.ordersService.getMyOrders(userId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CERTIFIED_SHOP,
    UserRole.PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.MASTER_PARTNER,
    UserRole.ADMIN,
  )
  getOrderById(@Param('id') id: string) {
    return this.ordersService.getOrderById(id);
  }

  @Get('verify/:orderId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CERTIFIED_SHOP,
    UserRole.PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.MASTER_PARTNER,
  )
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
  updateStatus(@Param('id') id: string, @Body('status') status: any) {
    return this.ordersService.updateStatus(id, status);
  }

  @Get('admin/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getDashboardStats() {
    return this.ordersService.getDashboardStats();
  }

  @Post('webhook')
  async handleWebhook(@Req() req: RawBodyRequest<any>) {
    console.log('[Stripe Webhook] Received request at /orders/webhook');
    const sig = req.headers['stripe-signature'];
    
    if (!sig) {
      console.error('[Stripe Webhook] Missing stripe-signature header');
      throw new BadRequestException('Missing stripe-signature header');
    }

    if (!req.rawBody) {
      console.error('[Stripe Webhook] CRITICAL: req.rawBody is MISSING. Check main.ts configuration.');
      throw new BadRequestException('No webhook payload provided');
    }

    console.log(`[Stripe Webhook] Payload size: ${req.rawBody.length} bytes`);
    return this.ordersService.handleWebhook(sig as string, req.rawBody);
  }

  @Post('request')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.ADMIN,
    UserRole.MASTER_PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.PARTNER,
    UserRole.CERTIFIED_SHOP,
  )
  createOrderRequest(
    @GetUser('_id') userId: string,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.ordersService.createOrderRequest(userId, createOrderDto);
  }
}
