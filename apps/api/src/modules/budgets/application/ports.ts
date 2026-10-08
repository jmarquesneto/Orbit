import type { IsoDate } from '../../../shared/domain/calendar.js';
import type { ShareRoleCode } from '../../sharing/domain/permissions.js';
import type { BudgetRecord, CategoryKind, CategoryRecord } from '../domain/budget.js';

export interface BudgetRepository {
  create(data: { ownerId: string; name: string; currency: string; periodStartDay: number }): Promise<BudgetRecord>;
  findById(id: string): Promise<BudgetRecord | null>;
  /** Orçamentos visíveis ao usuário corrente (RLS) com o papel dele em cada um. */
  listVisible(userId: string, now: Date): Promise<(BudgetRecord & { role: 'owner' | ShareRoleCode })[]>;
  update(id: string, patch: { name?: string; periodStartDay?: number }): Promise<void>;
  archive(id: string, at: Date): Promise<void>;
}
export const BUDGET_REPOSITORY = Symbol('BUDGET_REPOSITORY');

export interface CategoryTotals {
  categoryId: string | null;
  kind: 'income' | 'expense' | 'xfer';
  totalCents: number;
}

export interface CategoryRepository {
  create(data: Omit<CategoryRecord, 'id'>): Promise<CategoryRecord>;
  findById(id: string): Promise<CategoryRecord | null>;
  listByBudget(budgetId: string): Promise<CategoryRecord[]>;
  update(id: string, patch: { name?: string; plannedCents?: number; color?: string | null }): Promise<void>;
  delete(id: string): Promise<void>;
  /** Soma dos lançamentos do orçamento no período [from, to), por categoria e tipo. */
  totalsByCategory(budgetId: string, from: IsoDate, to: IsoDate): Promise<CategoryTotals[]>;
}
export const CATEGORY_REPOSITORY = Symbol('CATEGORY_REPOSITORY');

export type { CategoryKind };
