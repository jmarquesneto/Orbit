import {
  ConflictError,
  InvalidInvitationError,
  NotFoundError,
  ValidationError,
} from '../src/shared/domain/errors.js';
import { hashToken } from '../src/shared/domain/secure-token.js';
import { buildHarness, ctx } from './support/harness.js';

const STRONG = 'cavalo bateria grampo correto';

async function withInvite(ttlHours?: number) {
  const h = buildHarness();
  const admin = h.users.seed({ email: 'admin@exemplo.com', role: 'admin' });
  const created = await h.invitations.create(
    admin.id,
    { email: 'Convidado@Exemplo.com', role: 'user', ttlHours },
    ctx.ip,
  );
  const token = created.link.split('#')[1]!;
  return { h, admin, created, token };
}

describe('InvitationsService', () => {
  it('cria convite com token de 256 bits e guarda só o hash', async () => {
    const { h, created, token } = await withInvite();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.link).toBe(`http://localhost:3000/convite#${token}`);
    const stored = [...h.invitationsRepo.rows.values()][0]!;
    expect(stored.tokenHash.equals(hashToken(token))).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(created.invitation).toMatchObject({ email: 'convidado@exemplo.com', status: 'pending' });
  });

  it('usa a validade padrão da configuração (72 h)', async () => {
    const { h, created } = await withInvite();
    expect(created.invitation.expiresAt.getTime() - h.clock.now().getTime()).toBe(72 * 3_600_000);
  });

  it('não convida e-mail que já tem conta', async () => {
    const h = buildHarness();
    const admin = h.users.seed({ email: 'admin@exemplo.com', role: 'admin' });
    await expect(
      h.invitations.create(admin.id, { email: 'admin@exemplo.com', role: 'user' }, null),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('inspect mostra o e-mail travado do convite', async () => {
    const { h, token } = await withInvite();
    await expect(h.invitations.inspect(token, ctx)).resolves.toMatchObject({
      email: 'convidado@exemplo.com',
    });
  });

  it('accept cria o usuário, consome o convite e abre sessão — uma única vez', async () => {
    const { h, token } = await withInvite();
    const { user, session } = await h.invitations.accept(token, { name: 'Ana Souza', password: STRONG }, ctx);

    expect(user).toMatchObject({ email: 'convidado@exemplo.com', name: 'Ana Souza', role: 'user' });
    expect(await h.sessions.authenticate(session.accessToken)).toMatchObject({ id: user.id });
    expect([...h.invitationsRepo.rows.values()][0]?.usedBy).toBe(user.id);

    await expect(h.invitations.accept(token, { name: 'Ana Souza', password: STRONG }, ctx)).rejects.toBeInstanceOf(InvalidInvitationError);
  });

  it('senha fraca é recusada e o convite continua válido', async () => {
    const { h, token } = await withInvite();
    await expect(h.invitations.accept(token, { name: 'Ana Souza', password: 'curta' }, ctx)).rejects.toBeInstanceOf(ValidationError);
    await expect(h.invitations.accept(token, { name: 'Ana Souza', password: STRONG }, ctx)).resolves.toBeDefined();
  });

  it.each([
    ['expirado', async (h: ReturnType<typeof buildHarness>) => h.clock.advance(73 * 3_600_000)],
    [
      'revogado',
      async (h: ReturnType<typeof buildHarness>, id: string, adminId: string) =>
        void (await h.invitations.revoke(adminId, id, null)),
    ],
  ])('convite %s dá a resposta neutra', async (_label, spoil) => {
    const { h, admin, created, token } = await withInvite();
    await spoil(h, created.invitation.id, admin.id);
    await expect(h.invitations.inspect(token, ctx)).rejects.toBeInstanceOf(InvalidInvitationError);
    await expect(h.invitations.accept(token, { name: 'Ana Souza', password: STRONG }, ctx)).rejects.toBeInstanceOf(InvalidInvitationError);
  });

  it('token inexistente ou malformado dá a mesma resposta neutra', async () => {
    const { h } = await withInvite();
    await expect(h.invitations.inspect('A'.repeat(43), ctx)).rejects.toBeInstanceOf(InvalidInvitationError);
    await expect(h.invitations.inspect("' OR 1=1 --", ctx)).rejects.toBeInstanceOf(InvalidInvitationError);
  });
});

describe('SettingsService', () => {
  it('getBranding lê do banco e depois do cache', async () => {
    const h = buildHarness();
    await expect(h.settings.getBranding()).resolves.toEqual({
      name: 'Orbit',
      accent: '#3DD6C3',
      logoUrl: null,
    });
    h.settingsRepo.rows.delete('app.name'); // se ainda fosse ao banco, quebraria
    await expect(h.settings.getBranding()).resolves.toMatchObject({ name: 'Orbit' });
  });

  it('admin troca o nome: versiona, registra revisão, audita e limpa o cache', async () => {
    const h = buildHarness();
    await h.settings.getBranding();
    const view = await h.settings.update('admin-id', 'app.name', '  Finanças da Casa ', {
      ip: ctx.ip,
      reason: 'rebranding',
    });

    expect(view).toMatchObject({ key: 'app.name', value: 'Finanças da Casa', version: 2 });
    expect(h.settingsRepo.revisions[0]).toMatchObject({
      oldValue: 'Orbit',
      newValue: 'Finanças da Casa',
      changedBy: 'admin-id',
    });
    expect(h.audit.actions()).toContain('settings.update');
    expect(h.brandingCache.invalidations).toBe(1);
    await expect(h.settings.getBranding()).resolves.toMatchObject({ name: 'Finanças da Casa' });
  });

  it('rejeita payload de XSS sem gravar nada', async () => {
    const h = buildHarness();
    await expect(
      h.settings.update('admin-id', 'app.name', '<script>alert(1)</script>', { ip: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(h.settingsRepo.rows.get('app.name')?.value).toBe('Orbit');
    expect(h.audit.entries).toHaveLength(0);
  });

  it('chave desconhecida → não encontrada', async () => {
    const h = buildHarness();
    await expect(h.settings.update('admin-id', 'app.evil', 'x', { ip: null })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
