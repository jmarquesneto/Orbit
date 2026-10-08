import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_LOG,
  type AuditLog,
  CLOCK,
  type Clock,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import { type IsoDate, parseIsoDate } from '../../../shared/domain/calendar.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { isUniqueViolation } from '../../../infrastructure/database/pg-errors.js';
import { BudgetsService } from '../../budgets/application/budgets.service.js';
import { AccessControlService } from '../../sharing/application/access-control.service.js';
import { INVOICE_REPOSITORY, type InvoiceRepository } from '../../wallets/application/ports.js';
import { WalletsService } from '../../wallets/application/wallets.service.js';
import { installmentDescription, planInstallments } from '../../wallets/domain/invoice-calendar.js';
import type { InvoiceRecord } from '../../wallets/domain/wallet.js';
import {
  INSTALLMENT_PLAN_REPOSITORY,
  type InstallmentPlanRecord,
  type InstallmentPlanRepository,
  TRANSACTION_REPOSITORY,
  type TransactionRepository,
} from './ports.js';

export const MAX_INSTALLMENTS = 48;

export interface PurchaseInput {
  budgetId: string;
  categoryId?: string | null;
  description: string;
  totalCents: number;
  installments: number;
  purchaseDate: IsoDate;
  /** Gerado pelo cliente; reenviar a mesma compra devolve o resultado original. */
  idempotencyKey: string;
}

export interface PurchaseResult {
  plan: InstallmentPlanRecord;
  installments: {
    number: number;
    transactionId: string;
    amountCents: number;
    refMonth: IsoDate;
    dueDate: IsoDate;
    status: string;
  }[];
  replayed: boolean;
}

const monthLabel = (refMonth: IsoDate) => {
  const { year, month } = parseIsoDate(refMonth);
  return `${String(month).padStart(2, '0')}/${year}`;
};

