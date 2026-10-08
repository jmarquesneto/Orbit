import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { SharingModule } from '../sharing/sharing.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { OfxService } from './application/ofx.service.js';
import { OFX_PARSER, OFX_REPOSITORY } from './application/ports.js';
import { DrizzleOfxRepository } from './infrastructure/drizzle-ofx.repository.js';
import { WorkerOfxParser } from './infrastructure/worker-ofx-parser.js';
import { OfxController } from './presentation/ofx.controller.js';

@Module({
  imports: [SharingModule, BudgetsModule, WalletsModule, TransactionsModule],
  controllers: [OfxController],
  providers: [
    { provide: OFX_PARSER, useClass: WorkerOfxParser },
    { provide: OFX_REPOSITORY, useClass: DrizzleOfxRepository },
    OfxService,
  ],
})
export class OfxModule {}
