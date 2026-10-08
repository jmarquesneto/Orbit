import {
  InvalidCredentialsError,
  RateLimitedError,
  UnauthenticatedError,
} from '../src/shared/domain/errors.js';
import { buildHarness, ctx } from './support/harness.js';

describe('LoginUseCase', () => {
  it('autentica com a senha certa, zera falhas e abre sessão', async () => {
    const h = buildHarness();
    const seeded = h.users.seed({ email: 'ana@exemplo.com', failedLogins: 3 });

    const result = await h.login.execute(
      { email: '  ANA@exemplo.com ', password: 'senha-correta-123' },
      ctx,
    );
    if (result.kind !== 'session') throw new Error('esperava sessão');
    const { user, session } = result;

    expect(user.id).toBe(seeded.id);
    expect(user).not.toHaveProperty('passwordHash');
    expect(h.users.rows.get(seeded.id)?.failedLogins).toBe(0);
    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.audit.actions()).toContain('auth.login');
  });

  it('e-mail inexistente e senha errada dão o MESMO erro', async () => {
    const h = buildHarness();
    h.users.seed({ email: 'ana@exemplo.com' });
    const unknown = h.login.execute({ email: 'ninguem@exemplo.com', password: 'x' }, ctx);
    const wrong = h.login.execute({ email: 'ana@exemplo.com', password: 'errada' }, ctx);
    await expect(unknown).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(wrong).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('bloqueia após 5 senhas erradas, mesmo que a 6ª esteja certa', async () => {
    const h = buildHarness();
    const u = h.users.seed({ email: 'ana@exemplo.com' });
    for (let i = 0; i < 5; i++) {
      await expect(h.login.execute({ email: u.email, password: 'errada' }, ctx)).rejects.toThrow();
    }
    expect(h.users.rows.get(u.id)?.lockedUntil).not.toBeNull();
    await expect(
      h.login.execute({ email: u.email, password: 'senha-correta-123' }, ctx),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(h.audit.actions()).toContain('auth.login_blocked');

    h.clock.advance(16 * 60_000);
    await expect(h.login.execute({ email: u.email, password: 'senha-correta-123' }, ctx)).resolves.toBeDefined();
  });

  it('usuário bloqueado pelo admin não entra', async () => {
    const h = buildHarness();
    h.users.seed({ email: 'ana@exemplo.com', status: 'locked' });
    await expect(
      h.login.execute({ email: 'ana@exemplo.com', password: 'senha-correta-123' }, ctx),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('aplica limite de tentativas por e-mail', async () => {
    const h = buildHarness();
    h.users.seed({ email: 'ana@exemplo.com' });
    const attempts = Array.from({ length: 11 }, (_, i) =>
      h.login.execute({ email: 'ana@exemplo.com', password: `errada${i}` }, { ...ctx, ip: `10.0.0.${i}` }),
    );
    const results = await Promise.allSettled(attempts);
    const last = results.at(-1);
    expect(last?.status === 'rejected' && last.reason).toBeInstanceOf(RateLimitedError);
  });
});

describe('SessionService', () => {
  async function loggedIn() {
    const h = buildHarness();
    const user = h.users.seed({ email: 'ana@exemplo.com', role: 'admin' });
    const session = await h.sessions.issue(user, ctx);
    return { h, user, session };
  }

  it('authenticate devolve o usuário com o papel lido do BANCO', async () => {
    const { h, user, session } = await loggedIn();
    await h.users.updateStatus(user.id, 'active');
    h.users.rows.set(user.id, { ...user, role: 'user' }); // rebaixado depois do login
    const auth = await h.sessions.authenticate(session.accessToken);
    expect(auth).toMatchObject({ id: user.id, role: 'user', sessionId: session.sessionId });
  });

  it('token adulterado ou sessão revogada → não autenticado', async () => {
    const { h, session } = await loggedIn();
    await expect(h.sessions.authenticate('lixo')).rejects.toBeInstanceOf(UnauthenticatedError);
    await h.sessions.end(session.sessionId);
    await expect(h.sessions.authenticate(session.accessToken)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('bloquear o usuário derruba o acesso imediatamente', async () => {
    const { h, user, session } = await loggedIn();
    await h.users.updateStatus(user.id, 'locked');
    await expect(h.sessions.authenticate(session.accessToken)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rotate troca o refresh token e mantém a família', async () => {
    const { h, session } = await loggedIn();
    const next = await h.sessions.rotate(session.refreshToken, ctx);
    expect(next.refreshToken).not.toBe(session.refreshToken);
    expect(h.sessionsRepo.rows.get(session.sessionId)?.revokedAt).not.toBeNull();
    expect(h.sessionsRepo.rows.get(next.sessionId)?.familyId).toBe(
      h.sessionsRepo.rows.get(session.sessionId)?.familyId,
    );
  });

  it('reuso de refresh token derruba a família inteira', async () => {
    const { h, session } = await loggedIn();
    const next = await h.sessions.rotate(session.refreshToken, ctx);

    // Um atacante reapresenta o refresh antigo, já usado:
    await expect(h.sessions.rotate(session.refreshToken, ctx)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(h.audit.actions()).toContain('auth.refresh_reuse_detected');
    // ...e o token legítimo mais novo também deixa de valer.
    await expect(h.sessions.authenticate(next.accessToken)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(h.sessionsRepo.active()).toHaveLength(0);
  });

  it('refresh expirado ou malformado é recusado', async () => {
    const { h, session } = await loggedIn();
    await expect(h.sessions.rotate('nao-e-token', ctx)).rejects.toBeInstanceOf(UnauthenticatedError);
    h.clock.advance(8 * 24 * 3_600_000);
    await expect(h.sessions.rotate(session.refreshToken, ctx)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe('UsersAdminService', () => {
  it('bootstrapAdmin cria admin com senha forte aleatória', async () => {
    const h = buildHarness();
    const { user, password } = await h.usersAdmin.bootstrapAdmin(' Admin@Exemplo.com ');
    expect(user).toMatchObject({ email: 'admin@exemplo.com', role: 'admin' });
    expect(password).toHaveLength(43);
    await expect(h.usersAdmin.bootstrapAdmin('admin@exemplo.com')).rejects.toThrow(/Já existe/);
  });

  it('bloquear usuário revoga as sessões dele; admin não bloqueia a si mesmo', async () => {
    const h = buildHarness();
    const admin = h.users.seed({ email: 'admin@exemplo.com', role: 'admin' });
    const ana = h.users.seed({ email: 'ana@exemplo.com' });
    await h.sessions.issue(ana, ctx);

    await h.usersAdmin.setStatus(admin.id, ana.id, 'locked', ctx.ip);
    expect(h.sessionsRepo.active()).toHaveLength(0);
    await expect(h.usersAdmin.setStatus(admin.id, admin.id, 'locked', ctx.ip)).rejects.toThrow(/próprio/);
  });
});
