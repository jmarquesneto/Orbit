import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { isRlsViolation } from '../../src/infrastructure/database/pg-errors.js';
import { type Harness, startApp, type TestUser } from './app-harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startApp();
});
afterAll(() => h?.close());

async function setupOwner() {
  const owner = await h.newUser('dono');
  const api = h.as(owner);
  const budget = (await api.post('/budgets', { name: 'Casa' }).expect(201)).body.budget;
  const food = (
    await api.post(`/budgets/${budget.id}/categories`, { name: 'Mercado', kind: 'expense', plannedCents: 150_000 }).expect(201)
  ).body.category;
  const salary = (
    await api.post(`/budgets/${budget.id}/categories`, { name: 'Salário', kind: 'income' }).expect(201)
  ).body.category;
  const checking = (
    await api.post('/wallets', { type: 'checking', name: 'Conta', openingCents: 500_000 }).expect(201)
  ).body.wallet;
  const card = (
    await api
      .post('/wallets', {
        type: 'credit',
        name: 'Cartão',
        last4: '4242',
        card: { limitCents: 1_000_000, closingDay: 15, dueDay: 22, payFromWalletId: checking.id },
      })
      .expect(201)
  ).body.wallet;
  return { owner, api, budget, food, salary, checking, card };
}

const walletBalance = async (user: TestUser, id: string) =>
  (await h.as(user).get(`/wallets/${id}`).expect(200)).body.wallet.balanceCents as number;

describe('Orçamentos, categorias e lançamentos', () => {
  it('lançamento pago mexe no saldo; o resumo do mês bate planejado x realizado', async () => {
    const { owner, api, budget, food, salary, checking } = await setupOwner();

    await api
      .post(`/budgets/${budget.id}/transactions`, {
        walletId: checking.id, categoryId: salary.id, description: 'Salário', amountCents: 800_000,
        kind: 'income', dueDate: '2026-10-05', paid: true,
      })
      .expect(201);
    const groceries = (
      await api
        .post(`/budgets/${budget.id}/transactions`, {
          walletId: checking.id, categoryId: food.id, description: 'Feira', amountCents: 45_000,
          kind: 'expense', dueDate: '2026-10-10',
        })
        .expect(201)
    ).body.transaction;

    expect(await walletBalance(owner, checking.id)).toBe(500_000 + 800_000);

    await api.post(`/budgets/${budget.id}/transactions/${groceries.id}/payment`, { paid: true, version: 1 }).expect(200);
    expect(await walletBalance(owner, checking.id)).toBe(1_300_000 - 45_000);

    // Versão antiga → conflito (lock otimista), nada muda.
    await api.post(`/budgets/${budget.id}/transactions/${groceries.id}/payment`, { paid: false, version: 1 }).expect(409);
    expect(await walletBalance(owner, checking.id)).toBe(1_255_000);

    const summary = (await api.get(`/budgets/${budget.id}/summary?month=2026-10`).expect(200)).body.summary;
    expect(summary.totals).toEqual({
      incomeCents: 800_000, expenseCents: 45_000, balanceCents: 755_000, plannedExpenseCents: 150_000,
    });
    expect(summary.categories.find((c: { id: string }) => c.id === food.id)).toMatchObject({
      actualCents: 45_000, remainingCents: 105_000,
    });
  });

  it('categoria de receita não aceita despesa; campos extras são recusados', async () => {
    const { api, budget, salary, checking } = await setupOwner();
    await api
      .post(`/budgets/${budget.id}/transactions`, {
        walletId: checking.id, categoryId: salary.id, description: 'x', amountCents: 100, kind: 'expense', dueDate: '2026-10-01',
      })
      .expect(400);
    await api
      .post(`/budgets/${budget.id}/transactions`, {
        walletId: checking.id, description: 'x', amountCents: 100, kind: 'expense', dueDate: '2026-10-01', createdBy: 'outro',
      })
      .expect(400);
  });
});

