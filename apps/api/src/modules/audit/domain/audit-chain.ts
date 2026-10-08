import { createHash } from 'node:crypto';

export interface ChainedAuditRecord {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  diff: Record<string, unknown> | null;
  createdAt: Date;
}

/** JSON com chaves ordenadas: o mesmo conteúdo sempre gera o mesmo hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** row_hash = SHA-256(prev_hash ‖ registro canônico). Alterar qualquer linha quebra a cadeia. */
export function computeRowHash(prevHash: Buffer | null, record: ChainedAuditRecord): Buffer {
  return createHash('sha256')
    .update(prevHash ?? Buffer.alloc(0))
    .update(canonicalJson(record), 'utf8')
    .digest();
}

/** Recalcula a cadeia inteira; devolve o id da primeira linha adulterada, se houver. */
export function findBrokenLink(
  rows: (ChainedAuditRecord & { id: number; prevHash: Buffer | null; rowHash: Buffer })[],
): number | null {
  let expectedPrev: Buffer | null = null;
  for (const row of rows) {
    const prevMatches =
      expectedPrev === null ? row.prevHash === null : !!row.prevHash?.equals(expectedPrev);
    const record: ChainedAuditRecord = {
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      ip: row.ip,
      diff: row.diff,
      createdAt: row.createdAt,
    };
    if (!prevMatches || !computeRowHash(row.prevHash, record).equals(row.rowHash)) return row.id;
    expectedPrev = row.rowHash;
  }
  return null;
}
