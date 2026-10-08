import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { EphemeralStore } from '../../shared/application/ports.js';
import { REDIS } from '../cache/redis.module.js';

@Injectable()
export class RedisEphemeralStore implements EphemeralStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`tmp:${key}`, value, 'EX', ttlSeconds);
  }

  get(key: string): Promise<string | null> {
    return this.redis.get(`tmp:${key}`);
  }

  take(key: string): Promise<string | null> {
    return this.redis.getdel(`tmp:${key}`);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(`tmp:${key}`);
  }
}