describe('Cartão de crédito: parcelamento nas faturas futuras', () => {
  it('R$ 1.000,00 em 10x cria 10 transações, cada uma na fatura de um mês seguido', async () => {
    const { api, budget, food, card } = await setupOwner();
    const res = await api
      .post(`/wallets/${card.id}/purchases`, {
        budgetId: budget.id, categoryId: food.id, description: 'Geladeira', totalCents: 100_000,
        installments: 10, purchaseDate: '2026-11-20', idempotencyKey: randomUUID(),
      })
      .expect(201);

    expect(res.body.replayed).toBe(false);
    expect(res.body.installments).toHaveLength(10);
    expect(res.body.installments.map((i: { refMonth: string }) => i.refMonth)).toEqual([
      '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01',
      '2027-05-01', '2027-06-01', '2027-07-01', '2027-08-01', '2027-09-01',
    ]);
    expect(res.body.installments[0]).toMatchObject({ amountCents: 10_000, dueDate: '2026-12-22', status: 'open' });
    expect(res.body.installments[9]).toMatchObject({ status: 'provisioned' });

    const invoices = (await api.get(`/wallets/${card.id}/invoices`).expect(200)).body.invoices;
    expect(invoices).toHaveLength(10);
    expect(invoices.every((i: { totalCents: number }) => i.totalCents === 10_000)).toBe(true);

    const dec = (await api.get(`/wallets/${card.id}/invoices/2026-12`).expect(200)).body.invoice;
    expect(dec.transactions).toEqual([expect.objectContaining({ description: 'Geladeira (1/10)', installmentNo: 1 })]);
  });

  it('centavos que sobram vão para a primeira parcela e a soma fecha', async () => {
    const { api, budget, card } = await setupOwner();
    const res = await api
      .post(`/wallets/${card.id}/purchases`, {
        budgetId: budget.id, description: 'Curso', totalCents: 10_000, installments: 3,
        purchaseDate: '2026-10-01', idempotencyKey: randomUUID(),
      })
      .expect(201);
    expect(res.body.installments.map((i: { amountCents: number }) => i.amountCents)).toEqual([3_334, 3_333, 3_333]);
  });

  it('reenvio com a mesma chave (inclusive simultâneo) não duplica parcelas', async () => {
    const { api, budget, card } = await setupOwner();
    const body = {
      budgetId: budget.id, description: 'TV', totalCents: 300_000, installments: 3,
      purchaseDate: '2026-10-01', idempotencyKey: randomUUID(),
    };
    const [a, b] = await Promise.all([
      api.post(`/wallets/${card.id}/purchases`, body),
      api.post(`/wallets/${card.id}/purchases`, body),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.plan.id).toBe(b.body.plan.id);
    expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);

    const again = await api.post(`/wallets/${card.id}/purchases`, body).expect(201);
    expect(again.body.replayed).toBe(true);
    const invoices = (await api.get(`/wallets/${card.id}/invoices`).expect(200)).body.invoices;
    expect(invoices.map((i: { totalCents: number }) => i.totalCents)).toEqual([100_000, 100_000, 100_000]);
  });

  it('compra acima do limite disponível é recusada sem gravar nada', async () => {
    const { api, budget, card } = await setupOwner();
    await api
      .post(`/wallets/${card.id}/purchases`, {
        budgetId: budget.id, description: 'Carro', totalCents: 1_000_001, installments: 1,
        purchaseDate: '2026-10-01', idempotencyKey: randomUUID(),
      })
      .expect(409);
    expect((await api.get(`/wallets/${card.id}/invoices`).expect(200)).body.invoices).toHaveLength(0);
  });

  it('pagar a fatura debita a conta, quita as parcelas e trava novas compras naquele mês', async () => {
    const { owner, api, budget, card, checking } = await setupOwner();
    const purchase = (
      await api
        .post(`/wallets/${card.id}/purchases`, {
          budgetId: budget.id, description: 'Tênis', totalCents: 40_000, installments: 2,
          purchaseDate: '2026-10-01', idempotencyKey: randomUUID(),
        })
        .expect(201)
    ).body;

    const paid = (await api.post(`/wallets/${card.id}/invoices/2026-10/payment`).expect(200)).body.invoice;
    expect(paid).toMatchObject({ status: 'paid', paidCents: 20_000 });
    expect(await walletBalance(owner, checking.id)).toBe(500_000 - 20_000);
    await api.post(`/wallets/${card.id}/invoices/2026-10/payment`).expect(409);

    // Compra que cairia na fatura já paga → recusada.
    await api
      .post(`/wallets/${card.id}/purchases`, {
        budgetId: budget.id, description: 'Atrasada', totalCents: 1_000, installments: 1,
        purchaseDate: '2026-10-02', idempotencyKey: randomUUID(),
      })
      .expect(409);
    // Compra com parcela em fatura paga não pode ser cancelada.
    await api.delete(`/wallets/${card.id}/purchases/${purchase.plan.id}`).expect(409);
  });

  it('cancelar a compra remove as parcelas e devolve os valores às faturas', async () => {
    const { api, budget, card } = await setupOwner();
    const purchase = (
      await api
        .post(`/wallets/${card.id}/purchases`, {
          budgetId: budget.id, description: 'Sofá', totalCents: 60_000, installments: 3,
          purchaseDate: '2026-10-01', idempotencyKey: randomUUID(),
        })
        .expect(201)
    ).body;
    await api.delete(`/wallets/${card.id}/purchases/${purchase.plan.id}`).expect(204);
    const invoices = (await api.get(`/wallets/${card.id}/invoices`).expect(200)).body.invoices;
    expect(invoices.every((i: { totalCents: number }) => i.totalCents === 0)).toBe(true);
    const txs = (await api.get(`/budgets/${budget.id}/transactions`).expect(200)).body.transactions;
    expect(txs).toHaveLength(0);
  });
});

