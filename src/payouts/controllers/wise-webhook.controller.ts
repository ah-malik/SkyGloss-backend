import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { RawBodyRequest } from '@nestjs/common';
import {
  WiseWebhookEvent,
  WiseWebhookEventDocument,
} from '../entities/wise-webhook-event.entity';
import { WithdrawalsService } from '../services/withdrawals.service';
import { verifyWiseWebhookSignature } from '../wise-webhook-verify';

@Controller('webhooks')
export class WiseWebhookController {
  constructor(
    @InjectModel(WiseWebhookEvent.name)
    private eventModel: Model<WiseWebhookEventDocument>,
    private withdrawalsService: WithdrawalsService,
    private config: ConfigService,
  ) {}

  @Post('wise')
  async handleWise(
    @Req() req: RawBodyRequest<{ body?: any; rawBody?: Buffer }>,
    @Headers('x-signature-sha256') signature?: string,
    @Headers('x-delivery-id') deliveryId?: string,
    @Headers('x-test-notification') testNotification?: string,
  ) {
    const raw = req.rawBody;
    if (!raw?.length) {
      throw new BadRequestException('Missing webhook body');
    }
    const apiUrl = this.config.get<string>('WISE_API_URL');
    if (!verifyWiseWebhookSignature(raw, signature, apiUrl)) {
      throw new UnauthorizedException('Invalid Wise webhook signature');
    }
    if (testNotification === 'true') {
      return { received: true, test: true };
    }

    const payload = req.body || JSON.parse(raw.toString('utf8'));
    const eventId = deliveryId || payload?.subscription_id + payload?.sent_at;
    if (!eventId) {
      throw new BadRequestException('Missing webhook event id');
    }

    const existing = await this.eventModel.findOne({ eventId });
    if (existing) {
      return { received: true, duplicate: true };
    }

    const eventType = payload?.event_type || payload?.eventType;
    const transferId = this.extractTransferId(payload);
    await this.eventModel.create({
      eventId,
      eventType,
      wiseTransferId: transferId,
      payload,
      processedAt: new Date(),
    });

    const state =
      payload?.data?.current_state ||
      payload?.data?.currentState ||
      payload?.data?.resource?.state ||
      payload?.data?.status;
    if (transferId && state) {
      await this.withdrawalsService.applyWiseTransferState(transferId, state);
    }

    return { received: true };
  }

  private extractTransferId(payload: any): string | undefined {
    const data = payload?.data || {};
    const resource = data.resource || {};
    const id =
      resource.id ||
      data.transfer_id ||
      data.transferId ||
      resource.transfer_id;
    return id ? String(id) : undefined;
  }
}
