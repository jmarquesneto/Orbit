import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { SharingModule } from '../sharing/sharing.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { MAINTENANCE_REPOSITORY } from './application/ports.js';
import { MaintenanceService } from './application/maintenance.service.js';
import { DrizzleMaintenanceRepository } from './infrastructure/drizzle-maintenance.repository.js';
import { MaintenanceController } from './presentation/maintenance.controller.js';

/** Manutenção residencial: equipamentos, tarefas recorrentes e histórico com custos. */
@Module({
  imports: [AuthModule, SharingModule, BudgetsModule, WalletsModule, TransactionsModule],
  controllers: [MaintenanceController],
  providers: [{ provide: MAINTENANCE_REPOSITORY, useClass: DrizzleMaintenanceRepository }, MaintenanceService],
})
export class MaintenanceModule {}
