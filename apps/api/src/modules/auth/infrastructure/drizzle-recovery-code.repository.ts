import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { mfaRecoveryCodes } from '../../../infrastructure/database/schema.js';
import type { RecoveryCodeRepository } from '../application/ports.js';

@Injectable()
export class DrizzleRecoveryCodeRepository implements RecoveryCodeRepository {
  constructor(private readonly ctx: DbContext) {}

  async replaceAll(userId: string, hashes: Buffer[]) {
    await this.ctx.db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    if (hashes.length) {
      await this.ctx.db.insert(mfaRecoveryCodes).values(hashes.map((codeHash) => ({ userId, codeHash })));
    }
  }

  async consume(userId: string, hash: Buffer, at: Date): Promise<boolean> {
    const rows = await this.ctx.db
      .update(mfaRecoveryCodes)
      .set({ usedAt: at })
      .where(
        and(
          eq(mfaRecoveryCodes.userId, userId),
          eq(mfaRecoveryCodes.codeHash, hash),
          isNull(mfaRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: mfaRecoveryCodes.id });
    return rows.length === 1;
  }

  async countUnused(userId: string): Promise<number> {
    const [row] = await this.ctx.db
      .select({ n: count() })
      .from(mfaRecoveryCodes)
      .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)));
    return row?.n ?? 0;
  }

  async deleteAll(userId: string) {
    await this.ctx.db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
  }
}
