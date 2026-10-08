import { type Harness, startApp } from './app-harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startApp();
});
afterAll(() => h?.close());

async function wallet(api: ReturnType<Harness['as']>, name: string, openingCents: number) {
  return (await api.post('/wallets', { type: 'checking', name, openingCents }).expect(201)).body.wallet;
}
async function balanceOf(api: ReturnType<Harness['as']>, id: string): Promise<number> {
  return (await api.get(`/wallets/${id}`).expect(200)).body.wallet.balanceCents;
}

describe('Transferências entre contas', () => {
  it('move o saldo de uma conta para outra e desfaz', async () => {
    const u = await h.newUser('xfer');
    const api = h.as(u);
    const a = await wallet(api, 'Conta A', 100_000);
    const b = await wallet(api, 'Poupança', 5_000);

    const t = (
      await api
        .post('/transfers', { fromWalletId: a.id, toWalletId: b.id, amountCents: 30_000, occurredOn: '2026-10-08', description: 'Reserva' })
        .expect(201)
    ).body.transfer;
    expect(await balanceOf(api, a.id)).toBe(70_000);
    expect(await balanceOf(api, b.id)).toBe(35_000);

    const list = (await api.get(`/transfers?walletId=${b.id}`).expect(200)).body.transfers;
    expect(list.map((x: { id: string }) => x.id)).toEqual([t.id]);

    await api.delete(`/transfers/${t.id}`).expect(204);
    expect(await balanceOf(api, a.id)).toBe(100_000);
    expect(await balanceOf(api, b.id)).toBe(5_000);
    await api.delete(`/transfers/${t.id}`).expect(404);
  });

  it('recusa mesma carteira, cartão de crédito e carteira de outra pessoa', async () => {
    const u = await h.newUser('xfer');
    const other = await h.newUser('outro');
    const api = h.as(u);
    const a = await wallet(api, 'Conta', 10_000);
    const theirs = await wallet(h.as(other), 'Deles', 10_000);
    const card = (
      await api
        .post('/wallets', { type: 'credit', name: 'Cartão', card: { limitCents: 100_000, closingDay: 1, dueDay: 10 } })
        .expect(201)
    ).body.wallet;
    const body = (to: string) => ({ fromWalletId: a.id, toWalletId: to, amountCents: 1_000, occurredOn: '2026-10-08' });

    await api.post('/transfers', body(a.id)).expect(400);
    await api.post('/transfers', body(card.id)).expect(400);
    await api.post('/transfers', body(theirs.id)).expect(404);
    expect(await balanceOf(api, a.id)).toBe(10_000);
    expect(await balanceOf(h.as(other), theirs.id)).toBe(10_000);

    // a outra pessoa não vê nem apaga transferências alheias
    const t = (await api.post('/transfers', { ...body(a.id), toWalletId: (await wallet(api, 'B', 0)).id }).expect(201)).body.transfer;
    expect((await h.as(other).get('/transfers').expect(200)).body.transfers).toEqual([]);
    await h.as(other).delete(`/transfers/${t.id}`).expect(404);
  });
});
