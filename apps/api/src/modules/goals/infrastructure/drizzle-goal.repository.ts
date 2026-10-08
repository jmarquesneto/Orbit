import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, isNull, or, sql } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { goalMovements, goals, resourceShares } from '../../../infrastructure/database/schema.js';
import type { ShareRoleCode } from '../../sharing/domain/permissions.js';
import type { GoalMovementRecord, GoalRecord } from '../domain/goal.js';
import type { GoalRepository } from '../application/ports.js';

@Injectable()
export class DrizzleGoalRepository implements GoalRepository {
  constructor(private readonly ctx: DbContext) {}

  async create(data: Parameters<GoalRepository['create']>[0]): Promise<GoalRecord> {
    const [row] = await this.ctx.db.insert(goals).values(data).returning();
    if (!row) throw new Error('Falha ao criar caixinha');
    return row;
  }

  async findById(id: string): Promise<GoalRecord | null> {
    const [row] = await this.ctx.db.select().from(goals).where(eq(goals.id, id));
    return row ?? null;
  }

  async listVisible(userId: string, now: Date) {
    const rows = await this.ctx.db
      .select({ goal: goals, shareRole: resourceShares.roleCode })
      .from(goals)
      .leftJoin(
        resourceShares,
        and(
          eq(resourceShares.resourceType, 'goal'),
          eq(resourceShares.resourceId, goals.id),
          eq(resourceShares.granteeId, userId),
          isNull(resourceShares.revokedAt),
          or(isNull(resourceShares.expiresAt), gt(resourceShares.expiresAt, now)),
        ),
      )
      .where(isNull(goals.archivedAt))
      .orderBy(asc(goals.createdAt));
    return rows.map(({ goal, shareRole }) => ({
      ...goal,
      role: goal.ownerId === userId ? ('owner' as const) : (shareRole as ShareRoleCode),
    }));
  }

  async update(id: string, patch: Parameters<GoalRepository['update']>[1]) {
    if (Object.keys(patch).length) await this.ctx.db.update(goals).set(patch).where(eq(goals.id, id));
  }

  async archive(id: string, at: Date) {
    await this.ctx.db.update(goals).set({ archivedAt: at }).where(eq(goals.id, id));
  }

  async adjustBalance(id: string, deltaCents: number): Promise<boolean> {
    const rows = await this.ctx.db
      .update(goals)
      .set({ balanceCents: sql`${goals.balanceCents} + ${deltaCents}` })
      .where(and(eq(goals.id, id), gte(sql`${goals.balanceCents} + ${deltaCents}`, 0)))
      .returning({ id: goals.id });
    return rows.length === 1;
  }

  async addMovement(data: Omit<GoalMovementRecord, 'id' | 'createdAt'>): Promise<GoalMovementRecord> {
    const [row] = await this.ctx.db.insert(goalMovements).values(data).returning();
    if (!row) throw new Error('Falha ao registrar movimentação');
    return row;
  }

  listMovements(goalId: string): Promise<GoalMovementRecord[]> {
    return this.ctx.db
      .select()
      .from(goalMovements)
      .where(eq(goalMovements.goalId, goalId))
      .orderBy(desc(goalMovements.occurredOn), desc(goalMovements.createdAt));
  }
}
