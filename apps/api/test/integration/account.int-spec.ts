import request from 'supertest';
import { type Harness, startApp } from './app-harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startApp();
});
afterAll(() => h?.close());

describe('Convite, nome e senha', () => {
  it('o link do convite usa o endereço que o admin está usando (ex.: porta 3010)', async () => {
    const admin = await h.newUser('adm', { role: 'admin' });
    const server = h.app.getHttpServer();
    const res = await request(server)
      .post('/api/admin/invitations')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Origin', 'http://localhost:3010')
      .set('X-Forwarded-Host', 'localhost:3010')
      .send({ email: `convidado-${Date.now()}@teste.local`, name: 'Ana Souza' })
      .expect(201);
    expect(res.body.link).toMatch(/^http:\/\/localhost:3010\/convite#/);
    expect(res.body.invitation.name).toBe('Ana Souza');

    // o convidado vê o nome sugerido e confirma ao aceitar
    const token = res.body.link.split('#')[1];
    const inspect = await request(server).post('/api/invitations/inspect').send({ token }).expect(200);
    expect(inspect.body.name).toBe('Ana Souza');
    const accepted = await request(server)
      .post('/api/invitations/accept')
      .send({ token, name: 'Ana Souza Lima', password: 'uma-frase-longa-de-senha' })
      .expect(201);
    expect(accepted.body.user.name).toBe('Ana Souza Lima');
  });

  it('usuário troca o nome e a senha; admin gera senha provisória que obriga a troca', async () => {
    const admin = await h.newUser('adm', { role: 'admin' });
    const u = await h.newUser('pessoa', { password: 'senha-original-bem-longa' });
    const api = h.as(u);

    await api.patch('/auth/me', { name: '<script>' }).expect(400);
    await api.patch('/auth/me', { name: 'Marina Alves' }).expect(200);
    expect((await api.get('/auth/me').expect(200)).body.name).toBe('Marina Alves');

    await api.post('/auth/password', { currentPassword: 'errada', newPassword: 'nova-senha-bem-longa-1' }).expect(400);
    await api
      .post('/auth/password', { currentPassword: 'senha-original-bem-longa', newPassword: 'nova-senha-bem-longa-1' })
      .expect(204);

    const reset = await h.as(admin).post(`/admin/users/${u.id}/password/reset`).expect(200);
    const temporary: string = reset.body.temporaryPassword;
    expect(reset.body.user.mustChangePassword).toBe(true);
    await api.get('/wallets').expect(401); // sessões antigas caíram

    // login com a provisória (+ MFA) → só pode trocar a senha
    const agent = request.agent(h.app.getHttpServer());
    const step = await agent.post('/api/auth/login').set('Origin', 'http://localhost:3000').send({ email: u.email, password: temporary }).expect(200);
    expect(step.body.mfaRequired).toBe(true);
  });
});
