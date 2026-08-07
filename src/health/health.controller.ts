import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  MemoryHealthIndicator,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { RedisCacheService } from '../redis/redis-cache.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongoose: MongooseHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly cache: RedisCacheService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Full health check (DB + memory + cache)' })
  check() {
    return this.health.check([
      () => this.mongoose.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
      () => this.checkCache(),
    ]);
  }

  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe (process up)' })
  live() {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (database reachable)' })
  ready() {
    return this.health.check([() => this.mongoose.pingCheck('database')]);
  }

  private async checkCache(): Promise<HealthIndicatorResult> {
    const result = await this.cache.healthPing();
    return {
      cache: {
        status: result.ok ? 'up' : 'down',
        mode: result.mode,
        redisConfigured: this.cache.isRedisConfigured,
        redisConnected: this.cache.isRedisConnected,
      },
    };
  }
}
