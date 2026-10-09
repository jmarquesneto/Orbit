import { generateTemporaryPassword } from '../src/modules/auth/application/users-admin.service.js';
import { PersonNameSchema } from '../src/modules/auth/domain/user.js';
import { ForbiddenError, ValidationError } from '../src/shared/domain/errors.js';
import { buildHarness, ctx } from './support/harness.js';

const NEW = 'outra-senha-bem-forte-42';

async function signedIn(h: ReturnType<typeof buildHarness>, email = 'ana@exemplo.com') {
  const u = h.users.seed({ email });
  const issued = await h.sessions.issue(u, ctx);
  return { u, auth: await h.sessions.authenticate(issued.accessToken) };
}

describe('Minha conta', () => {
  it('nome: aceita acentos e recusa marcação', () => {
    expect(PersonNameSchema.parse('  Maria   da Conceição ')).toBe('Maria da Conceição');
    expect(PersonNameSchema.safeParse("D'Ávila-Souza").success).toBe(true);
    expect(PersonNameSchema.safeParse('<b>Ana</b>').success).toBe(false);
    expect(PersonNameSchema.safeParse('A').success).toBe(false);
  });

  it('troca o nome e audita', async () => {
    const h = buildHarness();
    const { u, auth } = await signedIn(h);
    const view = await h.account.updateName(auth, 'Ana Souza', null);
    expect(view.name).toBe('Ana Souza');
    expect(h.users.rows.get(u.id)?.name).toBe('Ana Souza');
    expect(h.audit.actions()).toContain('user.rename');
  });

  it('troca a senha com a atual certa e derruba as OUTRAS sessões', async () => {
    const h = buildHarness();
    const { u, auth } = await signedIn(h);
    const other = await h.sessions.issue(u, ctx);

    await h.account.changePassword(auth, { currentPassword: 'senha-correta-123', newPassword: NEW }, ctx);
    expect(h.users.rows.get(u.id)?.passwordHash).toBe(`hashed:${NEW}`);
    expect(h.sessionsRepo.rows.get(auth.sessionId)?.revokedAt).toBeNull();
    expect(h.sessionsRepo.rows.get(other.sessionId)?.revokedAt).not.toBeNull();
  });

  it('senha atual errada conta como tentativa de login; senha fraca ou igual é recusada', async () => {
    const h = buildHarness();
    const { u, auth } = await signedIn(h);
    await expect(h.account.changePassword(auth, { currentPassword: 'errada', newPassword: NEW }, ctx)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(h.users.rows.get(u.id)?.failedLogins).toBe(1);
    await expect(
      h.account.changePassword(auth, { currentPassword: 'senha-correta-123', newPassword: 'curta' }, ctx),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      h.account.changePassword(auth, { currentPassword: 'senha-correta-123', newPassword: 'senha-correta-123' }, ctx),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('Admin redefine a senha', () => {
  it('gera senha provisória, destrava, derruba sessões e exige troca', async () => {
    const h = buildHarness();
    const admin = h.users.seed({ email: 'adm@exemplo.com', role: 'admin' });
    const u = h.users.seed({ email: 'ana@exemplo.com', failedLogins: 3, lockedUntil: new Date('2030-01-01') });
    await h.sessions.issue(u, ctx);

    const { user, temporaryPassword } = await h.usersAdmin.resetPassword(admin.id, u.id, null);
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(user.mustChangePassword).toBe(true);
    expect(h.users.rows.get(u.id)).toMatchObject({ lockedUntil: null, failedLogins: 0, mustChangePassword: true });
    expect(h.sessionsRepo.active().filter((s) => s.userId === u.id)).toHaveLength(0);

    // entra com a provisória; a sessão vem marcada para trocar a senha
    const r = await h.login.execute({ email: u.email, password: temporaryPassword }, ctx);
    if (r.kind !== 'session') throw new Error('esperava sessão');
    const auth = await h.sessions.authenticate(r.session.accessToken);
    expect(auth.mustChangePassword).toBe(true);
    await h.account.changePassword(auth, { currentPassword: temporaryPassword, newPassword: NEW }, ctx);
    expect(h.users.rows.get(u.id)?.mustChangePassword).toBe(false);
  });

  it('não vale para a própria conta', async () => {
    const h = buildHarness();
    const admin = h.users.seed({ email: 'adm@exemplo.com', role: 'admin' });
    await expect(h.usersAdmin.resetPassword(admin.id, admin.id, null)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('senhas provisórias não se repetem', () => {
    expect(new Set(Array.from({ length: 50 }, generateTemporaryPassword)).size).toBe(50);
  });
});

describe('Primeiro administrador automático (NAS)', () => {
  it('cria com senha provisória só quando não há administrador', async () => {
    const h = buildHarness();
    const first = await h.usersAdmin.bootstrapFirstAdmin(' Dono@Casa.com ', 'Marina Alves');
    expect(first?.user).toMatchObject({ email: 'dono@casa.com', name: 'Marina Alves', role: 'admin', mustChangePassword: true });
    const r = await h.login.execute({ email: 'dono@casa.com', password: first!.temporaryPassword }, ctx);
    expect(r.kind).toBe('session');
    expect(await h.usersAdmin.bootstrapFirstAdmin('outro@casa.com')).toBeNull();
  });
});
