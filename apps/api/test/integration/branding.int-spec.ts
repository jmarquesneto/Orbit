import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Harness, startApp } from './app-harness.js';

let h: Harness;
let port: number;
beforeAll(async () => {
  h = await startApp();
  await h.app.listen(0, '127.0.0.1');
  port = (h.app.getHttpServer().address() as AddressInfo).port;
});
afterAll(() => h?.close());

/** Abre o SSE e entrega cada evento "branding" recebido. */
function openStream(onEvent: (data: { name: string; accent: string }) => void): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = get({ host: '127.0.0.1', port, path: '/api/branding/events' }, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (block.startsWith('event: branding')) onEvent(JSON.parse(block.split('data: ')[1]!));
        }
      });
      resolve(res);
    });
    req.on('error', reject);
  });
}

describe('Branding ao vivo (SSE)', () => {
  it('envia o estado atual e depois cada alteração salva pelo admin', async () => {
    const received: { name: string; accent: string }[] = [];
    const res = await openStream((b) => received.push(b));
    expect(res.headers['content-type']).toContain('text/event-stream');

    await vi.waitFor(() => expect(received).toHaveLength(1));
    const original = received[0]!.name;

    const admin = h.as(await h.newUser('adm', { role: 'admin' }));
    await admin.patch('/admin/settings/app.name', { value: 'Nome Novo' }).expect(200);
    await vi.waitFor(() => expect(received.at(-1)?.name).toBe('Nome Novo'));

    // configuração que não é de identidade não gera evento
    const before = received.length;
    await admin.patch('/admin/settings/invite.ttl_hours', { value: 12 }).expect(200);
    await admin.patch('/admin/settings/app.name', { value: original }).expect(200);
    await vi.waitFor(() => expect(received.at(-1)?.name).toBe(original));
    expect(received.length).toBe(before + 1);

    res.destroy();
  });
});
