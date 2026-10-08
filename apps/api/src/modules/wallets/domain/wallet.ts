import type { IsoDate } from '../../../shared/domain/calendar.js';

export const WALLET_TYPES = ['checking', 'cash', 'credit'] as const;
export type WalletType = (typeof WALLET_TYPES)[number];

export interface CreditCardConfig {
  limitCents: number;
  closingDay: number;
  dueDay: number;
  payFrom: string | null;
}

export interface WalletRecord {
  id: string;
  ownerId: string;
  type: WalletType;
  name: string;
  institution: string | null;
  last4: string | null;
  openingCents: number;
  balanceCents: number;
  archivedAt: Date | null;
  createdAt: Date;
  card: CreditCardConfig | null;
}

export type InvoiceStatus = 'open' | 'closed' | 'paid';

export interface InvoiceRecord {
  id: string;
  cardId: string;
  refMonth: IsoDate;
  closingDate: IsoDate;
  dueDate: IsoDate;
  totalCents: number;
  paidCents: number;
  status: InvoiceStatus;
}

/** Conta corrente e dinheiro movimentam saldo; cartão de crédito acumula faturas. */
export function isSpendable(wallet: WalletRecord): boolean {
  return wallet.type !== 'credit' && wallet.archivedAt === null;
}
