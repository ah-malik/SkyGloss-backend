import { AppService } from './app.service';
import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }


  @Get('register/shop')
shop(@Res() res) {
  res.send(`
    <style>
    button.inline-flex.items-center.justify-center.gap-2.whitespace-nowrap.rounded-md.font-medium.disabled\:pointer-events-none.disabled\:opacity-50.\[\&_svg\]\:pointer-events-none.\[\&_svg\:not\(\[class\*\=\'size-\'\]\)\]\:size-4.\[\&_svg\]\:shrink-0.outline-none.focus-visible\:border-ring.focus-visible\:ring-ring\/50.focus-visible\:ring-\[3px\].aria-invalid\:ring-destructive\/20.dark\:aria-invalid\:ring-destructive\/40.aria-invalid\:border-destructive.bg-background.dark\:bg-input\/30.dark\:border-input.dark\:hover\:bg-input\/50.px-4.py-2.has-\[\>svg\]\:px-3.flex-\[1\.5\].h-14.text-lg.border-2.border-slate-300.text-white.hover\:bg-\[\#0EA0DC\]\/10.shadow-sm.transition-all.duration-300.hover\:text-\[\#0EA0DC\] {
        display: none !important;
      }    </style>
  `);
}
  
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
