import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK,
  type Clock,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import { type IsoDate } from '../../../shared/domain/calendar.js';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import { AccessControlService } from '../../sharing/application/access-control.service.js';
import type { AccessGrant } from '../../sharing/domain/permissions.js';
import { WalletsService } from '../../wallets/application/wallets.service.js';
import {
  type GoalMovementKind,
  type GoalMovementRecord,
  goalProgress,
  type GoalRecord,
} from '../domain/goal.js';
import { GOAL_REPOSITORY, type GoalRepository } from './ports.js';

export type GoalView = GoalRecord & {
  progressPercent: number;
  role: AccessGrant['role'];
  permissions: AccessGrant['can'];
};

/** Caixinhas: dinheiro sai de uma carteira e entra na caixinha (e vice-versa). */
@Injectable()
export class GoalsService {
  constructor(
    @Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
    private readonly wallets: WalletsService,
  ) {}

  create(
    actorId: string,
    input: { name: string; targetCents: number; targetDate?: IsoDate | null },
  ): Promise<GoalView> {
    return this.tx.runAs(actorId, async () => {
      const goal = await this.goals.create({
        ownerId: actorId,
        name: input.name,
        targetCents: input.targetCents,
        targetDate: input.targetDate ?? null,
      });
      return this.view(actorId, goal);
    });
  }

  list(actorId: string) {
    return this.tx.runAs(actorId, async () =>
      (await this.goals.listVisible(actorId, this.clock.now())).map((g) => ({
        ...g,
        progressPercent: goalProgress(g),
      })),
    );
  }

  get(actorId: string, id: string): Promise<GoalView> {
    return this.tx.runAs(actorId, async () => this.view(actorId, await this.mustFind(id)));
  }

  update(
    actorId: string,
    id: string,
    patch: { name?: string; targetCents?: number; targetDate?: IsoDate | null },
  ): Promise<GoalView> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'goal', id, 'update');
      await this.goals.update(id, patch);
      return this.view(actorId, await this.mustFind(id));
    });
  }

  archive(actorId: string, id: string): Promise<void> {
    return this.tx.runAs(actorId, async () => {
      await this.access.requireOwner(actorId, 'goal', id);
      await this.goals.archive(id, this.clock.now());
    });
  }

  /**
   * Depósito: debita a carteira e credita a caixinha. Resgate: o contrário, limitado ao saldo.
   * A carteira precisa ser de quem movimenta — num compartilhamento, cada um usa a sua.
   */
  move(
    actorId: string,
    goalId: string,
    input: { walletId: string; kind: GoalMovementKind; amountCents: number; occurredOn: IsoDate },
  ): Promise<{ goal: GoalView; movement: GoalMovementRecord }> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'goal', goalId, 'create');
      await this.mustFind(goalId);
      const wallet = await this.wallets.requireSpendable(input.walletId);

      const sign = input.kind === 'deposit' ? 1 : -1;
      const ok = await this.goals.adjustBalance(goalId, sign * input.amountCents);
      if (!ok) throw new ConflictError('Saldo da caixinha insuficiente para este resgate.');
      await this.wallets.adjustBalance(wallet.id, -sign * input.amountCents);

      const movement = await this.goals.addMovement({
        goalId,
        walletId: wallet.id,
        kind: input.kind,
        amountCents: input.amountCents,
        occurredOn: input.occurredOn,
        createdBy: actorId,
      });
      return { goal: await this.view(actorId, await this.mustFind(goalId)), movement };
    });
  }

  listMovements(actorId: string, goalId: string): Promise<GoalMovementRecord[]> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, 'goal', goalId, 'read');
      return this.goals.listMovements(goalId);
    });
  }

  private async mustFind(id: string): Promise<GoalRecord> {
    const goal = await this.goals.findById(id);
    if (!goal || goal.archivedAt) throw new NotFoundError('Caixinha não encontrada.');
    return goal;
  }

  private async view(actorId: string, goal: GoalRecord): Promise<GoalView> {
    const grant = await this.access.require(actorId, 'goal', goal.id, 'read');
    return { ...goal, progressPercent: goalProgress(goal), role: grant.role, permissions: grant.can };
  }
}
