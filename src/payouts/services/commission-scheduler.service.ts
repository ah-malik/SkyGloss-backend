import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { CommissionsService } from './commissions.service';
import {
  getCommissionHoldDescription,
  useFrequentCommissionReleaseCron,
} from '../commission-hold.config';

@Injectable()
export class CommissionSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CommissionSchedulerService.name);

  constructor(
    private readonly commissionsService: CommissionsService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const frequent = useFrequentCommissionReleaseCron();
    const cronTime = frequent
      ? CronExpression.EVERY_MINUTE
      : CronExpression.EVERY_HOUR;

    const job = new CronJob(cronTime, () => {
      void this.releasePendingCommissions();
    });

    this.schedulerRegistry.addCronJob('commission-release', job);
    job.start();

    this.logger.log(
      `Commission hold: ${getCommissionHoldDescription()} · release cron: ${frequent ? 'every minute (dev)' : 'hourly (production)'}`,
    );
  }

  async releasePendingCommissions(): Promise<void> {
    try {
      await this.commissionsService.releaseAvailableCommissions();
    } catch (error) {
      this.logger.error('Commission release cron failed', error);
    }
  }
}
