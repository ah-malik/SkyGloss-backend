import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  Req,
  BadRequestException,
  Delete,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateAdminTestOrderDto } from './dto/create-admin-test-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { GetUser } from '../common/decorators/get-user.decorator';
import { UserDocument } from '../users/entities/user.entity';
import type { RawBodyRequest } from '@nestjs/common';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout-session')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CERTIFIED_SHOP,
    UserRole.PARTNER,
    UserRole.REGIONAL_PARTNER,
    // UserRole.SUB_PROMOTER, // removed
    UserRole.MASTER_PARTNER,
    UserRole.DISTRIBUTOR,
  )
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

  @Post('activation-fee')
  @UseGuards(JwtAuthGuard)
  async createActivationFeeSession(@GetUser() user: any) {
    const session = await this.ordersService.createDistributorFeeCheckoutSession(
      user._id.toString(),
      user.email,
      {
        type: 'shop_registration',
        referredByPartnerCode: user.referredByPartnerCode,
        country: user.country,
        successPath: '/dashboard/shop?payment_success=true',
        cancelPath: '/dashboard/shop?payment_canceled=true',
      }
    );
    return { url: session.url };
  }

  @Get('my-orders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CERTIFIED_SHOP,
    UserRole.PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.MASTER_PARTNER,
    UserRole.DISTRIBUTOR,
    // UserRole.SUB_PROMOTER, // removed
  )
  getMyOrders(@GetUser('_id') userId: string) {
    return this.ordersService.getMyOrders(userId);
  }

  @Get('network-orders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.MASTER_PARTNER,
    UserRole.DISTRIBUTOR,
    // UserRole.SUB_PROMOTER, // removed
  )
  async getNetworkOrders(@GetUser() user: any) {
    try {
      return await this.ordersService.getNetworkOrders(user);
    } catch (error) {
      console.error('[NetworkOrders Error]:', error);
      throw error;
    }
  }

  @Get('network-sales-stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.MASTER_PARTNER,
    UserRole.DISTRIBUTOR,
    // UserRole.SUB_PROMOTER, // removed
  )
  getNetworkSalesStats(@GetUser() user: UserDocument) {
    return this.ordersService.getNetworkSalesStats(user);
  }

  @Get('commission-orders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER)
  async getCommissionOrders(@GetUser() user: UserDocument) {
    return this.ordersService.getCommissionOrders(user);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CERTIFIED_SHOP,
    UserRole.PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.MASTER_PARTNER,
    UserRole.DISTRIBUTOR,
    UserRole.ADMIN,
    // UserRole.SUB_PROMOTER, // removed
  )
  getOrderById(@Param('id') id: string, @GetUser() user: UserDocument) {
    return this.ordersService.getOrderById(id, user);
  }

  @Post(':id/pay')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CERTIFIED_SHOP,
    UserRole.PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.MASTER_PARTNER,
    UserRole.DISTRIBUTOR,
    // UserRole.SUB_PROMOTER, // removed
  )
  payForOrder(
    @Param('id') id: string,
    @GetUser('_id') userId: string,
    @GetUser('role') role: string,
  ) {
    return this.ordersService.createPaymentSessionForOrder(id, userId, role);
  }

  @Get('verify/:orderId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CERTIFIED_SHOP,
    UserRole.PARTNER,
    UserRole.REGIONAL_PARTNER,
    UserRole.MASTER_PARTNER,
    UserRole.DISTRIBUTOR,
    // UserRole.SUB_PROMOTER, // removed
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

  @Post('admin/test-order')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  createTestOrder(@Body() dto: CreateAdminTestOrderDto) {
    return this.ordersService.createAdminTestOrder(dto);
  }



  @Post('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.PARTNER, UserRole.DISTRIBUTOR)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: any,
    @Body('trackingId') trackingId?: string,
    @Body('shippingCompany') shippingCompany?: string,
    @GetUser() user?: UserDocument,
  ) {
    return this.ordersService.updateStatus(
      id,
      status,
      trackingId,
      shippingCompany,
      user,
    );
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  deleteOrder(@Param('id') id: string) {
    return this.ordersService.deleteOrder(id);
  }

  @Get('admin/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getDashboardStats() {
    return this.ordersService.getDashboardStats();
  }

  @Get('admin/exchange-rates')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getExchangeRates() {
    return this.ordersService.getExchangeRates();
  }

  @Post('admin/exchange-rates')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateExchangeRate(
    @Body('currency') currency: string,
    @Body('rateToBase') rateToBase: number,
  ) {
    return this.ordersService.updateExchangeRate(currency, rateToBase);
  }

  @Post('admin/exchange-rates/refresh')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  refreshExchangeRatesFromMarket() {
    return this.ordersService.refreshExchangeRatesFromMarket();
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

  @Post('webhook-usa')
  async handleUsaWebhook(@Req() req: RawBodyRequest<any>) {
    console.log('[USA Stripe Webhook] Received request at /orders/webhook-usa');
    const sig = req.headers['stripe-signature'];

    if (!sig) {
      console.error('[USA Stripe Webhook] Missing stripe-signature header');
      throw new BadRequestException('Missing stripe-signature header');
    }

    if (!req.rawBody) {
      console.error('[USA Stripe Webhook] CRITICAL: req.rawBody is MISSING.');
      throw new BadRequestException('No webhook payload provided');
    }

    console.log(`[USA Stripe Webhook] Payload size: ${req.rawBody.length} bytes`);
    return this.ordersService.handleUsaWebhook(sig as string, req.rawBody);
  }

  @Post('request')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.ADMIN,
    UserRole.MASTER_PARTNER,
    UserRole.DISTRIBUTOR,
    UserRole.REGIONAL_PARTNER,
    // UserRole.SUB_PROMOTER, // removed
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
