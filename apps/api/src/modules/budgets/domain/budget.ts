import {
  addMonths,
  clampedDate,
  type IsoDate,
  type YearMonth,
} from '../../../shared/domain/calendar.js';

export interface BudgetRecord {
  id: string;
  ownerId: string;
  name: string;
  currency: string;
  periodStartDay: number;
  archivedAt: Date | null;
  createdAt: Date;
}

export const CATEGORY_KINDS = ['income', 'expense'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export interface CategoryRecord {
  id: string;
  budgetId: string;
  parentId: string | null;
  name: string;
  kind: CategoryKind;
  plannedCents: number;
  color: string | null;
}

/**
 * Período do orçamento para o mês `ym`. Com início no dia 5, "outubro" vai de 05/10 a 04/11
 * (útil para quem recebe no dia 5). `to` é exclusivo.
 */
export function budgetPeriod(ym: YearMonth, periodStartDay: number): { from: IsoDate; to: IsoDate } {
  return {
    from: clampedDate(ym, periodStartDay),
    to: clampedDate(addMonths(ym, 1), periodStartDay),
  };
}
