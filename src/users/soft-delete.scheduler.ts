import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UsersService } from './users.service';
import { SOFT_DELETE_RETENTION_DAYS } from '../common/soft-delete';

@Injectable()
export class SoftDeleteScheduler {
  private readonly logger = new Logger(SoftDeleteScheduler.name);

  constructor(private readonly usersService: UsersService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpiredSoftDeletes() {
    try {
      const result = await this.usersService.purgeExpiredSoftDeletes();
      if (result.users > 0 || result.orders > 0) {
        this.logger.log(
          `Soft-delete purge (${SOFT_DELETE_RETENTION_DAYS}d): removed ${result.users} user(s), ${result.orders} order(s)`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        'Soft-delete purge job failed',
        error?.stack || error,
      );
    }
  }
}
