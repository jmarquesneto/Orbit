import { Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { invoices, transactions } from '../../../infrastructure/database/schema.js';
import type { IsoDate } from '../../../shared/domain/calendar.js';
import type { InvoiceDates } from '../domain/invoice-calendar.js';
import type { InvoiceRecord } from '../domain/wallet.js';
import type { InvoiceRepository } from '../application/ports.js';

const byMonth = (cardId: string, refMonth: IsoDate) =>
  and(eq(invoices.cardId, cardId), eq(invoices.refMonth, refMonth));

@Injectable()
export class DrizzleInvoiceRepository implements InvoiceRepository {
  constructor(private readonly ctx: DbContext) {}

  async getOrCreateForUpdate(cardId: string, dates: InvoiceDates): Promise<InvoiceRecord> {
    // ON CONFLICT DO NOTHING + SELECT FOR UPDATE: duas compras simultâneas no mesmo mês
    // convergem para a MESMA fatura, sem erro de chave duplicada.
    await this.ctx.db
      .insert(invoices)
      .values({ cardId, ...dates })
      .onConflictDoNothing({ target: [invoices.cardId, invoices.refMonth] });
    const invoice = await this.findByMonthForUpdate(cardId, dates.refMonth);
    if (!invoice) throw new Error('Fatura não encontrada após criação');
    return invoice;
  }

  async findByMonthForUpdate(cardId: string, refMonth: IsoDate): Promise<InvoiceRecord | null> {
    const [row] = await this.ctx.db.select().from(invoices).where(byMonth(cardId, refMonth)).for('update');
    return row ?? null;
  }

  async findByMonth(cardId: string, refMonth: IsoDate): Promise<InvoiceRecord | null> {
    const [row] = await this.ctx.db.select().from(invoices).where(byMonth(cardId, refMonth));
    return row ?? null;
  }

  list(cardId: string): Promise<InvoiceRecord[]> {
    return this.ctx.db.select().from(invoices).where(eq(invoices.cardId, cardId)).orderBy(asc(invoices.refMonth));
  }

  async addToTotal(id: string, deltaCents: number) {
    await this.ctx.db
      .update(invoices)
      .set({ totalCents: sql`${invoices.totalCents} + ${deltaCents}` })
      .where(eq(invoices.id, id));
  }

  async markPaid(id: string, paidCents: number) {
    await this.ctx.db.update(invoices).set({ paidCents, status: 'paid' }).where(eq(invoices.id, id));
  }

  async outstandingCents(cardId: string): Promise<number> {
    const [row] = await this.ctx.db
      .select({ v: sql<string>`coalesce(sum(${invoices.totalCents} - ${invoices.paidCents}), 0)` })
      .from(invoices)
      .where(and(eq(invoices.cardId, cardId), ne(invoices.status, 'paid')));
    return Number(row?.v ?? 0);
  }

  transactionsOf(invoiceId: string) {
    return this.ctx.db
      .select({
        id: transactions.id,
        budgetId: transactions.budgetId,
        description: transactions.description,
        amountCents: transactions.amountCents,
        installmentNo: transactions.installmentNo,
        planId: transactions.planId,
        status: transactions.status,
      })
      .from(transactions)
      .where(eq(transactions.invoiceId, invoiceId))
      .orderBy(asc(transactions.createdAt));
  }
}
