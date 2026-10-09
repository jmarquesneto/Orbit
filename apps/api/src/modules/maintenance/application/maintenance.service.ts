import { Inject, Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../../infrastructure/database/pg-errors.js';
import {
  AUDIT_LOG,
  type AuditLog,
  CLOCK,
  type Clock,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import { addDays, daysBetween, type IsoDate, todayIso } from '../../../shared/domain/calendar.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { USER_REPOSITORY, type UserRepository } from '../../auth/application/ports.js';
import { BudgetsService } from '../../budgets/application/budgets.service.js';
import { AccessControlService } from '../../sharing/application/access-control.service.js';
import type { AccessGrant } from '../../sharing/domain/permissions.js';
import { CardPurchasesService } from '../../transactions/application/card-purchases.service.js';
import { TransactionsService } from '../../transactions/application/transactions.service.js';
import { WalletsService } from '../../wallets/application/wallets.service.js';
import {
  type DueState,
  dueState,
  type EquipmentRecord,
  type Frequency,
  FREQUENCY_LABEL,
  type LogRecord,
  nextDueDate,
  type TaskRecord,
} from '../domain/maintenance.js';
import { type LogRow, MAINTENANCE_REPOSITORY, type MaintenanceRepository, type Member, type TaskRow } from './ports.js';

/** Categoria de despesa onde caem os custos (criada no orçamento na primeira vez). */
export const MAINTENANCE_CATEGORY = 'Manutenção';
const HISTORY_DAYS_BACK = 366;

export interface Person {
  id: string;
  name: string;
}

export interface TaskView {
  id: string;
  name: string;
  frequency: Frequency;
  frequencyLabel: string;
  equipment: { id: string; name: string; location: string };
  budgetId: string;
  assignee: Person;
  nextDueOn: IsoDate | null;
  lastDoneOn: IsoDate | null;
  state: DueState | null;
  daysUntil: number | null;
  version: number;
  canComplete: boolean;
  canEdit: boolean;
}

export interface LogView {
  id: number;
  taskId: string;
  taskName: string;
  frequencyLabel: string;
  equipment: { id: string; name: string; location: string };
  completedBy: Person;
  completedOn: IsoDate;
  dueOn: IsoDate | null;
  nextDueOn: IsoDate | null;
  costCents: number | null;
  note: string | null;
}

export interface CompleteInput {
  completedOn: IsoDate;
  version: number;
  idempotencyKey: string;
  note?: string | null;
  cost?: { amountCents: number; walletId: string; budgetId: string } | null;
}

/**
 * Manutenção residencial (MER-Manutenção). Tudo roda sob RLS em nome de quem pediu, e o
 * equipamento herda as permissões do orçamento: Leitura vê; Edição conclui e edita
 * tarefas; Criação cadastra equipamentos e tarefas; arquivar equipamento é de quem pode
 * excluir no orçamento (o dono).
 */
@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(MAINTENANCE_REPOSITORY) private readonly repo: MaintenanceRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
    private readonly budgets: BudgetsService,
    private readonly wallets: WalletsService,
    private readonly transactions: TransactionsService,
    private readonly cardPurchases: CardPurchasesService,
  ) {}

  // ------------------------------------------------------------ painel

  /** Dashboard: tarefas abertas, concluídas nos últimos 7 dias e os números do mês. */
  overview(actorId: string, filter: { assignee?: string; budgetId?: string }) {
    return this.tx.runAs(actorId, async () => {
      if (filter.budgetId) await this.access.require(actorId, 'budget', filter.budgetId, 'read');
      const assigneeId = filter.assignee === 'me' ? actorId : filter.assignee;
      const today = this.today();
      const monthStart = `${today.slice(0, 8)}01`;

      const all = await this.repo.listActiveTasks({ budgetId: filter.budgetId });
      const tasks = assigneeId ? all.filter((t) => t.assigneeId === assigneeId) : all;
      const recent = await this.repo.listLogs({
        budgetId: filter.budgetId,
        assigneeId,
        from: addDays(today, -7),
        limit: 50,
      });
      const month = await this.repo.listLogs({ budgetId: filter.budgetId, assigneeId, from: monthStart, limit: 1000 });

      const names = await this.names([...all.map((t) => t.assigneeId), ...recent.map((l) => l.completedBy), actorId]);
      const grants = await this.grants(actorId, all.map((t) => t.budgetId));
      const views = tasks.map((t) => this.taskView(t, today, names, grants.get(t.budgetId)));
      const overdue = views.filter((t) => t.state === 'overdue');

      // Filtro "Responsável": quem aparece nas tarefas, mais você.
      const assignees = [...new Set([actorId, ...all.map((t) => t.assigneeId)])].map((id) => this.person(id, names));

      return {
        today,
        kpis: {
          overdue: overdue.length,
          oldestOverdueDays: overdue.reduce((m, t) => Math.max(m, -(t.daysUntil ?? 0)), 0),
          next7: views.filter((t) => t.state === 'week').length,
          next7Until: addDays(today, 7),
          doneThisMonth: month.length,
          costThisMonthCents: month.reduce((s, l) => s + (l.costCents ?? 0), 0),
        },
        tasks: views,
        recentDone: recent.map((l) => this.logView(l, names)),
        assignees,
      };
    });
  }

  // ------------------------------------------------------------ equipamentos

  listEquipment(actorId: string, budgetId?: string) {
    return this.tx.runAs(actorId, async () => {
      if (budgetId) await this.access.require(actorId, 'budget', budgetId, 'read');
      const today = this.today();
      return (await this.repo.listEquipment({ budgetId })).map((e) => ({
        id: e.id,
        budgetId: e.budgetId,
        name: e.name,
        location: e.location,
        manualUrl: e.manualUrl,
        activeTasks: e.activeTasks,
        nextDueOn: e.nextDueOn,
        nextState: e.nextDueOn ? dueState(e.nextDueOn, today) : null,
      }));
    });
  }

  /** Detalhe: tarefas, histórico permanente, pessoas que podem ser responsáveis e totais. */
  getEquipment(actorId: string, id: string) {
    return this.tx.runAs(actorId, async () => {
      const eq = await this.mustFindEquipment(id);
      const grant = await this.access.require(actorId, 'budget', eq.budgetId, 'read');
      const today = this.today();
      const tasks = await this.repo.listActiveTasks({ equipmentId: id });
      const logs = await this.repo.listLogs({ equipmentId: id, limit: 500 });
      const members = await this.repo.listMembers(eq.budgetId, this.clock.now());
      const names = await this.names([...tasks.map((t) => t.assigneeId), ...logs.map((l) => l.completedBy)]);
      for (const m of members) names.set(m.id, displayName(m));
      return {
        today,
        equipment: this.equipmentView(eq),
        permissions: grant.can,
        members: members.map((m) => ({ id: m.id, name: displayName(m) })),
        tasks: tasks.map((t) => this.taskView(t, today, names, grant)),
        logs: logs.map((l) => this.logView(l, names)),
        totals: {
          activeTasks: tasks.length,
          logCount: logs.length,
          costCents: logs.reduce((s, l) => s + (l.costCents ?? 0), 0),
        },
      };
    });
  }

  createEquipment(
    actorId: string,
    input: { budgetId: string; name: string; location: string; manualUrl?: string | null },
    ip: string | null,
  ) {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', input.budgetId, 'create');
      const created = await this.repo.createEquipment({
        budgetId: input.budgetId,
        name: input.name,
        location: input.location,
        manualUrl: input.manualUrl ?? null,
        createdBy: actorId,
      });
      await this.audit.record({ actorId, action: 'equipment.create', entityType: 'equipment', entityId: created.id, ip });
      return this.equipmentView(created);
    });
  }

  updateEquipment(
    actorId: string,
    id: string,
    patch: { name?: string; location?: string; manualUrl?: string | null },
    ip: string | null,
  ) {
    return this.tx.runAs(actorId, async () => {
      const eq = await this.mustFindEquipment(id);
      await this.access.require(actorId, 'budget', eq.budgetId, 'update');
      await this.repo.updateEquipment(id, patch);
      await this.audit.record({ actorId, action: 'equipment.update', entityType: 'equipment', entityId: id, ip, diff: patch });
      return this.equipmentView({ ...eq, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
    });
  }

  /** Arquivar some com o item e as tarefas dele do painel; o histórico continua guardado. */
  archiveEquipment(actorId: string, id: string, ip: string | null) {
    return this.tx.runAs(actorId, async () => {
      const eq = await this.mustFindEquipment(id);
      await this.access.require(actorId, 'budget', eq.budgetId, 'delete');
      await this.repo.archiveEquipment(id, this.clock.now());
      await this.audit.record({ actorId, action: 'equipment.archive', entityType: 'equipment', entityId: id, ip });
    });
  }

  listMembers(actorId: string, budgetId: string) {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', budgetId, 'read');
      return (await this.repo.listMembers(budgetId, this.clock.now())).map((m) => ({ id: m.id, name: displayName(m) }));
    });
  }

  // ----------------------------------------------------------------- tarefas

  createTask(
    actorId: string,
    equipmentId: string,
    input: { name: string; frequency: Frequency; assigneeId: string; firstDueOn: IsoDate },
    ip: string | null,
  ) {
    return this.tx.runAs(actorId, async () => {
      const eq = await this.mustFindEquipment(equipmentId);
      const grant = await this.access.require(actorId, 'budget', eq.budgetId, 'create');
      await this.requireMember(eq.budgetId, input.assigneeId);
      const created = await this.repo.createTask({
        equipmentId,
        name: input.name,
        frequency: input.frequency,
        assigneeId: input.assigneeId,
        nextDueOn: input.firstDueOn,
        createdBy: actorId,
      });
      await this.audit.record({ actorId, action: 'maintenance_task.create', entityType: 'maintenance_task', entityId: created.id, ip });
      const names = await this.names([created.assigneeId]);
      return this.taskView({ ...created, equipmentName: eq.name, equipmentLocation: eq.location, budgetId: eq.budgetId }, this.today(), names, grant);
    });
  }

  updateTask(
    actorId: string,
    taskId: string,
    input: { version: number; name?: string; frequency?: Frequency; assigneeId?: string; nextDueOn?: IsoDate },
    ip: string | null,
  ) {
    return this.tx.runAs(actorId, async () => {
      const { task, eq } = await this.mustFindTask(taskId);
      const grant = await this.access.require(actorId, 'budget', eq.budgetId, 'update');
      if (!task.active) throw new ConflictError('Esta tarefa já foi encerrada.');
      if (input.assigneeId) await this.requireMember(eq.budgetId, input.assigneeId);
      const { version, ...patch } = input;
      if (!(await this.repo.updateTask(taskId, version, patch))) throw staleTask();
      await this.audit.record({ actorId, action: 'maintenance_task.update', entityType: 'maintenance_task', entityId: taskId, ip, diff: patch });
      const updated = { ...task, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), version: version + 1 };
      const names = await this.names([updated.assigneeId]);
      return this.taskView({ ...updated, equipmentName: eq.name, equipmentLocation: eq.location, budgetId: eq.budgetId }, this.today(), names, grant);
    });
  }

  /** Desativa a tarefa (sai do painel); o histórico das conclusões fica. */
  deactivateTask(actorId: string, taskId: string, version: number, ip: string | null) {
    return this.tx.runAs(actorId, async () => {
      const { eq } = await this.mustFindTask(taskId);
      await this.access.require(actorId, 'budget', eq.budgetId, 'update');
      if (!(await this.repo.updateTask(taskId, version, { active: false }))) throw staleTask();
      await this.audit.record({ actorId, action: 'maintenance_task.deactivate', entityType: 'maintenance_task', entityId: taskId, ip });
    });
  }

  /**
   * Conclusão numa só transação SQL: confere a versão da tarefa, cria a despesa (se houve
   * custo), grava o histórico ligado a ela e recalcula o próximo vencimento a partir da
   * data real. A idempotencyKey faz um clique duplo devolver a mesma conclusão.
   */
  async completeTask(actorId: string, taskId: string, input: CompleteInput, ip: string | null) {
    try {
      return await this.tx.runAs(actorId, () => this.completeInTx(actorId, taskId, input, ip));
    } catch (err) {
      if (isUniqueViolation(err, 'maintenance_logs_idempotency_key_unique')) {
        return this.tx.runAs(actorId, async () => this.replay(actorId, await this.repo.findLogByIdempotencyKey(input.idempotencyKey)));
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------ internos

  private async completeInTx(actorId: string, taskId: string, input: CompleteInput, ip: string | null) {
    const previous = await this.repo.findLogByIdempotencyKey(input.idempotencyKey);
    if (previous) return this.replay(actorId, previous);

    // Permissão antes da trava: SELECT ... FOR UPDATE só enxerga linhas que a pessoa pode
    // alterar, e quem só tem leitura deve receber 403, não 404.
    const { eq } = await this.mustFindTask(taskId);
    await this.access.require(actorId, 'budget', eq.budgetId, 'update');
    const task = await this.repo.findTaskForUpdate(taskId);
    if (!task) throw new NotFoundError('Tarefa não encontrada.');
    if (!task.active || eq.archivedAt) throw new ConflictError('Esta tarefa já foi encerrada.');
    if (task.version !== input.version) throw staleTask();

    const today = this.today();
    if (input.completedOn > today) throw new ValidationError('A data de conclusão não pode estar no futuro.');
    if (daysBetween(input.completedOn, today) > HISTORY_DAYS_BACK) {
      throw new ValidationError('Use uma data de conclusão dos últimos 12 meses.');
    }

    const transactionId = input.cost ? await this.chargeCost(actorId, task, eq, input) : null;
    const next = nextDueDate(input.completedOn, task.frequency);
    const log = await this.repo.insertLog({
      taskId: task.id,
      equipmentId: eq.id,
      taskName: task.name,
      completedBy: actorId,
      completedOn: input.completedOn,
      dueOn: task.nextDueOn,
      nextDueOn: next,
      transactionId,
      note: input.note?.trim() || null,
      idempotencyKey: input.idempotencyKey,
    });
    const ok = await this.repo.updateTask(task.id, task.version, {
      lastDoneOn: input.completedOn,
      nextDueOn: next,
      active: next !== null,
    });
    if (!ok) throw staleTask();
    await this.audit.record({
      actorId,
      action: 'maintenance_task.complete',
      entityType: 'maintenance_task',
      entityId: task.id,
      ip,
      diff: { logId: log.id, completedOn: input.completedOn, next, transactionId },
    });
    return { log: await this.logOf(log), nextDueOn: next, replayed: false };
  }

  /** Lança o custo como despesa paga (conta/dinheiro) ou compra à vista no cartão. */
  private async chargeCost(actorId: string, task: TaskRecord, eq: EquipmentRecord, input: CompleteInput): Promise<string> {
    const cost = input.cost!;
    const wallet = await this.wallets.get(actorId, cost.walletId);
    const categoryId = await this.maintenanceCategory(actorId, cost.budgetId);
    const description = `Manutenção: ${task.name} · ${eq.name}`.slice(0, 120);
    if (wallet.type === 'credit') {
      const result = await this.cardPurchases.purchase(actorId, wallet.id, {
        budgetId: cost.budgetId,
        categoryId,
        description,
        totalCents: cost.amountCents,
        installments: 1,
        purchaseDate: input.completedOn,
        idempotencyKey: input.idempotencyKey,
      });
      return result.installments[0]!.transactionId;
    }
    const created = await this.transactions.create(actorId, cost.budgetId, {
      walletId: wallet.id,
      categoryId,
      description,
      amountCents: cost.amountCents,
      kind: 'expense',
      dueDate: input.completedOn,
      paid: true,
    });
    return created.id;
  }

  private async maintenanceCategory(actorId: string, budgetId: string): Promise<string> {
    const existing = (await this.budgets.listCategories(actorId, budgetId)).find(
      (c) => c.kind === 'expense' && !c.parentId && c.name.toLocaleLowerCase('pt-BR') === MAINTENANCE_CATEGORY.toLocaleLowerCase('pt-BR'),
    );
    if (existing) return existing.id;
    return (await this.budgets.createCategory(actorId, budgetId, { name: MAINTENANCE_CATEGORY, kind: 'expense' })).id;
  }

  private async replay(actorId: string, log: LogRecord | null) {
    if (!log) throw new ConflictError('Conclusão já registrada.');
    const { eq } = await this.mustFindTask(log.taskId);
    await this.access.require(actorId, 'budget', eq.budgetId, 'read');
    return { log: await this.logOf(log), nextDueOn: log.nextDueOn, replayed: true };
  }

  private async logOf(log: LogRecord): Promise<LogView> {
    const [row] = await this.repo.listLogs({ id: log.id, limit: 1 });
    if (!row) throw new NotFoundError('Registro não encontrado.');
    return this.logView(row, await this.names([log.completedBy]));
  }

  private async requireMember(budgetId: string, userId: string): Promise<Member> {
    const member = (await this.repo.listMembers(budgetId, this.clock.now())).find((m) => m.id === userId);
    if (!member) throw new ValidationError('O responsável precisa ter acesso ao orçamento do equipamento.');
    return member;
  }

  private async mustFindEquipment(id: string): Promise<EquipmentRecord> {
    const eq = await this.repo.findEquipment(id);
    if (!eq) throw new NotFoundError('Equipamento não encontrado.');
    return eq;
  }

  private async mustFindTask(id: string): Promise<{ task: TaskRecord; eq: EquipmentRecord }> {
    const task = await this.repo.findTask(id);
    if (!task) throw new NotFoundError('Tarefa não encontrada.');
    return { task, eq: await this.mustFindEquipment(task.equipmentId) };
  }

  private async grants(actorId: string, budgetIds: string[]): Promise<Map<string, AccessGrant | undefined>> {
    const map = new Map<string, AccessGrant | undefined>();
    for (const id of new Set(budgetIds)) map.set(id, (await this.access.grantFor(actorId, 'budget', id)) ?? undefined);
    return map;
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const id of new Set(ids)) {
      const u = await this.users.findById(id);
      if (u) map.set(id, displayName(u));
    }
    return map;
  }

  private person(id: string, names: Map<string, string>): Person {
    return { id, name: names.get(id) ?? 'Pessoa removida' };
  }

  private taskView(t: TaskRow, today: IsoDate, names: Map<string, string>, grant?: AccessGrant): TaskView {
    return {
      id: t.id,
      name: t.name,
      frequency: t.frequency,
      frequencyLabel: FREQUENCY_LABEL[t.frequency],
      equipment: { id: t.equipmentId, name: t.equipmentName, location: t.equipmentLocation },
      budgetId: t.budgetId,
      assignee: this.person(t.assigneeId, names),
      nextDueOn: t.nextDueOn,
      lastDoneOn: t.lastDoneOn,
      state: t.nextDueOn ? dueState(t.nextDueOn, today) : null,
      daysUntil: t.nextDueOn ? daysBetween(today, t.nextDueOn) : null,
      version: t.version,
      canComplete: Boolean(grant?.can.update),
      canEdit: Boolean(grant?.can.update),
    };
  }

  private logView(l: LogRow, names: Map<string, string>): LogView {
    return {
      id: l.id,
      taskId: l.taskId,
      taskName: l.taskName,
      frequencyLabel: FREQUENCY_LABEL[l.frequency],
      equipment: { id: l.equipmentId, name: l.equipmentName, location: l.equipmentLocation },
      completedBy: this.person(l.completedBy, names),
      completedOn: l.completedOn,
      dueOn: l.dueOn,
      nextDueOn: l.nextDueOn,
      costCents: l.costCents,
      note: l.note,
    };
  }

  private equipmentView(e: EquipmentRecord) {
    return { id: e.id, budgetId: e.budgetId, name: e.name, location: e.location, manualUrl: e.manualUrl };
  }

  private today(): IsoDate {
    return todayIso(this.clock.now());
  }
}

function displayName(u: { name: string | null; email: string }): string {
  return u.name?.trim() || u.email.split('@')[0] || u.email;
}

function staleTask() {
  return new ConflictError('Esta tarefa foi alterada por outra pessoa. Recarregue a página e tente de novo.');
}
