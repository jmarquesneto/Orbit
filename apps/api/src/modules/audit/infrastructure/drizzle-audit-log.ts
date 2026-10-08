import { Inject, Injectable } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { auditLogs } from '../../../infrastructure/database/schema.js';
import { CLOCK, type AuditEntry, type AuditLog, type Clock } from '../../../shared/application/ports.js';
import { computeRowHash } from '../domain/audit-chain.js';

/** Chave fixa do advisory lock que serializa a cadeia de hashes. */
const AUDIT_CHAIN_LOCK = 7_301_001;

@Injectable()
export class DrizzleAuditLog implements AuditLog {
  constructor(
    private readonly ctx: DbContext,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Grava na transação corrente (ou abre uma): a auditoria só existe se a ação existir. */
  record(entry: AuditEntry): Promise<void> {
    return this.ctx.run(async () => {
      const db = this.ctx.db;
      await db.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`);
      const [last] = await db
        .select({ rowHash: auditLogs.rowHash })
        .from(auditLogs)
        .orderBy(desc(auditLogs.id))
        .limit(1);

      // Precisão de milissegundos, igual à que o Postgres devolve, para a cadeia ser verificável.
      const createdAt = new Date(this.clock.now().getTime());
      const record = {
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        ip: entry.ip ?? null,
        diff: entry.diff ?? null,
        createdAt,
      };
      const prevHash = last?.rowHash ?? null;
      await db.insert(auditLogs).values({
        ...record,
        prevHash,
        rowHash: computeRowHash(prevHash, record),
      });
    });
  }
}
