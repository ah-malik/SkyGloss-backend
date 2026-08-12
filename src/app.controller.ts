import {
  BadRequestException,
  Controller,
  Get,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { AppService } from './app.service';
import { OrdersService } from './orders/orders.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Legacy Stripe Dashboard URL still points here:
   * https://.../stripe/webhook
   * Delegate to the real Global Stripe handler so shop/partner
   * registration payments activate + email correctly.
   */
  @Post('stripe/webhook')
  async handleStripeWebhook(@Req() req: RawBodyRequest<any>) {
    console.log('[Stripe Webhook] Received request at /stripe/webhook (legacy alias)');
    const sig = req.headers['stripe-signature'];

    if (!sig) {
      console.error('[Stripe Webhook] Missing stripe-signature header');
      throw new BadRequestException('Missing stripe-signature header');
    }

    if (!req.rawBody) {
      console.error(
        '[Stripe Webhook] CRITICAL: req.rawBody is MISSING. Check main.ts configuration.',
      );
      throw new BadRequestException('No webhook payload provided');
    }

    console.log(
      `[Stripe Webhook] Payload size: ${req.rawBody.length} bytes (via /stripe/webhook)`,
    );
    return this.ordersService.handleWebhook(sig as string, req.rawBody);
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
