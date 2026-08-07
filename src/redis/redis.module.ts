import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { RedisCacheService } from './redis-cache.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis | null => {
        const logger = new Logger('RedisModule');
        const redisUrl =
          configService.get<string>('REDIS_URL') ||
          configService.get<string>('REDIS_URI');

        if (!redisUrl) {
          logger.warn(
            'REDIS_URL not set — cache will use in-memory fallback (app continues normally)',
          );
          return null;
        }

        try {
          const client = new Redis(redisUrl, {
            maxRetriesPerRequest: 1,
            enableReadyCheck: true,
            enableOfflineQueue: false,
            lazyConnect: false,
            // Never crash the Nest process if Redis is down
            retryStrategy: (times) => {
              if (times > 10) return null;
              return Math.min(times * 200, 2000);
            },
          });

          client.on('error', (err) => {
            logger.warn(`Redis connection error: ${err.message}`);
          });
          client.on('connect', () => {
            logger.log('Redis connected');
          });

          return client;
        } catch (err) {
          logger.warn(`Failed to create Redis client: ${err}`);
          return null;
        }
      },
    },
    RedisCacheService,
  ],
  exports: [RedisCacheService, REDIS_CLIENT],
})
export class RedisModule {}
