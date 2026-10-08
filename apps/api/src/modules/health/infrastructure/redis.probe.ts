import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../../infrastructure/cache/redis.module.js';
import type { DependencyProbe } from '../domain/dependency-probe.js';

@Injectable()
export class RedisProbe implements DependencyProbe {
  readonly name = 'cache';

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async check(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    const reply = await this.redis.ping();
    if (reply !== 'PONG') throw new Error('unexpected reply');
  }
}
