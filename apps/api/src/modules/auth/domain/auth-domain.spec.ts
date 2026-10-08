import { checkPasswordPolicy } from './password-policy.js';
import { canAuthenticate, LOCKOUT_MINUTES, MAX_FAILED_LOGINS, registerFailedLogin } from './user.js';

const now = new Date('2026-10-08T12:00:00Z');

describe('registerFailedLogin', () => {
  it('incrementa o contador abaixo do limite', () => {
    expect(registerFailedLogin({ failedLogins: 0 }, now)).toEqual({ failedLogins: 1, lockedUntil: null });
  });

  it(`bloqueia por ${LOCKOUT_MINUTES} min na ${MAX_FAILED_LOGINS}ª tentativa e zera o contador`, () => {
    const next = registerFailedLogin({ failedLogins: MAX_FAILED_LOGINS - 1 }, now);
    expect(next.failedLogins).toBe(0);
    expect(next.lockedUntil?.getTime()).toBe(now.getTime() + LOCKOUT_MINUTES * 60_000);
  });
});

describe('canAuthenticate', () => {
  it('permite usuário ativo sem bloqueio', () => {
    expect(canAuthenticate({ status: 'active', lockedUntil: null }, now)).toBe(true);
  });
  it('nega usuário bloqueado pelo admin', () => {
    expect(canAuthenticate({ status: 'locked', lockedUntil: null }, now)).toBe(false);
  });
  it('nega durante o bloqueio temporário e libera depois', () => {
    const lockedUntil = new Date(now.getTime() + 60_000);
    expect(canAuthenticate({ status: 'active', lockedUntil }, now)).toBe(false);
    expect(canAuthenticate({ status: 'active', lockedUntil }, new Date(now.getTime() + 61_000))).toBe(true);
  });
});

describe('checkPasswordPolicy', () => {
  const email = 'maria.silva@exemplo.com';

  it('aceita uma frase-senha longa', () => {
    expect(checkPasswordPolicy('cavalo bateria grampo correto', email)).toEqual([]);
  });
  it('exige ao menos 12 caracteres', () => {
    expect(checkPasswordPolicy('Curta1!', email)).toContainEqual(expect.stringMatching(/12/));
  });
  it('rejeita caractere repetido', () => {
    expect(checkPasswordPolicy('aaaaaaaaaaaaaa', email).length).toBeGreaterThan(0);
  });
  it('rejeita senha que contém o e-mail', () => {
    expect(checkPasswordPolicy('MARIA.SILVA-2026!', email)).toContainEqual(expect.stringMatching(/e-mail/));
  });
});
