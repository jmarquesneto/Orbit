import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { isUniqueViolation } from '../../../infrastructure/database/pg-errors.js';
import { budgets, goals, resourceShares, shareRoles, users } from '../../../infrastructure/database/schema.js';
import { ConflictError } from '../../../shared/domain/errors.js';
import type { ResourceType, ShareRoleCode } from '../domain/permissions.js';
import type { ShareRecord, ShareRoleRecord, SharingRepository } from '../application/ports.js';

const shareColumns = {
  id: resourceShares.id,
  resourceType: resourceShares.resourceType,
  resourceId: resourceShares.resourceId,
  granteeId: resourceShares.granteeId,
  granteeEmail: users.email,
  roleCode: resourceShares.roleCode,
  grantedBy: resourceShares.grantedBy,
  expiresAt: resourceShares.expiresAt,
  revokedAt: resourceShares.revokedAt,
  createdAt: resourceShares.createdAt,
};

type ShareRow = Omit<ShareRecord, 'roleCode'> & { roleCode: string };
const asRecord = (row: ShareRow): ShareRecord => ({ ...row, roleCode: row.roleCode as ShareRoleCode });
const asRole = (row: typeof shareRoles.$inferSelect): ShareRoleRecord => ({
  ...row,
  code: row.code as ShareRoleCode,
});

@Injectable()
export class DrizzleSharingRepository implements SharingRepository {
  constructor(private readonly ctx: DbContext) {}

  async findOwnerId(type: ResourceType, id: string): Promise<string | null> {
    const table = type === 'budget' ? budgets : goals;
    const [row] = await this.ctx.db
      .select({ ownerId: table.ownerId })
      .from(table)
      .where(and(eq(table.id, id), isNull(table.archivedAt)));
    return row?.ownerId ?? null;
  }

  async findActiveShareRole(type: ResourceType, id: string, userId: string, now: Date) {
    const [row] = await this.ctx.db
      .select({ role: shareRoles })
      .from(resourceShares)
      .innerJoin(shareRoles, eq(shareRoles.code, resourceShares.roleCode))
      .where(
        and(
          eq(resourceShares.resourceType, type),
          eq(resourceShares.resourceId, id),
          eq(resourceShares.granteeId, userId),
          isNull(resourceShares.revokedAt),
          or(isNull(resourceShares.expiresAt), gt(resourceShares.expiresAt, now)),
        ),
      );
    return row ? asRole(row.role) : null;
  }

  async listRoles(): Promise<ShareRoleRecord[]> {
    return (await this.ctx.db.select().from(shareRoles).orderBy(asc(shareRoles.code))).map(asRole);
  }

  async findRole(code: string): Promise<ShareRoleRecord | null> {
    const [row] = await this.ctx.db.select().from(shareRoles).where(eq(shareRoles.code, code));
    return row ? asRole(row) : null;
  }

  async listActiveForResource(type: ResourceType, id: string, now: Date): Promise<ShareRecord[]> {
    const rows = await this.ctx.db
      .select(shareColumns)
      .from(resourceShares)
      .innerJoin(users, eq(users.id, resourceShares.granteeId))
      .where(
        and(
          eq(resourceShares.resourceType, type),
          eq(resourceShares.resourceId, id),
          isNull(resourceShares.revokedAt),
          or(isNull(resourceShares.expiresAt), gt(resourceShares.expiresAt, now)),
        ),
      )
      .orderBy(asc(resourceShares.createdAt));
    return rows.map(asRecord);
  }

  async findById(id: string): Promise<ShareRecord | null> {
    const [row] = await this.ctx.db
      .select(shareColumns)
      .from(resourceShares)
      .innerJoin(users, eq(users.id, resourceShares.granteeId))
      .where(eq(resourceShares.id, id));
    return row ? asRecord(row) : null;
  }

  async create(data: Parameters<SharingRepository['create']>[0]): Promise<ShareRecord> {
    try {
      const [row] = await this.ctx.db
        .insert(resourceShares)
        .values({
          resourceType: data.type,
          resourceId: data.resourceId,
          granteeId: data.granteeId,
          roleCode: data.roleCode,
          grantedBy: data.grantedBy,
          expiresAt: data.expiresAt,
        })
        .returning({ id: resourceShares.id });
      const created = row && (await this.findById(row.id));
      if (!created) throw new Error('Falha ao compartilhar');
      return created;
    } catch (err) {
      if (isUniqueViolation(err, 'resource_shares_active_unique')) {
        throw new ConflictError('Esta pessoa já tem acesso. Revogue o acesso atual para trocar o papel.');
      }
      throw err;
    }
  }

  async revoke(id: string, at: Date) {
    await this.ctx.db.update(resourceShares).set({ revokedAt: at }).where(eq(resourceShares.id, id));
  }
}
