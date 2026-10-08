import type { IsoDate } from '../../../shared/domain/calendar.js';
import type { TransactionKind, TransactionRecord, TransactionStatus } from '../domain/transaction.js';

export interface NewTransaction {
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
  ofxFitid?: string | null;
  createdBy: string;
}

export interface TransactionRepository {
  create(data: NewTransaction): Promise<TransactionRecord>;
  createMany(rows: NewTransaction[]): Promise<TransactionRecord[]>;
  findById(id: string): Promise<TransactionRecord | null>;
  listByBudget(budgetId: string, range?: { from: IsoDate; to: IsoDate }): Promise<TransactionRecord[]>;
  /** Grava só se a versão ainda for `expectedVersion`; devolve null se alguém alterou antes. */
  updateIfVersion(
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<TransactionRecord, 'description' | 'categoryId' | 'amountCents' | 'dueDate' | 'status' | 'paidAt'>>,
  ): Promise<TransactionRecord | null>;
  delete(id: string): Promise<void>;
  markInvoicePaid(invoiceId: string, at: Date): Promise<void>;

  // ---- conciliação bancária (OFX)
  /** Lançamentos ainda não pagos da carteira, com vencimento em [from, to], sem vínculo com extrato. */
  findReconcilable(walletId: string, from: IsoDate, to: IsoDate): Promise<TransactionRecord[]>;
  /** Quais destes FITIDs já confirmaram algum lançamento nesta carteira. */
  existingFitIds(walletId: string, fitIds: string[]): Promise<Set<string>>;
  /** Marca como pago pelo banco, com o valor real do extrato. Devolve false se o RLS barrou. */
  linkToBank(id: string, data: { amountCents: number; paidAt: Date; ofxFitid: string }): Promise<boolean>;
  unlinkFromBank(id: string): Promise<boolean>;
}
export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY');

export interface InstallmentPlanRecord {
  id: string;
  cardId: string;
  budgetId: string;
  description: string;
  totalCents: number;
  count: number;
  purchaseDate: IsoDate;
  firstInvoice: string;
  createdBy: string;
  idempotencyKey: string;
  createdAt: Date;
}

export interface InstallmentPlanRepository {
  findByIdempotencyKey(key: string): Promise<InstallmentPlanRecord | null>;
  findById(id: string): Promise<InstallmentPlanRecord | null>;
  create(data: Omit<InstallmentPlanRecord, 'id' | 'createdAt'>): Promise<InstallmentPlanRecord>;
  /** Remove o plano; as parcelas saem junto (ON DELETE CASCADE). */
  delete(id: string): Promise<void>;
  installmentsOf(planId: string): Promise<TransactionRecord[]>;
}
export const INSTALLMENT_PLAN_REPOSITORY = Symbol('INSTALLMENT_PLAN_REPOSITORY');
