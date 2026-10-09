import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { invitations } from '../../../infrastructure/database/schema.js';
import type { InvitationRecord } from '../domain/invitation.js';
import type { InvitationRepository } from '../application/ports.js';

const columns = {
  id: invitations.id,
  email: invitations.email,
  name: invitations.name,
  role: invitations.role,
  invitedBy: invitations.invitedBy,
  expiresAt: invitations.expiresAt,
  usedAt: invitations.usedAt,
  usedBy: invitations.usedBy,
  revokedAt: invitations.revokedAt,
  createdAt: invitations.createdAt,
};

@Injectable()
export class DrizzleInvitationRepository implements InvitationRepository {
  constructor(private readonly ctx: DbContext) {}

  async create(data: Parameters<InvitationRepository['create']>[0]): Promise<InvitationRecord> {
    const [row] = await this.ctx.db
      .insert(invitations)
      .values({
        tokenHash: data.tokenHash,
        email: data.email,
        name: data.name,
        role: data.role,
        invitedBy: data.invitedBy,
        expiresAt: data.expiresAt,
        createdAt: data.at,
      })
      .returning(columns);
    if (!row) throw new Error('Falha ao criar convite');
    return row;
  }

  async findByTokenHash(hash: Buffer): Promise<InvitationRecord | null> {
    const [row] = await this.ctx.db.select(columns).from(invitations).where(eq(invitations.tokenHash, hash));
    return row ?? null;
  }

  async findByTokenHashForUpdate(hash: Buffer): Promise<InvitationRecord | null> {
    const [row] = await this.ctx.db
      .select(columns)
      .from(invitations)
      .where(eq(invitations.tokenHash, hash))
      .for('update');
    return row ?? null;
  }

  async findById(id: string): Promise<InvitationRecord | null> {
    const [row] = await this.ctx.db.select(columns).from(invitations).where(eq(invitations.id, id));
    return row ?? null;
  }

  list(): Promise<InvitationRecord[]> {
    return this.ctx.db.select(columns).from(invitations).orderBy(desc(invitations.createdAt)).limit(200);
  }

  async markUsed(id: string, userId: string, at: Date) {
    await this.ctx.db.update(invitations).set({ usedAt: at, usedBy: userId }).where(eq(invitations.id, id));
  }

  async revoke(id: string, at: Date) {
    await this.ctx.db.update(invitations).set({ revokedAt: at }).where(eq(invitations.id, id));
  }
}
