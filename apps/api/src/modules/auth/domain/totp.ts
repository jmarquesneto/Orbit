import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) — o mesmo algoritmo do Google Authenticator, Authy, 1Password etc.:
 * HMAC-SHA1, passos de 30 s, 6 dígitos. Implementado aqui (poucas linhas, vetores oficiais
 * nos testes) para não depender de biblioteca de terceiros num ponto tão sensível.
 */
export const TOTP_PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Aceita o passo anterior e o seguinte para tolerar relógios ±30 s fora. */
const WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 bits, o tamanho recomendado pela RFC 4226 para HMAC-SHA1. */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

export function stepAt(date: Date): number {
  return Math.floor(date.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(secret: Buffer, step: number, digits = DIGITS, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac(algorithm, secret).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Confere o código dentro da janela de tolerância. Devolve o passo que casou (para gravar
 * como "último usado") ou null. Passos já usados (≤ lastStep) são recusados: um código
 * interceptado não pode ser reaproveitado.
 */
export function verifyTotp(secret: Buffer, code: string, now: Date, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(now);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const step = current + delta;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** URI que os apps autenticadores leem do QR code. */
export function otpauthUri(issuer: string, account: string, secret: Buffer): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ------------------------------------------------------- códigos de recuperação

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // sem 0/o, 1/l/i

/** Formato "xxxxx-xxxxx" (≈ 50 bits cada): fácil de digitar, impossível de adivinhar. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashRecoveryCode(code: string): Buffer {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest();
}

export function looksLikeRecoveryCode(code: string): boolean {
  return normalizeRecoveryCode(code).length === 10;
}
