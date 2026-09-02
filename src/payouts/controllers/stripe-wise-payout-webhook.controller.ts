import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { StripeAccountKey } from '../stripe-wise-payouts.logic';
import { StripeAccountService } from '../services/stripe-account.service';
import { StripeWisePayoutsService } from '../services/stripe-wise-payouts.service';

@Controller('webhooks')
export class StripeWisePayoutWebhookController {
  constructor(
    private readonly stripeAccounts: StripeAccountService,
    private readonly payouts: StripeWisePayoutsService,
  ) {}

  @Post('stripe-wise-payouts')
  handleGlobal(
    @Req() req: RawBodyRequest<{ rawBody?: Buffer }>,
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.handle('global', req, signature);
  }

  @Post('stripe-wise-payouts-usa')
  handleUsa(
    @Req() req: RawBodyRequest<{ rawBody?: Buffer }>,
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.handle('usa', req, signature);
  }

  @Post('stripe-wise-payouts-europe')
  handleEurope(
    @Req() req: RawBodyRequest<{ rawBody?: Buffer }>,
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.handle('europe', req, signature);
  }

  private async handle(
    key: StripeAccountKey,
    req: RawBodyRequest<{ rawBody?: Buffer }>,
    signature?: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    const raw = req.rawBody;
    if (!raw?.length) {
      throw new BadRequestException('No webhook payload provided');
    }
    const event = this.stripeAccounts.constructEvent(key, raw, signature);
    return this.payouts.handleStripeEvent(event as any);
  }
}
