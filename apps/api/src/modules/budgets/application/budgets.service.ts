import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK,
  type Clock,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import { parseYearMonth } from '../../../shared/domain/calendar.js';
import { NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { AccessControlService } from '../../sharing/application/access-control.service.js';
import type { AccessGrant } from '../../sharing/domain/permissions.js';
import {
  type BudgetRecord,
  budgetPeriod,
  type CategoryKind,
  type CategoryRecord,
} from '../domain/budget.js';
import {
  BUDGET_REPOSITORY,
  type BudgetRepository,
  CATEGORY_REPOSITORY,
  type CategoryRepository,
} from './ports.js';

export type BudgetView = BudgetRecord & { role: AccessGrant['role']; permissions: AccessGrant['can'] };

export interface BudgetSummary {
  month: string;
  period: { from: string; to: string };
  totals: { incomeCents: number; expenseCents: number; balanceCents: number; plannedExpenseCents: number };
  categories: (CategoryRecord & { actualCents: number; remainingCents: number })[];
  uncategorized: { incomeCents: number; expenseCents: number };
}

@Injectable()
export class BudgetsService {
  constructor(
    @Inject(BUDGET_REPOSITORY) private readonly budgets: BudgetRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
  ) {}

  // ------------------------------------------------------------- orçamentos

  create(
    actorId: string,
    input: { name: string; currency?: string; periodStartDay?: number },
  ): Promise<BudgetView> {
    return this.tx.runAs(actorId, async () => {
      const budget = await this.budgets.create({
        ownerId: actorId,
        name: input.name,
        currency: input.currency ?? 'BRL',
        periodStartDay: input.periodStartDay ?? 1,
      });
      return this.view(actorId, budget);
    });
  }

  list(actorId: string) {
    return this.tx.runAs(actorId, () => this.budgets.listVisible(actorId, this.clock.now()));
  }

  get(actorId: string, id: string): Promise<BudgetView> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', id, 'read');
      return this.view(actorId, await this.mustFind(id));
    });
  }

  update(actorId: string, id: string, patch: { name?: string; periodStartDay?: number }): Promise<BudgetView> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', id, 'update');
      await this.budgets.update(id, patch);
      return this.view(actorId, await this.mustFind(id));
    });
  }

  /** Arquivar é exclusivo do dono; os dados continuam no banco para histórico. */
  archive(actorId: string, id: string): Promise<void> {
    return this.tx.runAs(actorId, async () => {
      await this.access.requireOwner(actorId, 'budget', id);
      await this.budgets.archive(id, this.clock.now());
    });
  }

  /** Planejado x realizado por categoria no mês (base do dashboard). */
  summary(actorId: string, id: string, month: string): Promise<BudgetSummary> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', id, 'read');
      const budget = await this.mustFind(id);
      const period = budgetPeriod(parseYearMonth(month), budget.periodStartDay);
      const [cats, totals] = await Promise.all([
        this.categories.listByBudget(id),
        this.categories.totalsByCategory(id, period.from, period.to),
      ]);

      const actual = new Map<string, number>();
      const uncategorized = { incomeCents: 0, expenseCents: 0 };
      let incomeCents = 0;
      let expenseCents = 0;
      for (const t of totals) {
        if (t.kind === 'income') incomeCents += t.totalCents;
        if (t.kind === 'expense') expenseCents += t.totalCents;
        if (t.categoryId) actual.set(t.categoryId, (actual.get(t.categoryId) ?? 0) + t.totalCents);
        else if (t.kind === 'income') uncategorized.incomeCents += t.totalCents;
        else if (t.kind === 'expense') uncategorized.expenseCents += t.totalCents;
      }

      return {
        month,
        period,
        totals: {
          incomeCents,
          expenseCents,
          balanceCents: incomeCents - expenseCents,
          plannedExpenseCents: cats.filter((c) => c.kind === 'expense').reduce((s, c) => s + c.plannedCents, 0),
        },
        categories: cats.map((c) => {
          const actualCents = actual.get(c.id) ?? 0;
          return { ...c, actualCents, remainingCents: c.plannedCents - actualCents };
        }),
        uncategorized,
      };
    });
  }

  // ------------------------------------------------------------- categorias

  createCategory(
    actorId: string,
    budgetId: string,
    input: { name: string; kind: CategoryKind; plannedCents?: number; color?: string | null; parentId?: string | null },
  ): Promise<CategoryRecord> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', budgetId, 'create');
      if (input.parentId) {
        const parent = await this.requireCategory(budgetId, input.parentId);
        if (parent.parentId) throw new ValidationError('Subcategorias têm apenas um nível.');
        if (parent.kind !== input.kind) throw new ValidationError('A subcategoria deve ter o mesmo tipo da categoria-pai.');
      }
      return this.categories.create({
        budgetId,
        parentId: input.parentId ?? null,
        name: input.name,
        kind: input.kind,
        plannedCents: input.plannedCents ?? 0,
        color: input.color ?? null,
      });
    });
  }

  listCategories(actorId: string, budgetId: string): Promise<CategoryRecord[]> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', budgetId, 'read');
      return this.categories.listByBudget(budgetId);
    });
  }

  updateCategory(
    actorId: string,
    budgetId: string,
    categoryId: string,
    patch: { name?: string; plannedCents?: number; color?: string | null },
  ): Promise<CategoryRecord> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', budgetId, 'update');
      await this.requireCategory(budgetId, categoryId);
      await this.categories.update(categoryId, patch);
      return this.requireCategory(budgetId, categoryId);
    });
  }

  deleteCategory(actorId: string, budgetId: string, categoryId: string): Promise<void> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', budgetId, 'delete');
      await this.requireCategory(budgetId, categoryId);
      // Lançamentos da categoria ficam "sem categoria" (ON DELETE SET NULL), não somem.
      await this.categories.delete(categoryId);
    });
  }

  /** Categoria que pertence ao orçamento informado. Use dentro de runAs. */
  async requireCategory(budgetId: string, categoryId: string, kind?: CategoryKind): Promise<CategoryRecord> {
    const category = await this.categories.findById(categoryId);
    if (!category || category.budgetId !== budgetId) throw new NotFoundError('Categoria não encontrada neste orçamento.');
    if (kind && category.kind !== kind) {
      throw new ValidationError(kind === 'expense' ? 'Use uma categoria de despesa.' : 'Use uma categoria de receita.');
    }
    return category;
  }

  private async mustFind(id: string): Promise<BudgetRecord> {
    const budget = await this.budgets.findById(id);
    if (!budget || budget.archivedAt) throw new NotFoundError('Orçamento não encontrado.');
    return budget;
  }

  private async view(actorId: string, budget: BudgetRecord): Promise<BudgetView> {
    const grant = await this.access.require(actorId, 'budget', budget.id, 'read');
    return { ...budget, role: grant.role, permissions: grant.can };
  }
}
