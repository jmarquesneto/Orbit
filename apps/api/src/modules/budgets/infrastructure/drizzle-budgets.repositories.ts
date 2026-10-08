import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { budgets, categories, resourceShares, transactions } from '../../../infrastructure/database/schema.js';
import type { IsoDate } from '../../../shared/domain/calendar.js';
import type { ShareRoleCode } from '../../sharing/domain/permissions.js';
import type { BudgetRecord, CategoryRecord } from '../domain/budget.js';
import type { BudgetRepository, CategoryRepository, CategoryTotals } from '../application/ports.js';

@Injectable()
export class DrizzleBudgetRepository implements BudgetRepository {
  constructor(private readonly ctx: DbContext) {}

  async create(data: Parameters<BudgetRepository['create']>[0]): Promise<BudgetRecord> {
    const [row] = await this.ctx.db.insert(budgets).values(data).returning();
    if (!row) throw new Error('Falha ao criar orçamento');
    return row;
  }

  async findById(id: string): Promise<BudgetRecord | null> {
    const [row] = await this.ctx.db.select().from(budgets).where(eq(budgets.id, id));
    return row ?? null;
  }

  async listVisible(userId: string, now: Date) {
    const rows = await this.ctx.db
      .select({ budget: budgets, shareRole: resourceShares.roleCode })
      .from(budgets)
      .leftJoin(
        resourceShares,
        and(
          eq(resourceShares.resourceType, 'budget'),
          eq(resourceShares.resourceId, budgets.id),
          eq(resourceShares.granteeId, userId),
          isNull(resourceShares.revokedAt),
          or(isNull(resourceShares.expiresAt), gt(resourceShares.expiresAt, now)),
        ),
      )
      .where(isNull(budgets.archivedAt))
      .orderBy(asc(budgets.createdAt));
    return rows.map(({ budget, shareRole }) => ({
      ...budget,
      role: budget.ownerId === userId ? ('owner' as const) : (shareRole as ShareRoleCode),
    }));
  }

  async update(id: string, patch: { name?: string; periodStartDay?: number }) {
    if (Object.keys(patch).length) await this.ctx.db.update(budgets).set(patch).where(eq(budgets.id, id));
  }

  async archive(id: string, at: Date) {
    await this.ctx.db.update(budgets).set({ archivedAt: at }).where(eq(budgets.id, id));
  }
}

@Injectable()
export class DrizzleCategoryRepository implements CategoryRepository {
  constructor(private readonly ctx: DbContext) {}

  async create(data: Omit<CategoryRecord, 'id'>): Promise<CategoryRecord> {
    const [row] = await this.ctx.db.insert(categories).values(data).returning();
    if (!row) throw new Error('Falha ao criar categoria');
    return row;
  }

  async findById(id: string): Promise<CategoryRecord | null> {
    const [row] = await this.ctx.db.select().from(categories).where(eq(categories.id, id));
    return row ?? null;
  }

  listByBudget(budgetId: string): Promise<CategoryRecord[]> {
    return this.ctx.db
      .select()
      .from(categories)
      .where(eq(categories.budgetId, budgetId))
      .orderBy(asc(categories.kind), asc(categories.name));
  }

  async update(id: string, patch: Parameters<CategoryRepository['update']>[1]) {
    if (Object.keys(patch).length) await this.ctx.db.update(categories).set(patch).where(eq(categories.id, id));
  }

  async delete(id: string) {
    await this.ctx.db.delete(categories).where(eq(categories.id, id));
  }

  async totalsByCategory(budgetId: string, from: IsoDate, to: IsoDate): Promise<CategoryTotals[]> {
    const rows = await this.ctx.db
      .select({
        categoryId: transactions.categoryId,
        kind: transactions.kind,
        total: sql<string>`sum(${transactions.amountCents})`,
      })
      .from(transactions)
      .where(
        and(eq(transactions.budgetId, budgetId), gte(transactions.dueDate, from), lt(transactions.dueDate, to)),
      )
      .groupBy(transactions.categoryId, transactions.kind);
    return rows.map((r) => ({ categoryId: r.categoryId, kind: r.kind, totalCents: Number(r.total) }));
  }
}
