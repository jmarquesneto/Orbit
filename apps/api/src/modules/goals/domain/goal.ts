import type { IsoDate } from '../../../shared/domain/calendar.js';

export interface GoalRecord {
  id: string;
  ownerId: string;
  name: string;
  targetCents: number;
  targetDate: IsoDate | null;
  balanceCents: number;
  archivedAt: Date | null;
  createdAt: Date;
}

export type GoalMovementKind = 'deposit' | 'withdraw';

export interface GoalMovementRecord {
  id: string;
  goalId: string;
  walletId: string;
  kind: GoalMovementKind;
  amountCents: number;
  occurredOn: IsoDate;
  createdBy: string;
  createdAt: Date;
}

/** Percentual atingido (0–100, inteiro, nunca passa de 100 na exibição). */
export function goalProgress(goal: Pick<GoalRecord, 'balanceCents' | 'targetCents'>): number {
  return Math.min(100, Math.floor((goal.balanceCents * 100) / goal.targetCents));
}
