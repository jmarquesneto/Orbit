import { Module } from '@nestjs/common';
import { SharingModule } from '../sharing/sharing.module.js';
import { BudgetsService } from './application/budgets.service.js';
import { BUDGET_REPOSITORY, CATEGORY_REPOSITORY } from './application/ports.js';
import {
  DrizzleBudgetRepository,
  DrizzleCategoryRepository,
} from './infrastructure/drizzle-budgets.repositories.js';
import { BudgetsController } from './presentation/budgets.controller.js';

@Module({
  imports: [SharingModule],
  controllers: [BudgetsController],
  providers: [
    { provide: BUDGET_REPOSITORY, useClass: DrizzleBudgetRepository },
    { provide: CATEGORY_REPOSITORY, useClass: DrizzleCategoryRepository },
    BudgetsService,
  ],
  exports: [BudgetsService],
})
export class BudgetsModule {}
