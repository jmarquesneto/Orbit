import type { ShareRoleCode } from '../../sharing/domain/permissions.js';
import type { GoalMovementRecord, GoalRecord } from '../domain/goal.js';

export interface GoalRepository {
  create(data: Pick<GoalRecord, 'ownerId' | 'name' | 'targetCents' | 'targetDate'>): Promise<GoalRecord>;
  findById(id: string): Promise<GoalRecord | null>;
  listVisible(userId: string, now: Date): Promise<(GoalRecord & { role: 'owner' | ShareRoleCode })[]>;
  update(id: string, patch: Partial<Pick<GoalRecord, 'name' | 'targetCents' | 'targetDate'>>): Promise<void>;
  archive(id: string, at: Date): Promise<void>;
  /** Soma atômica; com saldo insuficiente não altera nada e devolve false. */
  adjustBalance(id: string, deltaCents: number): Promise<boolean>;
  addMovement(data: Omit<GoalMovementRecord, 'id' | 'createdAt'>): Promise<GoalMovementRecord>;
  listMovements(goalId: string): Promise<GoalMovementRecord[]>;
}
export const GOAL_REPOSITORY = Symbol('GOAL_REPOSITORY');
