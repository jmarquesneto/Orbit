import type { IsoDate } from '../../../shared/domain/calendar.js';
import type { TransferRecord } from '../domain/transfer.js';

/** Roda sob RLS: só enxerga transferências entre carteiras do usuário corrente. */
export interface TransferRepository {
  create(data: Omit<TransferRecord, 'id' | 'createdAt'>): Promise<TransferRecord>;
  findById(id: string): Promise<TransferRecord | null>;
  list(filter: { walletId?: string; limit: number }): Promise<TransferRecord[]>;
  delete(id: string): Promise<void>;
}
export const TRANSFER_REPOSITORY = Symbol('TRANSFER_REPOSITORY');

export interface CreateTransferInput {
  fromWalletId: string;
  toWalletId: string;
  amountCents: number;
  occurredOn: IsoDate;
  description?: string | null;
}
