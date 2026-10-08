import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { RateLimiter, RateLimitResult } from '../../shared/application/ports.js';
import { REDIS } from '../cache/redis.module.js';

/** Janela fixa por chave: INCR + EXPIRE NX numa única ida ao Redis (atômico). */
@Injectable()
export class RedisRateLimiter implements RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    const replies = await this.redis
      .multi()
      .incr(redisKey)
      .expire(redisKey, windowSeconds, 'NX')
      .ttl(redisKey)
      .exec();
    const count = Number(replies?.[0]?.[1] ?? 0);
    const ttl = Number(replies?.[2]?.[1] ?? windowSeconds);
    return { allowed: count <= limit, retryAfterSeconds: Math.max(ttl, 1) };
  }
}