@Injectable()
export class CardPurchasesService {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(INSTALLMENT_PLAN_REPOSITORY) private readonly plans: InstallmentPlanRepository,
    @Inject(INVOICE_REPOSITORY) private readonly invoices: InvoiceRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
    private readonly budgets: BudgetsService,
    private readonly wallets: WalletsService,
  ) {}

  /**
   * Compra no cartão em X parcelas: numa ÚNICA transação SQL, busca ou cria as X faturas
   * dos meses seguintes (UNIQUE card_id + ref_month), cria o plano e uma transação por parcela,
   * cada uma presa à sua fatura, e soma os valores nos totais das faturas.
   * Se qualquer passo falhar, nada é gravado.
   */
  async purchase(actorId: string, cardId: string, input: PurchaseInput): Promise<PurchaseResult> {
    if (input.installments < 1 || input.installments > MAX_INSTALLMENTS) {
      throw new ValidationError(`Parcelamento entre 1 e ${MAX_INSTALLMENTS} vezes.`);
    }
    if (input.installments > input.totalCents) {
      throw new ValidationError('Cada parcela precisa ter ao menos 1 centavo.');
    }
    try {
      return await this.tx.runAs(actorId, () => this.purchaseInTx(actorId, cardId, input));
    } catch (err) {
      // Corrida: a mesma compra chegou duas vezes ao mesmo tempo. A segunda devolve a primeira.
      if (isUniqueViolation(err, 'installment_plans_idempotency_key_unique')) {
        return this.tx.runAs(actorId, async () => {
          const existing = await this.plans.findByIdempotencyKey(input.idempotencyKey);
          if (!existing) throw err;
          return this.result(existing, true);
        });
      }
      throw err;
    }
  }

  private async purchaseInTx(actorId: string, cardId: string, input: PurchaseInput): Promise<PurchaseResult> {
    const replay = await this.plans.findByIdempotencyKey(input.idempotencyKey);
    if (replay) {
      if (replay.cardId !== cardId) throw new ConflictError('Chave de idempotência já usada em outra compra.');
      return this.result(replay, true);
    }

    const card = await this.wallets.requireCard(cardId);
    await this.access.require(actorId, 'budget', input.budgetId, 'create');
    if (input.categoryId) await this.budgets.requireCategory(input.budgetId, input.categoryId, 'expense');

    if (card.card.limitCents > 0) {
      const used = await this.invoices.outstandingCents(cardId);
      if (used + input.totalCents > card.card.limitCents) {
        throw new ConflictError('Limite do cartão insuficiente para esta compra.');
      }
    }

    const planned = planInstallments(input.purchaseDate, input.totalCents, input.installments, card.card);
    const invoices: InvoiceRecord[] = [];
    for (const p of planned) {
      const invoice = await this.invoices.getOrCreateForUpdate(cardId, p.invoice);
      if (invoice.status === 'paid') {
        throw new ConflictError(`A fatura de ${monthLabel(invoice.refMonth)} já foi paga.`);
      }
      invoices.push(invoice);
    }

    const plan = await this.plans.create({
      cardId,
      budgetId: input.budgetId,
      description: input.description,
      totalCents: input.totalCents,
      count: input.installments,
      purchaseDate: input.purchaseDate,
      firstInvoice: invoices[0]!.id,
      createdBy: actorId,
      idempotencyKey: input.idempotencyKey,
    });

    await this.transactions.createMany(
      planned.map((p, i) => ({
        budgetId: input.budgetId,
        walletId: cardId,
        categoryId: input.categoryId ?? null,
        invoiceId: invoices[i]!.id,
        planId: plan.id,
        installmentNo: p.number,
        description: installmentDescription(input.description, p.number, input.installments),
        amountCents: p.amountCents,
        kind: 'expense',
        // A 1ª parcela está na fatura corrente; as demais são provisões de faturas futuras.
        status: i === 0 ? 'open' : 'provisioned',
        dueDate: invoices[i]!.dueDate,
        paidAt: null,
        createdBy: actorId,
      })),
    );
    for (const [i, p] of planned.entries()) await this.invoices.addToTotal(invoices[i]!.id, p.amountCents);

    await this.audit.record({
      actorId,
      action: 'card.purchase',
      entityType: 'installment_plan',
      entityId: plan.id,
      diff: { cardId, totalCents: input.totalCents, installments: input.installments },
    });
    return this.result(plan, false);
  }

  /** Cancela a compra parcelada inteira (estorno), desde que nenhuma fatura dela esteja paga. */
  cancel(actorId: string, cardId: string, planId: string): Promise<void> {
    return this.tx.runAs(actorId, async () => {
      await this.wallets.requireCard(cardId);
      const plan = await this.plans.findById(planId);
      if (!plan || plan.cardId !== cardId) throw new NotFoundError('Compra não encontrada.');
      await this.access.require(actorId, 'budget', plan.budgetId, 'create');

      const installments = await this.plans.installmentsOf(planId);
      if (installments.some((t) => t.status === 'paid')) {
        throw new ConflictError('Há parcelas em faturas já pagas; esta compra não pode ser cancelada.');
      }
      for (const t of installments) {
        if (t.invoiceId) await this.invoices.addToTotal(t.invoiceId, -t.amountCents);
      }
      await this.plans.delete(planId);
      await this.audit.record({
        actorId,
        action: 'card.purchase_cancel',
        entityType: 'installment_plan',
        entityId: planId,
        diff: { cardId, totalCents: plan.totalCents },
      });
    });
  }

  /** Paga a fatura inteira a partir de uma conta: debita a conta e quita todas as parcelas dela. */
  payInvoice(
    actorId: string,
    cardId: string,
    refMonth: IsoDate,
    input: { fromWalletId?: string | null },
  ): Promise<InvoiceRecord> {
    return this.tx.runAs(actorId, async () => {
      const card = await this.wallets.requireCard(cardId);
      const invoice = await this.invoices.findByMonthForUpdate(cardId, refMonth);
      if (!invoice) throw new NotFoundError('Fatura não encontrada.');
      if (invoice.status === 'paid') throw new ConflictError('Esta fatura já foi paga.');
      const amount = invoice.totalCents - invoice.paidCents;
      if (amount <= 0) throw new ConflictError('Esta fatura não tem valor a pagar.');

      const fromId = input.fromWalletId ?? card.card.payFrom;
      if (!fromId) throw new ValidationError('Informe a conta que vai pagar a fatura.');
      const from = await this.wallets.requireSpendable(fromId);

      const now = this.clock.now();
      await this.wallets.adjustBalance(from.id, -amount);
      await this.invoices.markPaid(invoice.id, invoice.totalCents);
      await this.transactions.markInvoicePaid(invoice.id, now);
      await this.audit.record({
        actorId,
        action: 'invoice.pay',
        entityType: 'invoice',
        entityId: invoice.id,
        diff: { cardId, refMonth, amountCents: amount, fromWalletId: from.id },
      });
      return { ...invoice, paidCents: invoice.totalCents, status: 'paid' };
    });
  }

  private async result(plan: InstallmentPlanRecord, replayed: boolean): Promise<PurchaseResult> {
    const rows = await this.plans.installmentsOf(plan.id);
    const invoiceMonths = new Map((await this.invoices.list(plan.cardId)).map((i) => [i.id, i.refMonth]));
    return {
      plan,
      replayed,
      installments: rows.map((t) => ({
        number: t.installmentNo ?? 1,
        transactionId: t.id,
        amountCents: t.amountCents,
        refMonth: (t.invoiceId && invoiceMonths.get(t.invoiceId)) || '',
        dueDate: t.dueDate,
        status: t.status,
      })),
    };
  }
}
