import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from './config/config.module.js';
import { RedisModule } from './infrastructure/cache/redis.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { PlatformModule } from './infrastructure/platform/platform.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BudgetsModule } from './modules/budgets/budgets.module.js';
import { GoalsModule } from './modules/goals/goals.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InvitationsModule } from './modules/invitations/invitations.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';
import { OfxModule } from './modules/ofx/ofx.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { SharingModule } from './modules/sharing/sharing.module.js';
import { TransactionsModule } from './modules/transactions/transactions.module.js';
import { TransfersModule } from './modules/transfers/transfers.module.js';
import { WalletsModule } from './modules/wallets/wallets.module.js';
import { DomainExceptionFilter } from './shared/presentation/domain-exception.filter.js';
import { OriginCheckMiddleware } from './shared/presentation/origin-check.middleware.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    PlatformModule,
    AuditModule,
    HealthModule,
    AuthModule,
    SettingsModule,
    InvitationsModule,
    SharingModule,
    BudgetsModule,
    WalletsModule,
    TransactionsModule,
    TransfersModule,
    GoalsModule,
    OfxModule,
    MaintenanceModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(OriginCheckMiddleware).forRoutes('*path');
  }
}
