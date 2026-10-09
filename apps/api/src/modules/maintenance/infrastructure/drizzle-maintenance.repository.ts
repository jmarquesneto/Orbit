import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, isNull, lte, min, or, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import {
  budgets,
  equipment,
  maintenanceLogs,
  maintenanceTasks,
  resourceShares,
  transactions,
  users,
} from '../../../infrastructure/database/schema.js';
import type { EquipmentRecord, LogRecord, TaskRecord } from '../domain/maintenance.js';
import type { EquipmentSummaryRow, LogRow, MaintenanceRepository, Member, TaskRow } from '../application/ports.js';

const taskColumns = {
  id: maintenanceTasks.id,
  equipmentId: maintenanceTasks.equipmentId,
  name: maintenanceTasks.name,
  frequency: maintenanceTasks.frequency,
  assigneeId: maintenanceTasks.assigneeId,
  nextDueOn: maintenanceTasks.nextDueOn,
  lastDoneOn: maintenanceTasks.lastDoneOn,
  active: maintenanceTasks.active,
  createdBy: maintenanceTasks.createdBy,
  createdAt: maintenanceTasks.createdAt,
  version: maintenanceTasks.version,
};

const whereAll = (conds: (SQL | undefined)[]) => and(...conds.filter((c): c is SQL => c !== undefined));

@Injectable()
export class DrizzleMaintenanceRepository implements MaintenanceRepository {
  constructor(private readonly ctx: DbContext) {}

  // ------------------------------------------------------------ equipamentos

  async createEquipment(data: Parameters<MaintenanceRepository['createEquipment']>[0]): Promise<EquipmentRecord> {
    const [row] = await this.ctx.db.insert(equipment).values(data).returning();
    if (!row) throw new Error('Falha ao criar equipamento');
    return row;
  }

  async findEquipment(id: string): Promise<EquipmentRecord | null> {
    const [row] = await this.ctx.db.select().from(equipment).where(eq(equipment.id, id));
    return row ?? null;
  }

