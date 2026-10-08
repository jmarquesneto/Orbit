import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  hashRecoveryCode,
  otpauthUri,
  stepAt,
  totpCode,
  verifyTotp,
} from './totp.js';

// Vetores oficiais da RFC 6238, apêndice B (segredo ASCII "12345678901234567890", 8 dígitos).
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('t=%i → %s', (t, code) => {
    expect(totpCode(RFC_SECRET, Math.floor(t / 30), 8)).toBe(code);
  });

  it('base32 ida e volta (formato dos apps autenticadores)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb oi').toString()).toBe('foobar');
  });

  it('aceita o código do passo atual e dos vizinhos (relógio ±30 s)', () => {
    const now = new Date('2026-10-08T12:00:10Z');
    const step = stepAt(now);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now, null)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now, null)).toBeNull();
  });

  it('recusa reaproveitar um código já usado (anti-replay)', () => {
    const now = new Date('2026-10-08T12:00:10Z');
    const step = stepAt(now);
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
  });

  it('recusa formato inválido', () => {
    const now = new Date();
    expect(verifyTotp(RFC_SECRET, '12345', now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now, null)).toBeNull();
  });

  it('URI otpauth com emissor e conta', () => {
    const uri = otpauthUri('Casa em Ordem', 'ana@exemplo.com', Buffer.from('foobar'));
    expect(uri).toMatch(/^otpauth:\/\/totp\/Casa%20em%20Ordem%3Aana%40exemplo\.com\?/);
    expect(uri).toContain('secret=MZXW6YTBOI');
    expect(uri).toContain('issuer=Casa+em+Ordem');
  });
});

describe('códigos de recuperação', () => {
  it('gera 10 códigos únicos no formato xxxxx-xxxxx', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/));
  });

  it('o hash ignora maiúsculas, espaços e hífen', () => {
    expect(hashRecoveryCode('ABCDE-FGHJK').equals(hashRecoveryCode(' abcde fghjk '))).toBe(true);
  });
});
