import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.schema.js';
import { TRANSACTION_RUNNER } from '../../shared/application/ports.js';
import { DbContext, DRIZZLE } from './db-context.js';
import * as schema from './schema.js';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Pool({
          host: env.DB_HOST,
          port: env.DB_PORT,
          database: env.DB_NAME,
          user: env.DB_APP_USER,
          password: env.DB_APP_PASSWORD,
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          // Todas as consultas passam pelo Drizzle, sempre parametrizadas.
          statement_timeout: 10_000,
          application_name: 'api',
        }),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
    },
    DbContext,
    { provide: TRANSACTION_RUNNER, useExisting: DbContext },
  ],
  exports: [PG_POOL, DRIZZLE, DbContext, TRANSACTION_RUNNER],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
