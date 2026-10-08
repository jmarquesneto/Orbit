import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.schema.js';

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
          // Sempre consultas parametrizadas; nada de multi-statement vindo do app.
          statement_timeout: 10_000,
          application_name: 'api',
        }),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
