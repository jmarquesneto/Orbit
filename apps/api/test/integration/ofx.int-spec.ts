import { readFileSync } from 'node:fs';
import { type Harness, startApp } from './app-harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startApp();
});
afterAll(() => h?.close());

const extrato = {
  name: 'extrato_itau_2026-10.ofx',
  bytes: readFileSync(new URL('../fixtures/extrato-sgml.ofx', import.meta.url)),
};

type Entry = { id: string; fitid: string; match: string; resolution: string; amountCents: number; transactionId: string | null; suggestion: { description: string } | null };
const byFitid = (entries: Entry[], fitid: string, nth = 0) => entries.filter((e) => e.fitid === fitid)[nth]!;

async function scenario() {
  const user = await h.newUser('ofx');
  const api = h.as(user);
  const budget = (await api.post('/budgets', { name: 'Casa' }).expect(201)).body.budget;
  const tarifas = (await api.post(`/budgets/${budget.id}/categories`, { name: 'Tarifas', kind: 'expense' }).expect(201)).body.category;
  const wallet = (await api.post('/wallets', { type: 'checking', name: 'Conta Itaú', openingCents: 0 }).expect(201)).body.wallet;
  const lancar = (description: string, amountCents: number, dueDate: string) =>
    api
      .post(`/budgets/${budget.id}/transactions`, { walletId: wallet.id, description, amountCents, kind: 'expense', dueDate })
      .expect(201)
      .then((r) => r.body.transaction);
  const seguro = await lancar('Seguro do carro', 31_240, '2026-10-02');
  const mercado = await lancar('Mercado · semana 1', 48_000, '2026-10-04');
  return { user, api, budget, tarifas, wallet, seguro, mercado };
}

const balance = async (api: ReturnType<Harness['as']>, id: string) =>
  (await api.get(`/wallets/${id}`).expect(200)).body.wallet.balanceCents as number;

describe('OFX: JSON padronizado', () => {
  it('POST /ofx/parse devolve o extrato normalizado sem gravar nada', async () => {
    const api = h.as(await h.newUser('parse'));
    const res = await api.upload('/ofx/parse', extrato).expect(200);
    expect(res.body.statement).toMatchObject({ kind: 'bank', accountMask: '6789', currency: 'BRL' });
    expect(res.body.statement.transactions).toHaveLength(5);
    expect((await api.get('/ofx/imports').expect(200)).body.imports).toEqual([]);
  });

  it('recusa extensão errada e arquivo que não é OFX', async () => {
    const api = h.as(await h.newUser('parse'));
    await api.upload('/ofx/parse', { name: 'planilha.csv', bytes: Buffer.from('a,b') }).expect(400);
    await api.upload('/ofx/parse', { name: 'falso.ofx', bytes: Buffer.from('nada aqui') }).expect(400);
  });
});

describe('OFX: conciliação', () => {
  it('casa automático, sugere, aponta novos e duplicados; cada decisão ajusta o saldo', async () => {
    const { api, budget, tarifas, wallet, seguro, mercado } = await scenario();

    const imp = (await api.upload('/ofx/imports', extrato, { walletId: wallet.id }).expect(201)).body;
    const e = (fitid: string, nth = 0) => byFitid(imp.entries, fitid, nth);
    expect(e('2026100201')).toMatchObject({ match: 'auto', resolution: 'linked', transactionId: seguro.id });
    expect(e('2026100401')).toMatchObject({ match: 'suggest', resolution: 'pending', suggestion: { description: 'Mercado · semana 1' } });
    expect(e('2026100601')).toMatchObject({ match: 'new', resolution: 'pending' });
    expect(e('2026100301')).toMatchObject({ match: 'new' });
    expect(e('2026100201', 1)).toMatchObject({ match: 'dup', resolution: 'ignored' });
    expect(imp.import.ledgerBalanceCents).toBe(481_233);
    // A correspondência automática já pagou o seguro.
    expect(await balance(api, wallet.id)).toBe(-31_240);

    // Confirmar a sugestão: o valor do banco (486,72) prevalece sobre o previsto (480,00).
    let view = (await api.post(`/ofx/imports/${imp.import.id}/entries/${e('2026100401').id}/confirm`).expect(200)).body;
    expect(await balance(api, wallet.id)).toBe(-31_240 - 48_672);
    const mercadoDepois = (await api.get(`/budgets/${budget.id}/transactions`).expect(200)).body.transactions.find(
      (t: { id: string }) => t.id === mercado.id,
    );
    expect(mercadoDepois).toMatchObject({ status: 'paid', amountCents: 48_672, ofxFitid: '2026100401' });

    // Criar lançamento a partir da tarifa; ignorar o PIX recebido.
    view = (
      await api
        .post(`/ofx/imports/${imp.import.id}/entries/${e('2026100601').id}/create`, { budgetId: budget.id, categoryId: tarifas.id })
        .expect(200)
    ).body;
    view = (await api.post(`/ofx/imports/${imp.import.id}/entries/${e('2026100301').id}/ignore`).expect(200)).body;
    expect(view.counts).toEqual({ linked: 3, suggest: 0, new: 0, other: 2 });
    expect(await balance(api, wallet.id)).toBe(-31_240 - 48_672 - 3_990);

    // Desfazer a criação: o lançamento some e o saldo volta.
    view = (await api.post(`/ofx/imports/${imp.import.id}/entries/${e('2026100601').id}/undo`).expect(200)).body;
    expect(byFitid(view.entries, '2026100601')).toMatchObject({ resolution: 'pending', transactionId: null });
    expect(await balance(api, wallet.id)).toBe(-31_240 - 48_672);

    // Resolver de novo a mesma linha sem desfazer → conflito.
    await api.post(`/ofx/imports/${imp.import.id}/entries/${e('2026100401').id}/confirm`).expect(409);
    await api.post(`/ofx/imports/${imp.import.id}/complete`).expect(200);
  });

  it('o mesmo arquivo não entra duas vezes na mesma conta', async () => {
    const { api, wallet } = await scenario();
    await api.upload('/ofx/imports', extrato, { walletId: wallet.id }).expect(201);
    await api.upload('/ofx/imports', extrato, { walletId: wallet.id }).expect(409);
  });

  it('outra pessoa não vê a importação nem importa na conta alheia', async () => {
    const { api, wallet } = await scenario();
    const imp = (await api.upload('/ofx/imports', extrato, { walletId: wallet.id }).expect(201)).body;
    const stranger = h.as(await h.newUser('estranho'));
    await stranger.get(`/ofx/imports/${imp.import.id}`).expect(404);
    await stranger.post(`/ofx/imports/${imp.import.id}/entries/${imp.entries[0].id}/ignore`).expect(404);
    await stranger.upload('/ofx/imports', { ...extrato, name: 'outro.ofx' }, { walletId: wallet.id }).expect(404);
  });
});
