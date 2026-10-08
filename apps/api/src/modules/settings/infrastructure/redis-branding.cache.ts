import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../../infrastructure/cache/redis.module.js';
import type { Branding } from '../domain/setting-definitions.js';
import type { BrandingCache } from '../application/ports.js';

const KEY = 'cache:branding';
const TTL_SECONDS = 300;

/** Cache é otimização: se o Redis falhar, a leitura cai para o banco em vez de quebrar a tela. */
@Injectable()
export class RedisBrandingCache implements BrandingCache {
  private readonly logger = new Logger(RedisBrandingCache.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async get(): Promise<Branding | null> {
    try {
      const raw = await this.redis.get(KEY);
      return raw ? (JSON.parse(raw) as Branding) : null;
    } catch {
      this.logger.warn('Cache de branding indisponível; lendo do banco.');
      return null;
    }
  }

  async set(branding: Branding): Promise<void> {
    try {
      await this.redis.set(KEY, JSON.stringify(branding), 'EX', TTL_SECONDS);
    } catch {
      this.logger.warn('Não foi possível gravar o cache de branding.');
    }
  }

  async invalidate(): Promise<void> {
    await this.redis.del(KEY);
  }
}
