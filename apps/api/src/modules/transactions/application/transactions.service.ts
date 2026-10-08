import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK,
  type Clock,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import { parseYearMonth } from '../../../shared/domain/calendar.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { BudgetsService } from '../../budgets/application/budgets.service.js';
import { budgetPeriod } from '../../budgets/domain/budget.js';
import { AccessControlService } from '../../sharing/application/access-control.service.js';
import { WalletsService } from '../../wallets/application/wallets.service.js';
import { balanceEffect, type TransactionRecord } from '../domain/transaction.js';
import { TRANSACTION_REPOSITORY, type TransactionRepository } from './ports.js';

const STALE =
  'Este lançamento foi alterado por outra pessoa enquanto você editava. Recarregue e tente de novo.';

export interface CreateTransactionInput {
  walletId: string;
  categoryId?: string | null;
  description: string;
  amountCents: number;
  kind: 'income' | 'expense';
  dueDate: string;
  paid?: boolean;
}

/**
 * Lançamentos avulsos de conta corrente ou dinheiro. Toda operação:
 *  1. abre transação em nome do usuário (RLS);
 *  2. confere a permissão dele no orçamento (dono ou resource_share);
 *  3. só mexe no saldo de carteiras que ele mesmo possui.
 */
@Injectable()
export class TransactionsService {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
    private readonly budgets: BudgetsService,
    private readonly wallets: WalletsService,
  ) {}

  create(actorId: string, budgetId: string, input: CreateTransactionInput): Promise<TransactionRecord> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', budgetId, 'create');
      const wallet = await this.wallets.requireSpendable(input.walletId);
      if (input.categoryId) await this.budgets.requireCategory(budgetId, input.categoryId, input.kind);

      const paid = input.paid ?? false;
      const created = await this.transactions.create({
        budgetId,
        walletId: wallet.id,
        categoryId: input.categoryId ?? null,
        invoiceId: null,
        planId: null,
        installmentNo: null,
        description: input.description,
        amountCents: input.amountCents,
        kind: input.kind,
        status: paid ? 'paid' : 'open',
        dueDate: input.dueDate,
        paidAt: paid ? this.clock.now() : null,
        createdBy: actorId,
      });
      if (paid) await this.wallets.adjustBalance(wallet.id, balanceEffect(created.kind, created.amountCents));
      return created;
    });
  }

  list(actorId: string, budgetId: string, month?: string): Promise<TransactionRecord[]> {
    return this.tx.runAs(actorId, async () => {
      const budget = await this.budgets.get(actorId, budgetId);
      const range = month ? budgetPeriod(parseYearMonth(month), budget.periodStartDay) : undefined;
      return this.transactions.listByBudget(budgetId, range);
    });
  }

  /** Marca ou desmarca como pago, ajustando o saldo da carteira. */
  setPaid(
    actorId: string,
    budgetId: string,
    id: string,
    input: { paid: boolean; version: number },
  ): Promise<TransactionRecord> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', budgetId, 'update');
      const current = await this.requireInBudget(budgetId, id);
      if (current.invoiceId) {
        throw new ConflictError('Compras no cartão são quitadas ao pagar a fatura.');
      }
      if ((current.status === 'paid') === input.paid) return current;
      await this.requireOwnWallet(current.walletId);

      const updated = await this.transactions.updateIfVersion(id, input.version, {
        status: input.paid ? 'paid' : 'open',
        paidAt: input.paid ? this.clock.now() : null,
      });
      if (!updated) throw new ConflictError(STALE);
      const effect = balanceEffect(current.kind, current.amountCents);
      await this.wallets.adjustBalance(current.walletId, input.paid ? effect : -effect);
      return updated;
    });
  }

  update(
    actorId: string,
    budgetId: string,
    id: string,
    input: { version: number; description?: string; categoryId?: string | null; amountCents?: number; dueDate?: string },
  ): Promise<TransactionRecord> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', budgetId, 'update');
      const current = await this.requireInBudget(budgetId, id);
      const { version, ...patch } = input;

      const changesMoney = patch.amountCents !== undefined || patch.dueDate !== undefined;
      if (changesMoney && current.planId) {
        throw new ConflictError('Valor e data de parcelas não mudam. Cancele a compra e lance de novo.');
      }
      if (patch.categoryId && current.kind !== 'xfer') {
        await this.budgets.requireCategory(budgetId, patch.categoryId, current.kind);
      }
      const amountDelta =
        patch.amountCents !== undefined && current.status === 'paid'
          ? balanceEffect(current.kind, patch.amountCents) - balanceEffect(current.kind, current.amountCents)
          : 0;
      if (amountDelta) await this.requireOwnWallet(current.walletId);

      const updated = await this.transactions.updateIfVersion(id, version, patch);
      if (!updated) throw new ConflictError(STALE);
      if (amountDelta) await this.wallets.adjustBalance(current.walletId, amountDelta);
      return updated;
    });
  }

  delete(actorId: string, budgetId: string, id: string): Promise<void> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'budget', budgetId, 'delete');
      const current = await this.requireInBudget(budgetId, id);
      if (current.planId) throw new ConflictError('Parcelas saem cancelando a compra parcelada inteira.');
      if (current.status === 'paid') throw new ConflictError('Desmarque o pagamento antes de excluir.');
      await this.transactions.delete(id);
    });
  }

  private async requireInBudget(budgetId: string, id: string): Promise<TransactionRecord> {
    const found = await this.transactions.findById(id);
    if (!found || found.budgetId !== budgetId) throw new NotFoundError('Lançamento não encontrado.');
    return found;
  }

  /** Só o dono da carteira mexe no saldo dela (num orçamento compartilhado, cada um paga do seu). */
  private async requireOwnWallet(walletId: string): Promise<void> {
    try {
      await this.wallets.requireSpendable(walletId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new ForbiddenError('Só quem é dono da carteira deste lançamento pode alterar o pagamento.');
      }
      throw err;
    }
  }
}
