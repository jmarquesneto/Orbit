import { Module } from '@nestjs/common';
import { CheckReadinessUseCase } from './application/check-readiness.use-case.js';
import { DEPENDENCY_PROBES, type DependencyProbe } from './domain/dependency-probe.js';
import { PostgresProbe } from './infrastructure/postgres.probe.js';
import { RedisProbe } from './infrastructure/redis.probe.js';
import { HealthController } from './presentation/health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    PostgresProbe,
    RedisProbe,
    {
      provide: DEPENDENCY_PROBES,
      inject: [PostgresProbe, RedisProbe],
      useFactory: (...probes: DependencyProbe[]) => probes,
    },
    CheckReadinessUseCase,
  ],
})
export class HealthModule {}
