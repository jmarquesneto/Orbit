import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { RedisModule } from './infrastructure/cache/redis.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule, HealthModule],
})
export class AppModule {}
