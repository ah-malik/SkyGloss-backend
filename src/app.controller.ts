import { AppService } from './app.service';
import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }



  
  @Post('stripe/webhook')
  handleStripeWebhook(@Req() req: Request, @Res() res: Response) {

    const event = req.body;

    console.log('Stripe event:', event.type);

    if (event.type === 'payment_intent.succeeded') {
      console.log('Payment successful');
    }

    return res.status(200).send('Webhook received');
  }
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