  async updateEquipment(id: string, patch: Parameters<MaintenanceRepository['updateEquipment']>[1]) {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(defined).length) await this.ctx.db.update(equipment).set(defined).where(eq(equipment.id, id));
  }

  async archiveEquipment(id: string, at: Date) {
    await this.ctx.db
      .update(equipment)
      .set({ archivedAt: at })
      .where(and(eq(equipment.id, id), isNull(equipment.archivedAt)));
  }

  async listEquipment(filter: { budgetId?: string }): Promise<EquipmentSummaryRow[]> {
    const rows = await this.ctx.db
      .select({
        e: equipment,
        activeTasks: count(maintenanceTasks.id),
        nextDueOn: min(maintenanceTasks.nextDueOn),
      })
      .from(equipment)
      .leftJoin(
        maintenanceTasks,
        and(eq(maintenanceTasks.equipmentId, equipment.id), eq(maintenanceTasks.active, true)),
      )
      .where(
        whereAll([isNull(equipment.archivedAt), filter.budgetId ? eq(equipment.budgetId, filter.budgetId) : undefined]),
      )
      .groupBy(equipment.id)
      .orderBy(asc(equipment.name));
    return rows.map((r) => ({ ...r.e, activeTasks: Number(r.activeTasks), nextDueOn: r.nextDueOn ?? null }));
  }

  // ----------------------------------------------------------------- tarefas

  async createTask(data: Parameters<MaintenanceRepository['createTask']>[0]): Promise<TaskRecord> {
    const [row] = await this.ctx.db.insert(maintenanceTasks).values(data).returning(taskColumns);
    if (!row) throw new Error('Falha ao criar tarefa');
    return row;
  }

  async findTask(id: string): Promise<TaskRecord | null> {
    const [row] = await this.ctx.db.select(taskColumns).from(maintenanceTasks).where(eq(maintenanceTasks.id, id));
    return row ?? null;
  }

  async findTaskForUpdate(id: string): Promise<TaskRecord | null> {
    const [row] = await this.ctx.db
      .select(taskColumns)
      .from(maintenanceTasks)
      .where(eq(maintenanceTasks.id, id))
      .for('update');
    return row ?? null;
  }

  async updateTask(id: string, expectedVersion: number, patch: Parameters<MaintenanceRepository['updateTask']>[2]) {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const rows = await this.ctx.db
      .update(maintenanceTasks)
      .set({ ...defined, version: expectedVersion + 1 })
      .where(and(eq(maintenanceTasks.id, id), eq(maintenanceTasks.version, expectedVersion)))
      .returning({ id: maintenanceTasks.id });
    return rows.length === 1;
  }

  async listActiveTasks(filter: { budgetId?: string; equipmentId?: string; assigneeId?: string }): Promise<TaskRow[]> {
    const rows = await this.ctx.db
      .select({
        t: taskColumns,
        equipmentName: equipment.name,
        equipmentLocation: equipment.location,
        budgetId: equipment.budgetId,
      })
      .from(maintenanceTasks)
      .innerJoin(equipment, eq(equipment.id, maintenanceTasks.equipmentId))
      .where(
        whereAll([
          eq(maintenanceTasks.active, true),
          isNull(equipment.archivedAt),
          filter.budgetId ? eq(equipment.budgetId, filter.budgetId) : undefined,
          filter.equipmentId ? eq(maintenanceTasks.equipmentId, filter.equipmentId) : undefined,
          filter.assigneeId ? eq(maintenanceTasks.assigneeId, filter.assigneeId) : undefined,
        ]),
      )
      .orderBy(asc(maintenanceTasks.nextDueOn), asc(maintenanceTasks.name));
    return rows.map((r) => ({ ...r.t, equipmentName: r.equipmentName, equipmentLocation: r.equipmentLocation, budgetId: r.budgetId }));
  }

  // --------------------------------------------------------------- histórico

  async insertLog(data: Parameters<MaintenanceRepository['insertLog']>[0]): Promise<LogRecord> {
    const [row] = await this.ctx.db.insert(maintenanceLogs).values(data).returning();
    if (!row) throw new Error('Falha ao registrar a manutenção');
    return row;
  }

  async findLogByIdempotencyKey(key: string): Promise<LogRecord | null> {
    const [row] = await this.ctx.db.select().from(maintenanceLogs).where(eq(maintenanceLogs.idempotencyKey, key));
    return row ?? null;
  }

  async listLogs(filter: Parameters<MaintenanceRepository['listLogs']>[0]): Promise<LogRow[]> {
    const rows = await this.ctx.db
      .select({
        l: maintenanceLogs,
        equipmentName: equipment.name,
        equipmentLocation: equipment.location,
        budgetId: equipment.budgetId,
        frequency: maintenanceTasks.frequency,
        assigneeId: maintenanceTasks.assigneeId,
        // A despesa pode estar num orçamento que a pessoa não vê: o RLS devolve NULL.
        costCents: transactions.amountCents,
      })
      .from(maintenanceLogs)
      .innerJoin(equipment, eq(equipment.id, maintenanceLogs.equipmentId))
      .innerJoin(maintenanceTasks, eq(maintenanceTasks.id, maintenanceLogs.taskId))
      .leftJoin(transactions, eq(transactions.id, maintenanceLogs.transactionId))
      .where(
        whereAll([
          filter.id !== undefined ? eq(maintenanceLogs.id, filter.id) : undefined,
          filter.budgetId ? eq(equipment.budgetId, filter.budgetId) : undefined,
          filter.equipmentId ? eq(maintenanceLogs.equipmentId, filter.equipmentId) : undefined,
          filter.assigneeId
            ? or(eq(maintenanceTasks.assigneeId, filter.assigneeId), eq(maintenanceLogs.completedBy, filter.assigneeId))
            : undefined,
          filter.from ? gte(maintenanceLogs.completedOn, filter.from) : undefined,
          filter.to ? lte(maintenanceLogs.completedOn, filter.to) : undefined,
        ]),
      )
      .orderBy(desc(maintenanceLogs.completedOn), desc(maintenanceLogs.id))
      .limit(filter.limit);
    return rows.map((r) => ({
      ...r.l,
      equipmentName: r.equipmentName,
      equipmentLocation: r.equipmentLocation,
      budgetId: r.budgetId,
      frequency: r.frequency,
      assigneeId: r.assigneeId,
      costCents: r.costCents ?? null,
    }));
  }

  // ------------------------------------------------------------------ pessoas

  async listMembers(budgetId: string, now: Date): Promise<Member[]> {
    const owner = await this.ctx.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(budgets)
      .innerJoin(users, eq(users.id, budgets.ownerId))
      .where(eq(budgets.id, budgetId));
    const guests = await this.ctx.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(resourceShares)
      .innerJoin(users, eq(users.id, resourceShares.granteeId))
      .where(
        and(
          eq(resourceShares.resourceType, 'budget'),
          eq(resourceShares.resourceId, budgetId),
          isNull(resourceShares.revokedAt),
          or(isNull(resourceShares.expiresAt), gt(resourceShares.expiresAt, now)),
          eq(users.status, 'active'),
        ),
      );
    const seen = new Set<string>();
    return [...owner, ...guests].filter((m) => !seen.has(m.id) && seen.add(m.id));
  }
}
