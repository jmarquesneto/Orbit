import { base32Decode, stepAt, totpCode } from '../src/modules/auth/domain/totp.js';
import { MFA_REAUTH_WINDOW_MS } from '../src/modules/auth/domain/user.js';
import {
  ConflictError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidMfaCodeError,
} from '../src/shared/domain/errors.js';
import { buildHarness, ctx } from './support/harness.js';

type Harness = ReturnType<typeof buildHarness>;

const PASSWORD = 'senha-correta-123';

/** Código atual do app autenticador para o segredo em base32. */
function codeFor(h: Harness, secretB32: string, offsetSteps = 0): string {
  return totpCode(base32Decode(secretB32), stepAt(h.clock.now()) + offsetSteps);
}

async function authOf(h: Harness, userId: string) {
  const user = h.users.rows.get(userId)!;
  const issued = await h.sessions.issue(user, ctx);
  return h.sessions.authenticate(issued.accessToken);
}

/** Cadastra o MFA de ponta a ponta e devolve segredo + códigos de recuperação. */
async function enroll(h: Harness, userId: string) {
  const auth = await authOf(h, userId);
  const setup = await h.mfa.startEnrollment(auth);
  const { recoveryCodes } = await h.mfa.confirmEnrollment(auth, codeFor(h, setup.secret), ctx.ip);
  h.clock.advance(30_000); // o mesmo código não vale duas vezes
  return { secret: setup.secret, recoveryCodes, setup };
}

async function passwordStep(h: Harness, email: string) {
  const r = await h.login.execute({ email, password: PASSWORD }, ctx);
  if (r.kind !== 'mfa') throw new Error('esperava desafio de MFA');
  return r.challenge;
}

