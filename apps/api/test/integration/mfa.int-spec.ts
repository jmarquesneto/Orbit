import { sql } from 'drizzle-orm';
import request from 'supertest';
import { base32Decode, stepAt, totpCode } from '../../src/modules/auth/domain/totp.js';
import { type Harness, startApp } from './app-harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startApp();
});
afterAll(() => h?.close());

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'uma-senha-bem-longa-123';

/** Navegador simulado: guarda os cookies e manda o Origin certo (CSRF). */
function browser() {
  const agent = request.agent(h.app.getHttpServer());
  const withOrigin = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set('Origin', ORIGIN);
  return {
    get: (url: string) => withOrigin(agent.get(`/api${url}`)),
    post: (url: string, body: object = {}) => withOrigin(agent.post(`/api${url}`)).send(body),
    patch: (url: string, body: object) => withOrigin(agent.patch(`/api${url}`)).send(body),
  };
}

const code = (secret: Buffer, offset = 0) => totpCode(secret, stepAt(new Date()) + offset);

describe('MFA de ponta a ponta', () => {
  it('obriga o cadastro, depois pede o código em todo login', async () => {
    const u = await h.newUser('mfa', { mfa: false, password: PASSWORD });
    const b = browser();

    // 1º login: sem MFA ainda → entra, mas só pode cadastrar o app
    const first = await b.post('/auth/login', { email: u.email, password: PASSWORD }).expect(200);
    expect(first.body.user.mfaEnabled).toBe(false);
    const me = await b.get('/auth/me').expect(200);
    expect(me.body).toMatchObject({ mfaEnabled: false, mfaRequired: true });
    expect((await b.get('/wallets').expect(403)).body.error.code).toBe('mfa_setup_required');

    // cadastro: QR + segredo; código errado não ativa
    const setup = (await b.post('/auth/mfa/setup').expect(200)).body;
    expect(setup.qrCode).toMatch(/^data:image\/svg\+xml/);
    const secret = base32Decode(setup.secret);
    await b.post('/auth/mfa/enable', { code: '000000' }).expect(400);
    const enabled = (await b.post('/auth/mfa/enable', { code: code(secret) }).expect(200)).body;
    expect(enabled.recoveryCodes).toHaveLength(10);
    await b.get('/wallets').expect(200);

    // 2º login: senha certa só devolve o desafio, sem cookies de sessão
    const b2 = browser();
    const step1 = await b2.post('/auth/login', { email: u.email, password: PASSWORD }).expect(200);
    expect(step1.body).toEqual({ mfaRequired: true, challenge: expect.any(String) });
    expect(step1.headers['set-cookie']).toBeUndefined();
    await b2.get('/auth/me').expect(401);

    await b2.post('/auth/mfa/verify', { challenge: step1.body.challenge, code: '111111' }).expect(400);
    await b2.post('/auth/mfa/verify', { challenge: step1.body.challenge, code: code(secret, 1) }).expect(200);
    expect((await b2.get('/auth/me').expect(200)).body.mfaEnabled).toBe(true);

    // código de recuperação também entra (uma vez)
    const b3 = browser();
    const step = (await b3.post('/auth/login', { email: u.email, password: PASSWORD }).expect(200)).body;
    await b3.post('/auth/mfa/verify', { challenge: step.challenge, code: enabled.recoveryCodes[0] }).expect(200);
    expect((await b3.get('/auth/mfa').expect(200)).body.recoveryCodesLeft).toBe(9);
  });

  it('ação sensível de admin pede o código de novo depois de 5 minutos', async () => {
    const admin = await h.newUser('adm', { role: 'admin' });
    const api = h.as(admin);
    // acabou de confirmar: passa
    await api.patch('/admin/settings/invite.ttl_hours', { value: 48 }).expect(200);

    // confirmação de 6 minutos atrás → precisa reconfirmar
    await h.db.run(() =>
      h.db.db.execute(
        sql`UPDATE sessions SET mfa_verified_at = now() - interval '6 minutes' WHERE id = ${admin.sessionId}`,
      ),
    );
    const denied = await api.patch('/admin/settings/invite.ttl_hours', { value: 24 }).expect(403);
    expect(denied.body.error.code).toBe('mfa_reauth_required');
    await api.post('/admin/invitations', { email: 'x@teste.local' }).expect(403);

    await api.post('/auth/mfa/reauth', { code: code(admin.mfaSecret!) }).expect(204);
    await api.patch('/admin/settings/invite.ttl_hours', { value: 24 }).expect(200);
  });

  it('admin redefine o MFA de outra pessoa e as sessões dela caem', async () => {
    const admin = await h.newUser('adm', { role: 'admin' });
    const victim = await h.newUser('perdeu-celular');
    await h.as(victim).get('/wallets').expect(200);
    const res = await h.as(admin).post(`/admin/users/${victim.id}/mfa/reset`).expect(200);
    expect(res.body.user.mfaEnabled).toBe(false);
    await h.as(victim).get('/wallets').expect(401);
  });
});
