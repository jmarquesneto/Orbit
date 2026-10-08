import { canonicalJson, type ChainedAuditRecord, computeRowHash, findBrokenLink } from './audit-chain.js';

function buildChain(records: ChainedAuditRecord[]) {
  let prev: Buffer | null = null;
  return records.map((record, i) => {
    const rowHash = computeRowHash(prev, record);
    const row = { ...record, id: i + 1, prevHash: prev, rowHash };
    prev = rowHash;
    return row;
  });
}

const base = (action: string, diff: Record<string, unknown> | null = null): ChainedAuditRecord => ({
  actorId: null,
  action,
  entityType: 'system_setting',
  entityId: 'app.name',
  ip: '203.0.113.7',
  diff,
  createdAt: new Date('2026-10-08T12:00:00Z'),
});

describe('cadeia de hashes da auditoria', () => {
  it('canonicalJson independe da ordem das chaves', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('uma cadeia íntegra não tem elo quebrado', () => {
    const rows = buildChain([base('a'), base('b'), base('c')]);
    expect(findBrokenLink(rows)).toBeNull();
  });

  it('detecta alteração no conteúdo de uma linha', () => {
    const rows = buildChain([base('a'), base('settings.update', { to: 'Orbit' }), base('c')]);
    rows[1]!.diff = { to: 'Outro nome' };
    expect(findBrokenLink(rows)).toBe(2);
  });

  it('detecta remoção de uma linha do meio', () => {
    const rows = buildChain([base('a'), base('b'), base('c')]);
    expect(findBrokenLink([rows[0]!, rows[2]!])).toBe(3);
  });
});
