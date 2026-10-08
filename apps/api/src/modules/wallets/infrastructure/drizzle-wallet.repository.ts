import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { creditCards, wallets } from '../../../infrastructure/database/schema.js';
import type { CreditCardConfig, WalletRecord } from '../domain/wallet.js';
import type { WalletRepository } from '../application/ports.js';

const columns = {
  wallet: wallets,
  card: {
    limitCents: creditCards.limitCents,
    closingDay: creditCards.closingDay,
    dueDay: creditCards.dueDay,
    payFrom: creditCards.payFrom,
  },
};

type Row = { wallet: typeof wallets.$inferSelect; card: CreditCardConfig | null };
const toRecord = ({ wallet, card }: Row): WalletRecord => ({
  id: wallet.id,
  ownerId: wallet.ownerId,
  type: wallet.type,
  name: wallet.name,
  institution: wallet.institution,
  last4: wallet.last4,
  openingCents: wallet.openingCents,
  balanceCents: wallet.balanceCents,
  archivedAt: wallet.archivedAt,
  createdAt: wallet.createdAt,
  card: card?.closingDay ? card : null,
});

@Injectable()
export class DrizzleWalletRepository implements WalletRepository {
  constructor(private readonly ctx: DbContext) {}

  async create(data: Parameters<WalletRepository['create']>[0]): Promise<string> {
    const [row] = await this.ctx.db
      .insert(wallets)
      .values({ ...data, balanceCents: data.openingCents })
      .returning({ id: wallets.id });
    if (!row) throw new Error('Falha ao criar carteira');
    return row.id;
  }

  async createCard(walletId: string, card: CreditCardConfig) {
    await this.ctx.db.insert(creditCards).values({ walletId, ...card });
  }

  async findById(id: string): Promise<WalletRecord | null> {
    const [row] = await this.ctx.db
      .select(columns)
      .from(wallets)
      .leftJoin(creditCards, eq(creditCards.walletId, wallets.id))
      .where(eq(wallets.id, id));
    return row ? toRecord(row) : null;
  }

  async listActive(): Promise<WalletRecord[]> {
    const rows = await this.ctx.db
      .select(columns)
      .from(wallets)
      .leftJoin(creditCards, eq(creditCards.walletId, wallets.id))
      .where(isNull(wallets.archivedAt))
      .orderBy(asc(wallets.createdAt));
    return rows.map(toRecord);
  }

  async update(id: string, patch: Parameters<WalletRepository['update']>[1]) {
    await this.ctx.db.update(wallets).set(patch).where(eq(wallets.id, id));
  }

  async updateCard(walletId: string, patch: Partial<CreditCardConfig>) {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(defined).length) {
      await this.ctx.db.update(creditCards).set(defined).where(eq(creditCards.walletId, walletId));
    }
  }

  async archive(id: string, at: Date) {
    await this.ctx.db
      .update(wallets)
      .set({ archivedAt: at })
      .where(and(eq(wallets.id, id), isNull(wallets.archivedAt)));
  }

  async adjustBalance(id: string, deltaCents: number) {
    await this.ctx.db
      .update(wallets)
      .set({ balanceCents: sql`${wallets.balanceCents} + ${deltaCents}` })
      .where(eq(wallets.id, id));
  }
}
