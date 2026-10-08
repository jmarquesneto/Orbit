import type { IsoDate } from '../../../shared/domain/calendar.js';

export type TransactionKind = 'income' | 'expense' | 'xfer';
export type TransactionStatus = 'open' | 'paid' | 'provisioned';

export interface TransactionRecord {
  id: string;
  budgetId: string;
  walletId: string;
  categoryId: string | null;
  invoiceId: string | null;
  planId: string | null;
  installmentNo: number | null;
  description: string;
  amountCents: number;
  kind: TransactionKind;
  status: TransactionStatus;
  dueDate: IsoDate;
  paidAt: Date | null;
  createdBy: string;
  version: number;
  createdAt: Date;
}

/** Efeito no saldo da carteira quando o lançamento é pago: receita soma, despesa subtrai. */
export function balanceEffect(kind: TransactionKind, amountCents: number): number {
  if (kind === 'income') return amountCents;
  if (kind === 'expense') return -amountCents;
  return 0;
}

/** "Vencido" é calculado, nunca gravado (MER): em aberto e com vencimento antes de hoje. */
export function isOverdue(t: Pick<TransactionRecord, 'status' | 'dueDate'>, today: IsoDate): boolean {
  return t.status !== 'paid' && t.dueDate < today;
}
