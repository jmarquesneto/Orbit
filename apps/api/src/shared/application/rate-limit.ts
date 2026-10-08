import { RateLimitedError } from '../domain/errors.js';
import type { RateLimiter } from './ports.js';

/** Consome todas as janelas; lança se qualquer uma estourar. */
export async function enforceRateLimits(
  limiter: RateLimiter,
  rules: { key: string; limit: number; windowSeconds: number }[],
): Promise<void> {
  for (const rule of rules) {
    const result = await limiter.consume(rule.key, rule.limit, rule.windowSeconds);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }
}
