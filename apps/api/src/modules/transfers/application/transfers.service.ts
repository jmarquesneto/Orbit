import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_LOG,
  type AuditLog,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import { NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { WalletsService } from '../../wallets/application/wallets.service.js';
import type { TransferRecord } from '../domain/transfer.js';
import { type CreateTransferInput, TRANSFER_REPOSITORY, type TransferRepository } from './ports.js';

/**
 * Transferência entre contas (Lançamento → aba "Transferência"). Sai de uma carteira e
 * entra em outra na mesma transação: o saldo total não muda e nada conta no orçamento.
 */
@Injectable()
export class TransfersService {
  constructor(
    @Inject(TRANSFER_REPOSITORY) private readonly transfers: TransferRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    private readonly wallets: WalletsService,
  ) {}

  create(actorId: string, input: CreateTransferInput, ip: string | null): Promise<TransferRecord> {
    if (input.fromWalletId === input.toWalletId) {
      throw new ValidationError('Escolha carteiras diferentes para a origem e o destino.');
    }
    return this.tx.runAs(actorId, async () => {
      // As duas precisam ser contas/dinheiro do próprio usuário (RLS + regra de saldo).
      const from = await this.wallets.requireSpendable(input.fromWalletId);
      const to = await this.wallets.requireSpendable(input.toWalletId);
      const created = await this.transfers.create({
        fromWalletId: from.id,
        toWalletId: to.id,
        amountCents: input.amountCents,
        occurredOn: input.occurredOn,
        description: input.description?.trim() || null,
        createdBy: actorId,
      });
      await this.wallets.adjustBalance(from.id, -input.amountCents);
      await this.wallets.adjustBalance(to.id, input.amountCents);
      await this.audit.record({
        actorId,
        action: 'transfer.create',
        entityType: 'transfer',
        entityId: created.id,
        ip,
        diff: { from: from.id, to: to.id, amountCents: input.amountCents },
      });
      return created;
    });
  }

  list(actorId: string, filter: { walletId?: string; limit?: number } = {}): Promise<TransferRecord[]> {
    return this.tx.runAs(actorId, () =>
      this.transfers.list({ walletId: filter.walletId, limit: Math.min(filter.limit ?? 50, 200) }),
    );
  }

  /** Desfaz: devolve o valor para a origem e apaga o registro. */
  remove(actorId: string, id: string, ip: string | null): Promise<void> {
    return this.tx.runAs(actorId, async () => {
      const transfer = await this.transfers.findById(id);
      if (!transfer) throw new NotFoundError('Transferência não encontrada.');
      await this.transfers.delete(id);
      await this.wallets.adjustBalance(transfer.fromWalletId, transfer.amountCents);
      await this.wallets.adjustBalance(transfer.toWalletId, -transfer.amountCents);
      await this.audit.record({
        actorId,
        action: 'transfer.delete',
        entityType: 'transfer',
        entityId: id,
        ip,
        diff: { from: transfer.fromWalletId, to: transfer.toWalletId, amountCents: transfer.amountCents },
      });
    });
  }
}
