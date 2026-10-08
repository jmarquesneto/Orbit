import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { installmentPlans, transactions } from '../../../infrastructure/database/schema.js';
import type { IsoDate } from '../../../shared/domain/calendar.js';
import type { TransactionRecord } from '../domain/transaction.js';
import type {
  InstallmentPlanRecord,
  InstallmentPlanRepository,
  NewTransaction,
  TransactionRepository,
} from '../application/ports.js';

const columns = {
  id: transactions.id,
  budgetId: transactions.budgetId,
  walletId: transactions.walletId,
  categoryId: transactions.categoryId,
  invoiceId: transactions.invoiceId,
  planId: transactions.planId,
  installmentNo: transactions.installmentNo,
  description: transactions.description,
  amountCents: transactions.amountCents,
  kind: transactions.kind,
  status: transactions.status,
  dueDate: transactions.dueDate,
  paidAt: transactions.paidAt,
  ofxFitid: transactions.ofxFitid,
  createdBy: transactions.createdBy,
  version: transactions.version,
  createdAt: transactions.createdAt,
};

@Injectable()
export class DrizzleTransactionRepository implements TransactionRepository {
  constructor(private readonly ctx: DbContext) {}

  async create(data: NewTransaction): Promise<TransactionRecord> {
    const [row] = await this.ctx.db.insert(transactions).values(data).returning(columns);
    if (!row) throw new Error('Falha ao criar lançamento');
    return row;
  }

  async createMany(rows: NewTransaction[]): Promise<TransactionRecord[]> {
    return rows.length ? this.ctx.db.insert(transactions).values(rows).returning(columns) : [];
  }

  async findById(id: string): Promise<TransactionRecord | null> {
    const [row] = await this.ctx.db.select(columns).from(transactions).where(eq(transactions.id, id));
    return row ?? null;
  }

  listByBudget(budgetId: string, range?: { from: IsoDate; to: IsoDate }): Promise<TransactionRecord[]> {
    const filters = [eq(transactions.budgetId, budgetId)];
    if (range) filters.push(gte(transactions.dueDate, range.from), lt(transactions.dueDate, range.to));
    return this.ctx.db
      .select(columns)
      .from(transactions)
      .where(and(...filters))
      .orderBy(asc(transactions.dueDate), asc(transactions.createdAt));
  }

  async updateIfVersion(
    id: string,
    expectedVersion: number,
    patch: Parameters<TransactionRepository['updateIfVersion']>[2],
  ): Promise<TransactionRecord | null> {
    const [row] = await this.ctx.db
      .update(transactions)
      .set({ ...patch, version: sql`${transactions.version} + 1` })
      .where(and(eq(transactions.id, id), eq(transactions.version, expectedVersion)))
      .returning(columns);
    return row ?? null;
  }

  async delete(id: string) {
    await this.ctx.db.delete(transactions).where(eq(transactions.id, id));
  }

  async markInvoicePaid(invoiceId: string, at: Date) {
    await this.ctx.db
      .update(transactions)
      .set({ status: 'paid', paidAt: at, version: sql`${transactions.version} + 1` })
      .where(and(eq(transactions.invoiceId, invoiceId), ne(transactions.status, 'paid')));
  }

  findReconcilable(walletId: string, from: IsoDate, to: IsoDate): Promise<TransactionRecord[]> {
    return this.ctx.db
      .select(columns)
      .from(transactions)
      .where(
        and(
          eq(transactions.walletId, walletId),
          ne(transactions.status, 'paid'),
          isNull(transactions.invoiceId),
          isNull(transactions.ofxFitid),
          gte(transactions.dueDate, from),
          lte(transactions.dueDate, to),
        ),
      );
  }

  async existingFitIds(walletId: string, fitIds: string[]): Promise<Set<string>> {
    if (!fitIds.length) return new Set();
    const rows = await this.ctx.db
      .select({ fitid: transactions.ofxFitid })
      .from(transactions)
      .where(and(eq(transactions.walletId, walletId), inArray(transactions.ofxFitid, fitIds)));
    return new Set(rows.map((r) => r.fitid).filter((f): f is string => f !== null));
  }

  async linkToBank(id: string, data: { amountCents: number; paidAt: Date; ofxFitid: string }) {
    const rows = await this.ctx.db
      .update(transactions)
      .set({ ...data, status: 'paid', version: sql`${transactions.version} + 1` })
      .where(and(eq(transactions.id, id), ne(transactions.status, 'paid')))
      .returning({ id: transactions.id });
    return rows.length === 1;
  }

  async unlinkFromBank(id: string) {
    const rows = await this.ctx.db
      .update(transactions)
      .set({ status: 'open', paidAt: null, ofxFitid: null, version: sql`${transactions.version} + 1` })
      .where(eq(transactions.id, id))
      .returning({ id: transactions.id });
    return rows.length === 1;
  }
}

@Injectable()
export class DrizzleInstallmentPlanRepository implements InstallmentPlanRepository {
  constructor(private readonly ctx: DbContext) {}

  async findByIdempotencyKey(key: string): Promise<InstallmentPlanRecord | null> {
    const [row] = await this.ctx.db.select().from(installmentPlans).where(eq(installmentPlans.idempotencyKey, key));
    return row ?? null;
  }

  async findById(id: string): Promise<InstallmentPlanRecord | null> {
    const [row] = await this.ctx.db.select().from(installmentPlans).where(eq(installmentPlans.id, id));
    return row ?? null;
  }

  async create(data: Omit<InstallmentPlanRecord, 'id' | 'createdAt'>): Promise<InstallmentPlanRecord> {
    const [row] = await this.ctx.db.insert(installmentPlans).values(data).returning();
    if (!row) throw new Error('Falha ao criar compra parcelada');
    return row;
  }

  async delete(id: string) {
    await this.ctx.db.delete(installmentPlans).where(eq(installmentPlans.id, id));
  }

  installmentsOf(planId: string): Promise<TransactionRecord[]> {
    return this.ctx.db
      .select(columns)
      .from(transactions)
      .where(eq(transactions.planId, planId))
      .orderBy(asc(transactions.installmentNo));
  }
}