describe('Compartilhamento: permissão verificada em cada requisição', () => {
  it('sem compartilhamento, outra pessoa não vê nem descobre que o orçamento existe', async () => {
    const { budget, card } = await setupOwner();
    const stranger = h.as(await h.newUser('estranho'));
    await stranger.get(`/budgets/${budget.id}`).expect(404);
    await stranger.get(`/budgets/${budget.id}/transactions`).expect(404);
    await stranger.get(`/wallets/${card.id}`).expect(404);
    expect((await stranger.get('/budgets').expect(200)).body.budgets).toEqual([]);
  });

  it('papel "read" vê mas não altera; "create" lança com a PRÓPRIA carteira; só o dono exclui', async () => {
    const { api, budget, food, checking } = await setupOwner();
    const guestUser = await h.newUser('convidado');
    const guest = h.as(guestUser);

    const share = (
      await api.post('/shares', { resourceType: 'budget', resourceId: budget.id, email: guestUser.email, role: 'read' }).expect(201)
    ).body.share;
    expect((await guest.get('/budgets').expect(200)).body.budgets).toEqual([expect.objectContaining({ id: budget.id, role: 'read' })]);
    await guest.get(`/budgets/${budget.id}/summary?month=2026-10`).expect(200);
    await guest.patch(`/budgets/${budget.id}`, { name: 'Invadido' }).expect(403);

    const guestWallet = (await guest.post('/wallets', { type: 'cash', name: 'Carteira', openingCents: 10_000 }).expect(201)).body.wallet;
    const newTx = { walletId: guestWallet.id, categoryId: food.id, description: 'Pão', amountCents: 1_000, kind: 'expense', dueDate: '2026-10-03' };
    await guest.post(`/budgets/${budget.id}/transactions`, newTx).expect(403);

    // Troca de papel: revoga e compartilha de novo como "create".
    await api.delete(`/shares/${share.id}`).expect(204);
    await api.post('/shares', { resourceType: 'budget', resourceId: budget.id, email: guestUser.email, role: 'create' }).expect(201);

    const created = (await guest.post(`/budgets/${budget.id}/transactions`, newTx).expect(201)).body.transaction;
    // Não pode usar a carteira do dono, que para ele "não existe".
    await guest.post(`/budgets/${budget.id}/transactions`, { ...newTx, walletId: checking.id }).expect(404);
    // Excluir é só do dono.
    await guest.delete(`/budgets/${budget.id}/transactions/${created.id}`).expect(403);
    await api.delete(`/budgets/${budget.id}/transactions/${created.id}`).expect(204);
    // Compartilhar e arquivar também.
    await guest.post('/shares', { resourceType: 'budget', resourceId: budget.id, email: guestUser.email, role: 'read' }).expect(403);
    await guest.delete(`/budgets/${budget.id}`).expect(403);
  });

  it('o convidado pode sair; depois disso perde o acesso na hora', async () => {
    const { api, budget } = await setupOwner();
    const guestUser = await h.newUser('convidado');
    const guest = h.as(guestUser);
    const share = (
      await api.post('/shares', { resourceType: 'budget', resourceId: budget.id, email: guestUser.email, role: 'edit' }).expect(201)
    ).body.share;
    await guest.get(`/budgets/${budget.id}`).expect(200);
    await guest.delete(`/shares/${share.id}`).expect(204);
    await guest.get(`/budgets/${budget.id}`).expect(404);
  });

  it('compartilhar duas vezes com a mesma pessoa → conflito; com e-mail desconhecido → 404', async () => {
    const { api, budget } = await setupOwner();
    const guestUser = await h.newUser('convidado');
    const body = { resourceType: 'budget', resourceId: budget.id, email: guestUser.email, role: 'read' };
    await api.post('/shares', body).expect(201);
    await api.post('/shares', body).expect(409);
    await api.post('/shares', { ...body, email: 'ninguem@teste.local' }).expect(404);
  });
});

