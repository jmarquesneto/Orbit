import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../infrastructure/database/database.module.js';
import type { DependencyProbe } from '../domain/dependency-probe.js';

@Injectable()
export class PostgresProbe implements DependencyProbe {
  readonly name = 'database';

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async check(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}
