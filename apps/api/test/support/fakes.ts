import { randomUUID } from 'node:crypto';
import type {
  AuditEntry,
  AuditLog,
  Clock,
  EphemeralStore,
  RateLimiter,
  TransactionRunner,
} from '../../src/shared/application/ports.js';
import type {
  AccessTokenClaims,
  AccessTokenService,
  PasswordHasher,
  QrRenderer,
  RecoveryCodeRepository,
  SecretCipher,
  SessionRecord,
  SessionRepository,
  UserRepository,
} from '../../src/modules/auth/application/ports.js';
import type { UserRecord, UserStatus } from '../../src/modules/auth/domain/user.js';
import type { InvitationRepository } from '../../src/modules/invitations/application/ports.js';
import type { InvitationRecord } from '../../src/modules/invitations/domain/invitation.js';
import type { BrandingCache, SettingsRepository, StoredSetting } from '../../src/modules/settings/application/ports.js';
import type { Branding } from '../../src/modules/settings/domain/setting-definitions.js';

export class FixedClock implements Clock {
  constructor(private current = new Date('2026-10-08T12:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Sem rollback: suficiente para testar regras; a atomicidade real é do Postgres. */
export const passthroughTx: TransactionRunner = { run: (fn) => fn(), runAs: (_user, fn) => fn() };

export class RecordingAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];
  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
}

export class CountingRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, number>();
  async consume(key: string, limit: number) {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return { allowed: n <= limit, retryAfterSeconds: 60 };
  }
}

export const fakeHasher: PasswordHasher = {
  hash: async (p) => `hashed:${p}`,
  verify: async (h, p) => h === `hashed:${p}`,
};

/** "JWT" falso: só JSON em base64; assinatura é responsabilidade do adaptador real (testado à parte). */
export const fakeTokens: AccessTokenService = {
  sign: async (claims) => Buffer.from(JSON.stringify(claims)).toString('base64url'),
  verify: async (token) => {
    try {
      return JSON.parse(Buffer.from(token, 'base64url').toString()) as AccessTokenClaims;
    } catch {
      throw new Error('invalid');
    }
  },
};

export class InMemoryUsers implements UserRepository {
  readonly rows = new Map<string, UserRecord>();

  seed(partial: Partial<UserRecord> & { email: string; password?: string }): UserRecord {
    const user: UserRecord = {
      id: randomUUID(),
      passwordHash: `hashed:${partial.password ?? 'senha-correta-123'}`,
      role: 'user',
      status: 'active',
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      mfaEnabled: false,
      mfaSecret: null,
      mfaLastStep: null,
      ...partial,
    };
    this.rows.set(user.id, user);
    return user;
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByEmail(email: string) {
    return [...this.rows.values()].find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }
  async create(data: Parameters<UserRepository['create']>[0]) {
    return this.seed({ email: data.email, passwordHash: data.passwordHash, role: data.role, createdAt: data.at });
  }
  async updateLoginState(id: string, state: Parameters<UserRepository['updateLoginState']>[1]) {
    const u = this.rows.get(id);
    if (u) this.rows.set(id, { ...u, ...state });
  }
  async updateStatus(id: string, status: UserStatus) {
    const u = this.rows.get(id);
    if (u) this.rows.set(id, { ...u, status });
  }
  async list() {
    return [...this.rows.values()];
  }
  async setMfa(id: string, data: Parameters<UserRepository['setMfa']>[1]) {
    const u = this.rows.get(id);
    if (u) this.rows.set(id, { ...u, mfaEnabled: data.enabled, mfaSecret: data.secret, mfaLastStep: data.lastStep });
  }
  async setMfaLastStep(id: string, step: number) {
    const u = this.rows.get(id);
    if (u) this.rows.set(id, { ...u, mfaLastStep: step });
  }
  async countAdmins() {
    return [...this.rows.values()].filter((u) => u.role === 'admin').length;
  }
}

export class InMemorySessions implements SessionRepository {
  readonly rows = new Map<string, SessionRecord & { refreshHash: Buffer }>();

  async create(data: Parameters<SessionRepository['create']>[0]) {
    const row = {
      id: randomUUID(),
      userId: data.userId,
      familyId: data.familyId,
      refreshHash: data.refreshHash,
      expiresAt: data.expiresAt,
      revokedAt: null,
      mfaVerifiedAt: data.mfaVerifiedAt ?? null,
    };
    this.rows.set(row.id, row);
    return row;
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async markMfaVerified(id: string, at: Date) {
    const s = this.rows.get(id);
    if (s) s.mfaVerifiedAt = at;
  }
  async findByRefreshHashForUpdate(hash: Buffer) {
    return [...this.rows.values()].find((s) => s.refreshHash.equals(hash)) ?? null;
  }
  private revokeWhere(pred: (s: SessionRecord) => boolean, at: Date) {
    for (const s of this.rows.values()) if (pred(s) && !s.revokedAt) s.revokedAt = at;
  }
  async revoke(id: string, at: Date) {
    this.revokeWhere((s) => s.id === id, at);
  }
  async revokeFamily(familyId: string, at: Date) {
    this.revokeWhere((s) => s.familyId === familyId, at);
  }
  async revokeAllForUser(userId: string, at: Date) {
    this.revokeWhere((s) => s.userId === userId, at);
  }
  active(): SessionRecord[] {
    return [...this.rows.values()].filter((s) => !s.revokedAt);
  }
}

export class InMemoryInvitations implements InvitationRepository {
  readonly rows = new Map<string, InvitationRecord & { tokenHash: Buffer }>();

