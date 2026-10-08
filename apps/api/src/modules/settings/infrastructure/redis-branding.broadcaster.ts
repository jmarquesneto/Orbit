import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../../infrastructure/cache/redis.module.js';
import type { BrandingBroadcaster } from '../application/ports.js';
import { AppNameSchema, type Branding } from '../domain/setting-definitions.js';

const CHANNEL = 'events:branding';

/**
 * Pub/sub do Redis: a alteração feita em uma instância da API chega a todas. Uma única
 * conexão de inscrição por processo, repartida entre as abas conectadas por SSE.
 */
@Injectable()
export class RedisBrandingBroadcaster implements BrandingBroadcaster, OnModuleDestroy {
  private readonly logger = new Logger(RedisBrandingBroadcaster.name);
  private readonly listeners = new Set<(branding: Branding) => void>();
  private subscriber: Redis | null = null;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(branding: Branding): Promise<void> {
    await this.redis.publish(CHANNEL, JSON.stringify(branding));
  }

  subscribe(listener: (branding: Branding) => void): () => void {
    this.listeners.add(listener);
    this.ensureSubscriber();
    return () => this.listeners.delete(listener);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber && this.subscriber.status !== 'end') await this.subscriber.quit();
  }

  private ensureSubscriber(): void {
    if (this.subscriber) return;
    const sub = this.redis.duplicate({ connectionName: 'api-branding-sub' });
    this.subscriber = sub;
    sub.on('message', (channel: string, raw: string) => {
      if (channel !== CHANNEL) return;
      const branding = parse(raw);
      if (!branding) return;
      for (const listener of this.listeners) listener(branding);
    });
    sub.on('error', (err: Error) => this.logger.warn(`Canal de branding: ${err.message}`));
    sub.subscribe(CHANNEL).catch((err: Error) => this.logger.warn(`Inscrição no canal falhou: ${err.message}`));
  }
}

/** A mensagem vem do Redis: confere o formato antes de repassar ao navegador. */
function parse(raw: string): Branding | null {
  try {
    const v = JSON.parse(raw) as Partial<Branding>;
    if (!AppNameSchema.safeParse(v.name).success) return null;
    if (typeof v.accent !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(v.accent)) return null;
    if (v.logoUrl !== null && (typeof v.logoUrl !== 'string' || !v.logoUrl.startsWith('https://'))) return null;
    return { name: v.name!, accent: v.accent, logoUrl: v.logoUrl };
  } catch {
    return null;
  }
}
