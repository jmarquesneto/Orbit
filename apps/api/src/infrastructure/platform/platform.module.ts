import { Global, Module } from '@nestjs/common';
import { CLOCK, type Clock, EPHEMERAL_STORE, RATE_LIMITER } from '../../shared/application/ports.js';
import { RedisEphemeralStore } from './redis-ephemeral-store.js';
import { RedisRateLimiter } from './redis-rate-limiter.js';

const systemClock: Clock = { now: () => new Date() };

/** Adaptadores transversais (relógio, rate limit) disponíveis para todos os módulos. */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useValue: systemClock },
    { provide: RATE_LIMITER, useClass: RedisRateLimiter },
    { provide: EPHEMERAL_STORE, useClass: RedisEphemeralStore },
  ],
  exports: [CLOCK, RATE_LIMITER, EPHEMERAL_STORE],
})
export class PlatformModule {}
