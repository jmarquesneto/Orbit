import type { IsoDate } from '../../../shared/domain/calendar.js';

/** Dinheiro movido entre duas carteiras da mesma pessoa: não é receita nem despesa. */
export interface TransferRecord {
  id: string;
  fromWalletId: string;
  toWalletId: string;
  amountCents: number;
  occurredOn: IsoDate;
  description: string | null;
  createdBy: string;
  createdAt: Date;
}
