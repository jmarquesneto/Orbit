import { Injectable } from '@nestjs/common';
import { desc, eq, or } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { transfers } from '../../../infrastructure/database/schema.js';
import type { TransferRepository } from '../application/ports.js';
import type { TransferRecord } from '../domain/transfer.js';

@Injectable()
export class DrizzleTransferRepository implements TransferRepository {
  constructor(private readonly ctx: DbContext) {}

  async create(data: Parameters<TransferRepository['create']>[0]): Promise<TransferRecord> {
    const [row] = await this.ctx.db.insert(transfers).values(data).returning();
    if (!row) throw new Error('Falha ao criar transferência');
    return row;
  }

  async findById(id: string): Promise<TransferRecord | null> {
    const [row] = await this.ctx.db.select().from(transfers).where(eq(transfers.id, id));
    return row ?? null;
  }

  list(filter: { walletId?: string; limit: number }): Promise<TransferRecord[]> {
    const where = filter.walletId
      ? or(eq(transfers.fromWalletId, filter.walletId), eq(transfers.toWalletId, filter.walletId))
      : undefined;
    return this.ctx.db
      .select()
      .from(transfers)
      .where(where)
      .orderBy(desc(transfers.occurredOn), desc(transfers.createdAt))
      .limit(filter.limit);
  }

  async delete(id: string): Promise<void> {
    await this.ctx.db.delete(transfers).where(eq(transfers.id, id));
  }
}
