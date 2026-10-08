import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token opaco de 256 bits (convites e refresh tokens). Só o hash vai para o banco. */
export function generateSecureToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Formato esperado de um token gerado acima: 43 chars base64url. Barra lixo antes de ir ao banco. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
