import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { SharingModule } from '../sharing/sharing.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { CardPurchasesService } from './application/card-purchases.service.js';
import { INSTALLMENT_PLAN_REPOSITORY, TRANSACTION_REPOSITORY } from './application/ports.js';
import { TransactionsService } from './application/transactions.service.js';
import {
  DrizzleInstallmentPlanRepository,
  DrizzleTransactionRepository,
} from './infrastructure/drizzle-transactions.repositories.js';
import { CardPurchasesController, TransactionsController } from './presentation/transactions.controllers.js';

/** Lançamentos: liga orçamentos (onde o gasto conta) a carteiras e faturas (de onde sai). */
@Module({
  imports: [SharingModule, BudgetsModule, WalletsModule],
  controllers: [TransactionsController, CardPurchasesController],
  providers: [
    { provide: TRANSACTION_REPOSITORY, useClass: DrizzleTransactionRepository },
    { provide: INSTALLMENT_PLAN_REPOSITORY, useClass: DrizzleInstallmentPlanRepository },
    TransactionsService,
    CardPurchasesService,
  ],
  exports: [TRANSACTION_REPOSITORY],
})
export class TransactionsModule {}
