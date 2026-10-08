import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK,
  type Clock,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { type IsoDate } from '../../../shared/domain/calendar.js';
import {
  type CreditCardConfig,
  type InvoiceRecord,
  isSpendable,
  type WalletRecord,
  type WalletType,
} from '../domain/wallet.js';
import {
  INVOICE_REPOSITORY,
  type InvoiceRepository,
  type InvoiceTransactionView,
  WALLET_REPOSITORY,
  type WalletRepository,
} from './ports.js';

export interface CreateWalletInput {
  type: WalletType;
  name: string;
  institution?: string | null;
  last4?: string | null;
  openingCents?: number;
  card?: { limitCents: number; closingDay: number; dueDay: number; payFromWalletId?: string | null };
}

export interface UpdateWalletInput {
  name?: string;
  institution?: string | null;
  last4?: string | null;
  card?: Partial<{ limitCents: number; closingDay: number; dueDay: number; payFromWalletId: string | null }>;
}

/**
 * Carteiras são sempre pessoais (o MER compartilha orçamentos e caixinhas, não contas).
 * Por isso basta o RLS: qualquer carteira de outra pessoa simplesmente "não existe".
 */
@Injectable()
export class WalletsService {
  constructor(
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(INVOICE_REPOSITORY) private readonly invoices: InvoiceRepository,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  create(actorId: string, input: CreateWalletInput): Promise<WalletRecord> {
    if (input.type === 'credit' && !input.card) {
      throw new ValidationError('Cartão de crédito precisa de limite e dias de fechamento e vencimento.');
    }
    if (input.type !== 'credit' && input.card) {
      throw new ValidationError('Só cartões de crédito têm configuração de fatura.');
    }
    return this.tx.runAs(actorId, async () => {
      const card = input.card ? await this.resolveCard(input.card) : null;
      const opening = input.type === 'credit' ? 0 : (input.openingCents ?? 0);
      const id = await this.wallets.create({
        ownerId: actorId,
        type: input.type,
        name: input.name,
        institution: input.institution ?? null,
        last4: input.last4 ?? null,
        openingCents: opening,
      });
      if (card) await this.wallets.createCard(id, card);
      return this.mustFind(id);
    });
  }

  list(actorId: string): Promise<WalletRecord[]> {
    return this.tx.runAs(actorId, () => this.wallets.listActive());
  }

  get(actorId: string, id: string): Promise<WalletRecord> {
    return this.tx.runAs(actorId, () => this.mustFind(id));
  }

  update(actorId: string, id: string, input: UpdateWalletInput): Promise<WalletRecord> {
    return this.tx.runAs(actorId, async () => {
      const wallet = await this.mustFind(id);
      const { card, ...fields } = input;
      if (Object.keys(fields).length) await this.wallets.update(id, fields);
      if (card) {
        if (!wallet.card) throw new ValidationError('Esta carteira não é um cartão de crédito.');
        const patch: Partial<CreditCardConfig> = {
          limitCents: card.limitCents,
          closingDay: card.closingDay,
          dueDay: card.dueDay,
        };
        if (card.payFromWalletId !== undefined) {
          patch.payFrom = card.payFromWalletId ? (await this.requireSpendable(card.payFromWalletId)).id : null;
        }
        await this.wallets.updateCard(id, patch);
      }
      return this.mustFind(id);
    });
  }

  archive(actorId: string, id: string): Promise<void> {
    return this.tx.runAs(actorId, async () => {
      await this.mustFind(id);
      await this.wallets.archive(id, this.clock.now());
    });
  }

  listInvoices(actorId: string, cardId: string): Promise<InvoiceRecord[]> {
    return this.tx.runAs(actorId, async () => {
      await this.requireCard(cardId);
      return this.invoices.list(cardId);
    });
  }

  getInvoice(
    actorId: string,
    cardId: string,
    refMonth: IsoDate,
  ): Promise<InvoiceRecord & { transactions: InvoiceTransactionView[] }> {
    return this.tx.runAs(actorId, async () => {
      await this.requireCard(cardId);
      const invoice = await this.invoices.findByMonth(cardId, refMonth);
      if (!invoice) throw new NotFoundError('Fatura não encontrada.');
      return { ...invoice, transactions: await this.invoices.transactionsOf(invoice.id) };
    });
  }

  // ------------------------------------------------- usados por outros módulos

  /** Carteira do usuário corrente que movimenta saldo (conta ou dinheiro). Use dentro de runAs. */
  async requireSpendable(walletId: string): Promise<WalletRecord> {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet || wallet.archivedAt) throw new NotFoundError('Carteira não encontrada.');
    if (!isSpendable(wallet)) {
      throw new ValidationError('Use uma conta ou dinheiro. Compras no cartão vão para a fatura.');
    }
    return wallet;
  }

  /** Cartão de crédito do usuário corrente. Use dentro de runAs. */
  async requireCard(walletId: string): Promise<WalletRecord & { card: CreditCardConfig }> {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet || wallet.archivedAt) throw new NotFoundError('Cartão não encontrado.');
    if (!wallet.card) throw new ConflictError('Esta carteira não é um cartão de crédito.');
    return wallet as WalletRecord & { card: CreditCardConfig };
  }

  adjustBalance(walletId: string, deltaCents: number): Promise<void> {
    return this.wallets.adjustBalance(walletId, deltaCents);
  }

  private async resolveCard(card: NonNullable<CreateWalletInput['card']>): Promise<CreditCardConfig> {
    return {
      limitCents: card.limitCents,
      closingDay: card.closingDay,
      dueDay: card.dueDay,
      payFrom: card.payFromWalletId ? (await this.requireSpendable(card.payFromWalletId)).id : null,
    };
  }

  private async mustFind(id: string): Promise<WalletRecord> {
    const wallet = await this.wallets.findById(id);
    if (!wallet || wallet.archivedAt) throw new NotFoundError('Carteira não encontrada.');
    return wallet;
  }
}
