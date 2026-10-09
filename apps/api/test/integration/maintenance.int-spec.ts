import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { addDays, todayIso } from '../../src/shared/domain/calendar.js';
import { type Harness, startApp } from './app-harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startApp();
});
afterAll(() => h?.close());

const today = () => todayIso(new Date());

async function scenario() {
  const owner = await h.newUser('dono');
  const api = h.as(owner);
  const budget = (await api.post('/budgets', { name: 'Casa' }).expect(201)).body.budget;
  const conta = (await api.post('/wallets', { type: 'checking', name: 'Conta', openingCents: 100_000 }).expect(201)).body.wallet;
  const cartao = (
    await api
      .post('/wallets', { type: 'credit', name: 'Cartão', card: { limitCents: 500_000, closingDay: 1, dueDay: 10 } })
      .expect(201)
  ).body.wallet;
  const eq = (
    await api
      .post('/maintenance/equipment', { budgetId: budget.id, name: 'Máquina de lavar', location: 'Lavanderia', manualUrl: 'https://exemplo.com/manual.pdf' })
      .expect(201)
  ).body.equipment;
  return { owner, api, budget, conta, cartao, eq };
}

describe('Manutenção residencial', () => {
  it('cadastra, aparece atrasada, conclui com custo e recalcula pela data real', async () => {
    const { owner, api, budget, conta, eq } = await scenario();
    const task = (
      await api
        .post(`/maintenance/equipment/${eq.id}/tasks`, { name: 'Limpeza do filtro', frequency: 'monthly', assigneeId: owner.id, firstDueOn: addDays(today(), -4) })
        .expect(201)
    ).body.task;

    let overview = (await api.get(`/maintenance/overview?budgetId=${budget.id}`).expect(200)).body;
    expect(overview.kpis).toMatchObject({ overdue: 1, oldestOverdueDays: 4 });
    expect(overview.tasks[0]).toMatchObject({ name: 'Limpeza do filtro', state: 'overdue', canComplete: true });

    const key = randomUUID();
    const done = (
      await api
        .post(`/maintenance/tasks/${task.id}/complete`, {
          completedOn: today(),
          version: task.version,
          idempotencyKey: key,
          cost: { amountCents: 12_000, walletId: conta.id, budgetId: budget.id },
        })
        .expect(200)
    ).body;
    const expectedNext = (() => {
      const [y, m, d] = today().split('-').map(Number) as [number, number, number];
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
      return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
    })();
    expect(done.nextDueOn).toBe(expectedNext);
    expect(done.log).toMatchObject({ taskName: 'Limpeza do filtro', costCents: 12_000, dueOn: addDays(today(), -4) });

    // despesa paga na categoria Manutenção, saldo descontado
    expect((await api.get(`/wallets/${conta.id}`).expect(200)).body.wallet.balanceCents).toBe(88_000);
    const cats = (await api.get(`/budgets/${budget.id}/categories`).expect(200)).body.categories;
    const manut = cats.find((c: { name: string }) => c.name === 'Manutenção');
    expect(manut).toBeDefined();
    const txs = (await api.get(`/budgets/${budget.id}/transactions`).expect(200)).body.transactions;
    expect(txs).toEqual(
      expect.arrayContaining([expect.objectContaining({ categoryId: manut.id, amountCents: 12_000, status: 'paid' })]),
    );

    // clique duplo: mesma chave devolve a mesma conclusão, sem cobrar de novo
    const again = (
      await api
        .post(`/maintenance/tasks/${task.id}/complete`, {
          completedOn: today(),
          version: task.version,
          idempotencyKey: key,
          cost: { amountCents: 12_000, walletId: conta.id, budgetId: budget.id },
        })
        .expect(200)
    ).body;
    expect(again.replayed).toBe(true);
    expect((await api.get(`/wallets/${conta.id}`).expect(200)).body.wallet.balanceCents).toBe(88_000);

    // versão antiga (outra pessoa já concluiu) → conflito
    await api
      .post(`/maintenance/tasks/${task.id}/complete`, { completedOn: today(), version: task.version, idempotencyKey: randomUUID() })
      .expect(409);

    overview = (await api.get(`/maintenance/overview?budgetId=${budget.id}`).expect(200)).body;
    expect(overview.kpis).toMatchObject({ overdue: 0, doneThisMonth: 1, costThisMonthCents: 12_000 });
    expect(overview.recentDone).toHaveLength(1);

    const detail = (await api.get(`/maintenance/equipment/${eq.id}`).expect(200)).body;
    expect(detail.totals).toMatchObject({ activeTasks: 1, logCount: 1, costCents: 12_000 });
    expect(detail.logs[0].completedBy.id).toBe(owner.id);
  });

  it('custo no cartão vira compra na fatura; tarefa única encerra', async () => {
    const { owner, api, budget, cartao, eq } = await scenario();
    const task = (
      await api
        .post(`/maintenance/equipment/${eq.id}/tasks`, { name: 'Instalar suporte', frequency: 'once', assigneeId: owner.id, firstDueOn: today() })
        .expect(201)
    ).body.task;
    const done = (
      await api
        .post(`/maintenance/tasks/${task.id}/complete`, {
          completedOn: today(),
          version: task.version,
          idempotencyKey: randomUUID(),
          cost: { amountCents: 25_000, walletId: cartao.id, budgetId: budget.id },
        })
        .expect(200)
    ).body;
    expect(done.nextDueOn).toBeNull();
    expect(done.log.costCents).toBe(25_000);
    const invoices = (await api.get(`/wallets/${cartao.id}/invoices`).expect(200)).body.invoices;
    expect(invoices.reduce((s: number, i: { totalCents: number }) => s + i.totalCents, 0)).toBe(25_000);
    expect((await api.get(`/maintenance/equipment/${eq.id}`).expect(200)).body.tasks).toHaveLength(0);
  });

  it('permissões herdadas do orçamento e responsável precisa ter acesso', async () => {
    const { owner, api, budget, eq } = await scenario();
    const leitor = await h.newUser('leitor');
    const editor = await h.newUser('editor');
    const estranho = await h.newUser('estranho');
    await api.post('/shares', { resourceType: 'budget', resourceId: budget.id, email: leitor.email, role: 'read' }).expect(201);
    await api.post('/shares', { resourceType: 'budget', resourceId: budget.id, email: editor.email, role: 'edit' }).expect(201);

    await api
      .post(`/maintenance/equipment/${eq.id}/tasks`, { name: 'X', frequency: 'weekly', assigneeId: estranho.id, firstDueOn: today() })
      .expect(400);
    const task = (
      await api
        .post(`/maintenance/equipment/${eq.id}/tasks`, { name: 'Limpar', frequency: 'weekly', assigneeId: editor.id, firstDueOn: today() })
        .expect(201)
    ).body.task;

    const members = (await h.as(leitor).get(`/maintenance/members?budgetId=${budget.id}`).expect(200)).body.members;
    expect(members.map((m: { id: string }) => m.id).sort()).toEqual([owner.id, leitor.id, editor.id].sort());

    // leitura vê, mas não conclui nem cadastra
    expect((await h.as(leitor).get(`/maintenance/equipment/${eq.id}`).expect(200)).body.tasks).toHaveLength(1);
    await h.as(leitor).post(`/maintenance/tasks/${task.id}/complete`, { completedOn: today(), version: 1, idempotencyKey: randomUUID() }).expect(403);
    await h.as(leitor).post('/maintenance/equipment', { budgetId: budget.id, name: 'Coifa', location: 'Cozinha' }).expect(403);
    // edição conclui
    await h.as(editor).post(`/maintenance/tasks/${task.id}/complete`, { completedOn: today(), version: 1, idempotencyKey: randomUUID() }).expect(200);
    // quem não tem acesso não vê nada
    await h.as(estranho).get(`/maintenance/equipment/${eq.id}`).expect(404);
    expect((await h.as(estranho).get('/maintenance/overview').expect(200)).body.tasks).toEqual([]);
  });

  it('valida link https, data futura e o histórico não pode ser alterado', async () => {
    const { owner, api, budget, eq } = await scenario();
    await api.post('/maintenance/equipment', { budgetId: budget.id, name: 'TV', location: 'Sala', manualUrl: 'javascript:alert(1)' }).expect(400);
    const task = (
      await api
        .post(`/maintenance/equipment/${eq.id}/tasks`, { name: 'Filtro', frequency: 'monthly', assigneeId: owner.id, firstDueOn: today() })
        .expect(201)
    ).body.task;
    await api
      .post(`/maintenance/tasks/${task.id}/complete`, { completedOn: addDays(today(), 2), version: 1, idempotencyKey: randomUUID() })
      .expect(400);
    await api.post(`/maintenance/tasks/${task.id}/complete`, { completedOn: today(), version: 1, idempotencyKey: randomUUID() }).expect(200);

    // O papel da API não tem política de UPDATE/DELETE no histórico: nada é alterado,
    // nem em nome do próprio dono (e um gatilho barra até quem contorne o RLS).
    const tamper = await h.db.runAs(owner.id, () =>
      h.db.db.execute(sql`UPDATE maintenance_logs SET task_name = 'adulterado' WHERE equipment_id = ${eq.id}`),
    );
    const remove = await h.db.runAs(owner.id, () =>
      h.db.db.execute(sql`DELETE FROM maintenance_logs WHERE equipment_id = ${eq.id}`),
    );
    expect([tamper.rowCount, remove.rowCount]).toEqual([0, 0]);
    const logs = (await api.get(`/maintenance/equipment/${eq.id}`).expect(200)).body.logs;
    expect(logs.map((l: { taskName: string }) => l.taskName)).toEqual(['Filtro']);
  });
});