describe('MFA — cadastro', () => {
  it('gera QR com o nome vindo das configurações e só ativa após um código válido', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    const auth = await authOf(h, u.id);

    const setup = await h.mfa.startEnrollment(auth);
    expect(setup.otpauthUri).toContain('issuer=Orbit');
    expect(setup.qrCode).toMatch(/^data:/);
    expect(h.users.rows.get(u.id)?.mfaEnabled).toBe(false);

    await expect(h.mfa.confirmEnrollment(auth, '000000', ctx.ip)).rejects.toBeInstanceOf(InvalidMfaCodeError);

    const { recoveryCodes } = await h.mfa.confirmEnrollment(auth, codeFor(h, setup.secret), ctx.ip);
    const stored = h.users.rows.get(u.id)!;
    expect(stored.mfaEnabled).toBe(true);
    expect(stored.mfaSecret?.equals(base32Decode(setup.secret))).toBe(false); // gravado cifrado
    expect(recoveryCodes).toHaveLength(10);
    expect(await h.recoveryRepo.countUnused(u.id)).toBe(10);
    expect(h.sessionsRepo.rows.get(auth.sessionId)?.mfaVerifiedAt).not.toBeNull();
    expect(h.audit.actions()).toContain('mfa.enable');
  });

  it('não deixa cadastrar de novo por cima de um MFA ativo', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    await enroll(h, u.id);
    await expect(h.mfa.startEnrollment(await authOf(h, u.id))).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('MFA — login', () => {
  it('senha certa sem MFA abre sessão direto; com MFA devolve desafio', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    expect((await h.login.execute({ email: u.email, password: PASSWORD }, ctx)).kind).toBe('session');

    await enroll(h, u.id);
    const before = h.sessionsRepo.active().length;
    const r = await h.login.execute({ email: u.email, password: PASSWORD }, ctx);
    expect(r.kind).toBe('mfa');
    expect(h.sessionsRepo.active().length).toBe(before); // nenhuma sessão até o código
  });

  it('troca desafio + código pela sessão, já com MFA confirmado', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    const { secret } = await enroll(h, u.id);
    const challenge = await passwordStep(h, u.email);

    const { user, session } = await h.mfa.completeLogin(challenge, codeFor(h, secret), ctx);
    expect(user.id).toBe(u.id);
    expect(h.sessionsRepo.rows.get(session.sessionId)?.mfaVerifiedAt).not.toBeNull();
    // desafio é de uso único
    await expect(h.mfa.completeLogin(challenge, codeFor(h, secret), ctx)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('o mesmo código TOTP não pode ser reutilizado', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    const { secret } = await enroll(h, u.id);
    const code = codeFor(h, secret);
    await h.mfa.completeLogin(await passwordStep(h, u.email), code, ctx);
    await expect(h.mfa.completeLogin(await passwordStep(h, u.email), code, ctx)).rejects.toBeInstanceOf(
      InvalidMfaCodeError,
    );
  });

  it('código de recuperação funciona uma única vez', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    const { recoveryCodes } = await enroll(h, u.id);
    const code = recoveryCodes[0]!.toUpperCase();

    await h.mfa.completeLogin(await passwordStep(h, u.email), code, ctx);
    expect(await h.recoveryRepo.countUnused(u.id)).toBe(9);
    await expect(h.mfa.completeLogin(await passwordStep(h, u.email), code, ctx)).rejects.toBeInstanceOf(
      InvalidMfaCodeError,
    );
  });

  it('5 códigos errados bloqueiam a conta como senhas erradas', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    const { secret } = await enroll(h, u.id);
    const challenge = await passwordStep(h, u.email);
    for (let i = 0; i < 5; i++) {
      await expect(h.mfa.completeLogin(challenge, '000000', ctx)).rejects.toBeInstanceOf(InvalidMfaCodeError);
    }
    expect(h.users.rows.get(u.id)?.lockedUntil).not.toBeNull();
    // desafio descartado e conta bloqueada: nem o código certo entra
    await expect(h.mfa.completeLogin(challenge, codeFor(h, secret), ctx)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('desafio expirado não vale', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    const { secret } = await enroll(h, u.id);
    const challenge = await passwordStep(h, u.email);
    h.store.rows.clear(); // TTL do Redis venceu
    await expect(h.mfa.completeLogin(challenge, codeFor(h, secret), ctx)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });
});

describe('MFA — reconfirmação, desativação e reset', () => {
  it('reauth marca a sessão como confirmada agora', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    const { secret } = await enroll(h, u.id);
    const auth = await authOf(h, u.id);
    expect(auth.mfaVerifiedAt).toBeNull();
    await h.mfa.reauthenticate(auth, codeFor(h, secret), ctx.ip);
    const verified = h.sessionsRepo.rows.get(auth.sessionId)?.mfaVerifiedAt;
    expect(verified?.getTime()).toBe(h.clock.now().getTime());
    expect(MFA_REAUTH_WINDOW_MS).toBe(5 * 60_000);
  });

  it('não desativa quando a instalação exige MFA', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    const { secret } = await enroll(h, u.id);
    await expect(h.mfa.disable(await authOf(h, u.id), codeFor(h, secret), ctx.ip)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('desativa com código quando a política permite (cache invalidado ao mudar a configuração)', async () => {
    const h = buildHarness();
    const admin = h.users.seed({ email: 'adm@exemplo.com', role: 'admin' });
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    const { secret } = await enroll(h, u.id);
    expect(await h.mfa.isRequired()).toBe(true);
    await h.settings.update(admin.id, 'security.mfa_required', false, { ip: null });
    expect(await h.mfa.isRequired()).toBe(false);

    await h.mfa.disable(await authOf(h, u.id), codeFor(h, secret), ctx.ip);
    expect(h.users.rows.get(u.id)?.mfaEnabled).toBe(false);
    expect(await h.recoveryRepo.countUnused(u.id)).toBe(0);
  });

  it('reset pelo admin desliga o MFA e derruba as sessões; não vale para si mesmo', async () => {
    const h = buildHarness();
    const admin = h.users.seed({ email: 'adm@exemplo.com', role: 'admin' });
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    await enroll(h, u.id);
    await authOf(h, u.id);

    await expect(h.mfa.adminReset(admin.id, admin.id, null)).rejects.toBeInstanceOf(ForbiddenError);
    const view = await h.mfa.adminReset(admin.id, u.id, null);
    expect(view.mfaEnabled).toBe(false);
    expect(h.sessionsRepo.active().filter((s) => s.userId === u.id)).toHaveLength(0);
    expect(h.audit.actions()).toContain('mfa.admin_reset');
  });

  it('regenera os códigos de recuperação e invalida os antigos', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    const { secret, recoveryCodes } = await enroll(h, u.id);
    const { recoveryCodes: fresh } = await h.mfa.regenerateRecoveryCodes(
      await authOf(h, u.id),
      codeFor(h, secret),
      ctx.ip,
    );
    expect(fresh).toHaveLength(10);
    await expect(h.mfa.completeLogin(await passwordStep(h, u.email), recoveryCodes[0]!, ctx)).rejects.toBeInstanceOf(
      InvalidMfaCodeError,
    );
  });
});
