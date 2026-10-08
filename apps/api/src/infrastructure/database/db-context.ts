import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { TransactionRunner } from '../../shared/application/ports.js';
import type * as schema from './schema.js';

export const DRIZZLE = Symbol('DRIZZLE');

export type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

/**
 * Unidade de trabalho: os repositórios pedem `db` e recebem a transação corrente
 * (se houver) sem que o caso de uso precise passá-la adiante.
 */
@Injectable()
export class DbContext implements TransactionRunner {
  private readonly current = new AsyncLocalStorage<Transaction>();

  constructor(@Inject(DRIZZLE) private readonly root: Database) {}

  get db(): Executor {
    return this.current.getStore() ?? this.root;
  }

  get inTransaction(): boolean {
    return this.current.getStore() !== undefined;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn();
    return this.root.transaction((tx) => this.current.run(tx, fn));
  }
}
