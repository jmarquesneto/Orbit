import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { sessions } from '../../../infrastructure/database/schema.js';
import type { SessionRecord, SessionRepository } from '../application/ports.js';

const columns = {
  id: sessions.id,
  userId: sessions.userId,
  familyId: sessions.familyId,
  expiresAt: sessions.expiresAt,
  revokedAt: sessions.revokedAt,
};

@Injectable()
export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly ctx: DbContext) {}

  async create(data: Parameters<SessionRepository['create']>[0]): Promise<SessionRecord> {
    const [row] = await this.ctx.db
      .insert(sessions)
      .values({
        userId: data.userId,
        familyId: data.familyId,
        refreshHash: data.refreshHash,
        ip: data.ip,
        userAgent: data.userAgent,
        expiresAt: data.expiresAt,
        createdAt: data.at,
      })
      .returning(columns);
    if (!row) throw new Error('Falha ao criar sessão');
    return row;
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const [row] = await this.ctx.db.select(columns).from(sessions).where(eq(sessions.id, id));
    return row ?? null;
  }

  async findByRefreshHashForUpdate(hash: Buffer): Promise<SessionRecord | null> {
    const [row] = await this.ctx.db
      .select(columns)
      .from(sessions)
      .where(eq(sessions.refreshHash, hash))
      .for('update');
    return row ?? null;
  }

  async revoke(id: string, at: Date) {
    await this.ctx.db
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  async revokeFamily(familyId: string, at: Date) {
    await this.ctx.db
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
  }

  async revokeAllForUser(userId: string, at: Date) {
    await this.ctx.db
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}
