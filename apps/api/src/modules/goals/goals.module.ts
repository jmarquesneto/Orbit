import { Module } from '@nestjs/common';
import { SharingModule } from '../sharing/sharing.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { GoalsService } from './application/goals.service.js';
import { GOAL_REPOSITORY } from './application/ports.js';
import { DrizzleGoalRepository } from './infrastructure/drizzle-goal.repository.js';
import { GoalsController } from './presentation/goals.controller.js';

@Module({
  imports: [SharingModule, WalletsModule],
  controllers: [GoalsController],
  providers: [{ provide: GOAL_REPOSITORY, useClass: DrizzleGoalRepository }, GoalsService],
})
export class GoalsModule {}
