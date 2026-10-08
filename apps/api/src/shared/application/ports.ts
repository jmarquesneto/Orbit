/**
 * Portas compartilhadas entre módulos. Os casos de uso dependem só destas interfaces;
 * as implementações concretas ficam em infrastructure/ e são injetadas pelo Nest.
 */

export interface Clock {
  now(): Date;
}
export const CLOCK = Symbol('CLOCK');

/** Executa o callback numa transação SQL. Chamadas aninhadas reutilizam a transação aberta. */
export interface TransactionRunner {
  run<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Transação "em nome de" um usuário: ativa o Row-Level Security do Postgres para ele.
   * Todo acesso a dados financeiros passa por aqui.
   */
  runAs<T>(userId: string, fn: () => Promise<T>): Promise<T>;
}
export const TRANSACTION_RUNNER = Symbol('TRANSACTION_RUNNER');

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Consome 1 unidade da janela `key`; bloqueia ao passar de `limit` em `windowSeconds`. */
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}
export const RATE_LIMITER = Symbol('RATE_LIMITER');

/** Quem está agindo e de onde — vai para a auditoria e para as sessões. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  /** Só metadados e valores não sensíveis. Nunca senhas, tokens ou hashes. */
  diff?: Record<string, unknown> | null;
}

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}
export const AUDIT_LOG = Symbol('AUDIT_LOG');

/** Dados temporários com prazo de validade (desafios de login, cadastros em andamento). */
export interface EphemeralStore {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
  /** Lê e apaga numa operação só: um desafio nunca é usado duas vezes. */
  take(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
}
export const EPHEMERAL_STORE = Symbol('EPHEMERAL_STORE');