describe('Manutenção: gatilho do histórico (mesmo sem RLS)', () => {
  it('bloqueia UPDATE/DELETE para o dono do schema; só aceita desligar a despesa excluída', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_MIGRATOR_USER,
      password: process.env.DB_MIGRATOR_PASSWORD,
    });
    try {
      const { owner, api, budget, conta, eq } = await scenario();
      const task = (
        await api
          .post(`/maintenance/equipment/${eq.id}/tasks`, { name: 'Filtro', frequency: 'monthly', assigneeId: owner.id, firstDueOn: today() })
          .expect(201)
      ).body.task;
      await api
        .post(`/maintenance/tasks/${task.id}/complete`, {
          completedOn: today(),
          version: 1,
          idempotencyKey: randomUUID(),
          cost: { amountCents: 5_000, walletId: conta.id, budgetId: budget.id },
        })
        .expect(200);

      await expect(pool.query(`UPDATE maintenance_logs SET task_name = 'x' WHERE equipment_id = $1`, [eq.id])).rejects.toThrow(
        /somente inserção/,
      );
      await expect(pool.query(`DELETE FROM maintenance_logs WHERE equipment_id = $1`, [eq.id])).rejects.toThrow(/somente inserção/);

      // Excluir a despesa ligada é permitido: o registro continua, só sem o vínculo.
      const { rows } = await pool.query(`SELECT transaction_id FROM maintenance_logs WHERE equipment_id = $1`, [eq.id]);
      await pool.query(`DELETE FROM transactions WHERE id = $1`, [rows[0].transaction_id]);
      const after = await pool.query(`SELECT task_name, transaction_id FROM maintenance_logs WHERE equipment_id = $1`, [eq.id]);
      expect(after.rows).toEqual([{ task_name: 'Filtro', transaction_id: null }]);
    } finally {
      await pool.end();
    }
  });
});
