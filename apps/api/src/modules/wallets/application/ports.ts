import type { IsoDate } from '../../../shared/domain/calendar.js';
import type { InvoiceDates } from '../domain/invoice-calendar.js';
import type { CreditCardConfig, InvoiceRecord, WalletRecord, WalletType } from '../domain/wallet.js';

/** Todas as operações rodam sob RLS: só enxergam carteiras do usuário corrente. */
export interface WalletRepository {
  create(data: {
    ownerId: string;
    type: WalletType;
    name: string;
    institution: string | null;
    last4: string | null;
    openingCents: number;
  }): Promise<string>;
  createCard(walletId: string, card: CreditCardConfig): Promise<void>;
  findById(id: string): Promise<WalletRecord | null>;
  listActive(): Promise<WalletRecord[]>;
  update(id: string, patch: { name?: string; institution?: string | null; last4?: string | null }): Promise<void>;
  updateCard(walletId: string, patch: Partial<CreditCardConfig>): Promise<void>;
  archive(id: string, at: Date): Promise<void>;
  /** Soma atômica (`balance = balance + delta`), sem ler-e-gravar. */
  adjustBalance(id: string, deltaCents: number): Promise<void>;
}
export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');

export interface InvoiceTransactionView {
  id: string;
  budgetId: string;
  description: string;
  amountCents: number;
  installmentNo: number | null;
  planId: string | null;
  status: string;
}

export interface InvoiceRepository {
  /** Busca ou cria a fatura da competência (UNIQUE card_id + ref_month) e a trava. */
  getOrCreateForUpdate(cardId: string, dates: InvoiceDates): Promise<InvoiceRecord>;
  findByMonthForUpdate(cardId: string, refMonth: IsoDate): Promise<InvoiceRecord | null>;
  findByMonth(cardId: string, refMonth: IsoDate): Promise<InvoiceRecord | null>;
  list(cardId: string): Promise<InvoiceRecord[]>;
  addToTotal(id: string, deltaCents: number): Promise<void>;
  markPaid(id: string, paidCents: number): Promise<void>;
  /** Quanto do limite está comprometido: soma do que falta pagar nas faturas não quitadas. */
  outstandingCents(cardId: string): Promise<number>;
  transactionsOf(invoiceId: string): Promise<InvoiceTransactionView[]>;
}
export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');
