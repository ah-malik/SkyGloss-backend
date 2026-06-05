import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrdersService } from './orders.service';

@Injectable()
export class OrdersSchedulerService {
  private readonly logger = new Logger(OrdersSchedulerService.name);

  constructor(private readonly ordersService: OrdersService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handlePendingPaymentJobs() {
    try {
      const cancelled = await this.ordersService.cancelExpiredPendingPaymentOrders();
      const reminders = await this.ordersService.sendPendingPaymentReminders();
      if (cancelled > 0 || reminders > 0) {
        this.logger.log(
          `Pending payment jobs: ${cancelled} cancelled, ${reminders} reminders sent`,
        );
      }
    } catch (error) {
      this.logger.error('Pending payment scheduled job failed', error?.stack || error);
    }
  }
}
