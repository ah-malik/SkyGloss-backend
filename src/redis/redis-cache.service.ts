import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

type MemoryEntry = {
  value: string;
  expiresAt: number | null;
};

/**
 * Optional Redis-backed cache with in-memory fallback.
 * When Redis is unavailable / unset, all reads miss and writes stay local —
 * business logic is never blocked.
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly maxMemoryEntries = 500;

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis | null,
  ) {
    if (this.redis) {
      this.logger.log('Redis cache enabled');
    } else {
      loggerInMemory(this.logger);
    }
  }

  onModuleDestroy() {
    if (this.redis) {
      void this.redis.quit().catch(() => undefined);
    }
  }

  get isRedisConnected(): boolean {
    return !!this.redis && this.redis.status === 'ready';
  }

  /** True when REDIS_URL was provided (even if currently reconnecting). */
  get isRedisConfigured(): boolean {
    return !!this.redis;
  }

  /**
   * Lightweight ping for Terminus health checks.
   * Returns mode so monitors can see redis vs memory-fallback.
   */
  async healthPing(): Promise<{ mode: 'redis' | 'memory'; ok: boolean }> {
    if (!this.redis) {
      return { mode: 'memory', ok: true };
    }
    try {
      const pong = await this.redis.ping();
      return { mode: 'redis', ok: pong === 'PONG' };
    } catch {
      // Redis configured but down — app still works via memory fallback
      return { mode: 'memory', ok: true };
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.redis) {
        const raw = await this.redis.get(key);
        if (raw != null) {
          return JSON.parse(raw) as T;
        }
        return null;
      }
    } catch (err) {
      this.logger.warn(`Redis get failed for ${key}; using memory fallback`, err);
    }

    return this.memoryGet<T>(key);
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);

    try {
      if (this.redis) {
        if (ttlSeconds && ttlSeconds > 0) {
          await this.redis.set(key, payload, 'EX', ttlSeconds);
        } else {
          await this.redis.set(key, payload);
        }
        return;
      }
    } catch (err) {
      this.logger.warn(`Redis set failed for ${key}; using memory fallback`, err);
    }

    this.memorySet(key, payload, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    this.memory.delete(key);
    try {
      if (this.redis) {
        await this.redis.del(key);
      }
    } catch (err) {
      this.logger.warn(`Redis del failed for ${key}`, err);
    }
  }

  async delByPrefix(prefix: string): Promise<void> {
    for (const key of [...this.memory.keys()]) {
      if (key.startsWith(prefix)) {
        this.memory.delete(key);
      }
    }

    if (!this.redis) return;

    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.warn(`Redis delByPrefix failed for ${prefix}`, err);
    }
  }

  /**
   * Cache-aside helper: return cached value or compute, store, and return.
   * On any cache error, falls through to the factory so callers never fail.
   */
  async wrap<T>(
    key: string,
    ttlSeconds: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    try {
      const cached = await this.get<T>(key);
      if (cached !== null && cached !== undefined) {
        return cached;
      }
    } catch {
      // ignore and compute fresh
    }

    const fresh = await factory();

    try {
      await this.set(key, fresh, ttlSeconds);
    } catch {
      // ignore cache write failures
    }

    return fresh;
  }

  private memoryGet<T>(key: string): T | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt != null && Date.now() > entry.expiresAt) {
      this.memory.delete(key);
      return null;
    }
    try {
      return JSON.parse(entry.value) as T;
    } catch {
      this.memory.delete(key);
      return null;
    }
  }

  private memorySet(key: string, payload: string, ttlSeconds?: number): void {
    if (this.memory.size >= this.maxMemoryEntries) {
      const oldest = this.memory.keys().next().value;
      if (oldest != null) this.memory.delete(oldest);
    }
    this.memory.set(key, {
      value: payload,
      expiresAt:
        ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
  }
}

function loggerInMemory(logger: Logger) {
  logger.log(
    'Redis URL not configured or unavailable — using in-process memory cache fallback',
  );
}