  async create(data: Parameters<InvitationRepository['create']>[0]) {
    const row = {
      id: randomUUID(),
      tokenHash: data.tokenHash,
      email: data.email,
      role: data.role,
      invitedBy: data.invitedBy,
      expiresAt: data.expiresAt,
      usedAt: null,
      usedBy: null,
      revokedAt: null,
      createdAt: data.at,
    };
    this.rows.set(row.id, row);
    return row;
  }
  async findByTokenHash(hash: Buffer) {
    return [...this.rows.values()].find((i) => i.tokenHash.equals(hash)) ?? null;
  }
  findByTokenHashForUpdate(hash: Buffer) {
    return this.findByTokenHash(hash);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async markUsed(id: string, userId: string, at: Date) {
    const i = this.rows.get(id);
    if (i) Object.assign(i, { usedAt: at, usedBy: userId });
  }
  async revoke(id: string, at: Date) {
    const i = this.rows.get(id);
    if (i) i.revokedAt = at;
  }
}

export class InMemorySettings implements SettingsRepository {
  readonly rows = new Map<string, StoredSetting>();
  readonly revisions: Parameters<SettingsRepository['insertRevision']>[0][] = [];

  constructor() {
    const at = new Date('2026-01-01T00:00:00Z');
    const seed = (key: string, value: unknown, isPublic: boolean) =>
      this.rows.set(key, { key, value, isPublic, version: 1, updatedBy: null, updatedAt: at });
    seed('app.name', 'Orbit', true);
    seed('app.accent', '#3DD6C3', true);
    seed('app.logo_url', null, true);
    seed('invite.ttl_hours', 72, false);
    seed('security.mfa_required', true, false);
  }
  async findAll() {
    return [...this.rows.values()];
  }
  async findPublic() {
    return [...this.rows.values()].filter((s) => s.isPublic);
  }
  async find(key: string) {
    return this.rows.get(key) ?? null;
  }
  findForUpdate(key: string) {
    return this.find(key);
  }
  async update(key: string, value: unknown, nextVersion: number, actorId: string, at: Date) {
    const s = this.rows.get(key);
    if (s) this.rows.set(key, { ...s, value, version: nextVersion, updatedBy: actorId, updatedAt: at });
  }
  async insertRevision(rev: Parameters<SettingsRepository['insertRevision']>[0]) {
    this.revisions.push(rev);
  }
}

export class MemoryBrandingCache implements BrandingCache {
  value: Branding | null = null;
  invalidations = 0;
  async get() {
    return this.value;
  }
  async set(b: Branding) {
    this.value = b;
  }
  async invalidate() {
    this.value = null;
    this.invalidations++;
  }
}

export class InMemoryRecoveryCodes implements RecoveryCodeRepository {
  readonly rows = new Map<string, { userId: string; hash: Buffer; usedAt: Date | null }[]>();
  async replaceAll(userId: string, hashes: Buffer[]) {
    this.rows.set(userId, hashes.map((hash) => ({ userId, hash, usedAt: null })));
  }
  async consume(userId: string, hash: Buffer, at: Date) {
    const row = this.rows.get(userId)?.find((r) => !r.usedAt && r.hash.equals(hash));
    if (!row) return false;
    row.usedAt = at;
    return true;
  }
  async countUnused(userId: string) {
    return (this.rows.get(userId) ?? []).filter((r) => !r.usedAt).length;
  }
  async deleteAll(userId: string) {
    this.rows.delete(userId);
  }
}

/** "Cifra" reversível e visivelmente diferente do texto — basta para os testes de regra. */
export const fakeCipher: SecretCipher = {
  encrypt: (plain) => Buffer.concat([Buffer.from('enc:'), plain]),
  decrypt: (sealed) => sealed.subarray(4),
};

export const fakeQr: QrRenderer = { toDataUri: async (text) => `data:text/plain,${encodeURIComponent(text)}` };

export class MemoryEphemeralStore implements EphemeralStore {
  readonly rows = new Map<string, string>();
  async set(key: string, value: string) {
    this.rows.set(key, value);
  }
  async get(key: string) {
    return this.rows.get(key) ?? null;
  }
  async take(key: string) {
    const v = this.rows.get(key) ?? null;
    this.rows.delete(key);
    return v;
  }
  async del(key: string) {
    this.rows.delete(key);
  }
}