describe('Row-Level Security no próprio Postgres', () => {
  it('mesmo com SQL direto, o banco só devolve linhas do usuário da transação', async () => {
    const { owner, budget } = await setupOwner();
    const stranger = await h.newUser('estranho');
    const count = (userId?: string) =>
      (userId ? h.db.runAs.bind(h.db, userId) : h.db.run.bind(h.db))(async () => {
        const res = await h.db.db.execute(sql`SELECT count(*)::int AS n FROM budgets WHERE id = ${budget.id}`);
        return (res.rows[0] as { n: number }).n;
      });

    expect(await count(owner.id)).toBe(1);
    expect(await count(stranger.id)).toBe(0);
    expect(await count()).toBe(0); // sem usuário definido: nada é visível
  });

  it('o banco recusa gravar em orçamento alheio mesmo se a aplicação deixasse passar', async () => {
    const { budget } = await setupOwner();
    const stranger = await h.newUser('estranho');
    const attempt = h.db.runAs(stranger.id, () =>
      h.db.db.execute(
        sql`INSERT INTO categories (budget_id, name, kind) VALUES (${budget.id}, 'Hack', 'expense')`,
      ),
    );
    // SQLSTATE 42501: "new row violates row-level security policy"
    await expect(attempt).rejects.toSatisfy(isRlsViolation);
  });
});

describe('Caixinhas', () => {
  it('depósito tira da carteira, resgate devolve, e não dá para resgatar mais que o saldo', async () => {
    const owner = await h.newUser('poupador');
    const api = h.as(owner);
    const wallet = (await api.post('/wallets', { type: 'checking', name: 'Conta', openingCents: 100_000 }).expect(201)).body.wallet;
    const goal = (await api.post('/goals', { name: 'Viagem', targetCents: 200_000 }).expect(201)).body.goal;

    const dep = await api
      .post(`/goals/${goal.id}/movements`, { walletId: wallet.id, kind: 'deposit', amountCents: 50_000, occurredOn: '2026-10-08' })
      .expect(201);
    expect(dep.body.goal).toMatchObject({ balanceCents: 50_000, progressPercent: 25 });
    expect(await walletBalance(owner, wallet.id)).toBe(50_000);

    await api
      .post(`/goals/${goal.id}/movements`, { walletId: wallet.id, kind: 'withdraw', amountCents: 60_000, occurredOn: '2026-10-09' })
      .expect(409);
    await api
      .post(`/goals/${goal.id}/movements`, { walletId: wallet.id, kind: 'withdraw', amountCents: 20_000, occurredOn: '2026-10-09' })
      .expect(201);
    expect(await walletBalance(owner, wallet.id)).toBe(70_000);
    expect((await api.get(`/goals/${goal.id}/movements`).expect(200)).body.movements).toHaveLength(2);
  });

  it('caixinha compartilhada como "read" não aceita movimentação do convidado', async () => {
    const owner = await h.newUser('dono');
    const guestUser = await h.newUser('convidado');
    const goal = (await h.as(owner).post('/goals', { name: 'Reserva', targetCents: 100_000 }).expect(201)).body.goal;
    await h.as(owner).post('/shares', { resourceType: 'goal', resourceId: goal.id, email: guestUser.email, role: 'read' }).expect(201);
    const guestWallet = (await h.as(guestUser).post('/wallets', { type: 'cash', name: 'Bolso', openingCents: 5_000 }).expect(201)).body.wallet;

    await h.as(guestUser).get(`/goals/${goal.id}`).expect(200);
    await h
      .as(guestUser)
      .post(`/goals/${goal.id}/movements`, { walletId: guestWallet.id, kind: 'deposit', amountCents: 1_000, occurredOn: '2026-10-08' })
      .expect(403);
  });
});
