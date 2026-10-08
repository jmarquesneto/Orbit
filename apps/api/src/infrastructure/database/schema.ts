import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Tipos nativos do Postgres usados no MER e que o Drizzle não traz prontos.
const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const inet = customType<{ data: string }>({ dataType: () => 'inet' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();

export const userRole = pgEnum('user_role', ['admin', 'user']);
export const userStatus = pgEnum('user_status', ['active', 'locked']);

// ---------------------------------------------------------------- Identidade

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  mfaSecret: bytea('mfa_secret'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  role: userRole('role').notNull().default('user'),
  status: userStatus('status').notNull().default('active'),
  failedLogins: smallint('failed_logins').notNull().default(0),
  /** Bloqueio temporário após tentativas erradas (status=locked é bloqueio pelo admin). */
  lockedUntil: timestamptz('locked_until'),
  lastLoginAt: timestamptz('last_login_at'),
  createdAt: createdAt(),
});

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 do token. O token em claro só existe no link entregue ao convidado. */
    tokenHash: bytea('token_hash').notNull().unique(),
    email: citext('email').notNull(),
    role: userRole('role').notNull().default('user'),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    usedBy: uuid('used_by').references(() => users.id),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('invitations_email_idx').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 do refresh token opaco. */
    refreshHash: bytea('refresh_hash').notNull().unique(),
    /** Todas as rotações de um mesmo login compartilham a família (detecção de reuso). */
    familyId: uuid('family_id').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_family_idx').on(t.familyId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    ip: inet('ip'),
    /** Nunca contém senhas, tokens ou segredos — só o que mudou, já mascarado. */
    diff: jsonb('diff'),
    prevHash: bytea('prev_hash'),
    rowHash: bytea('row_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_entity_idx').on(t.entityType, t.entityId)],
);

// ---------------------------------------------------- Configurações globais

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  /** Só chaves públicas aparecem em GET /api/branding. */
  isPublic: boolean('is_public').notNull().default(false),
  version: integer('version').notNull().default(1),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const settingRevisions = pgTable('setting_revisions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  settingKey: text('setting_key')
    .notNull()
    .references(() => systemSettings.key),
  version: integer('version').notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value').notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
  changedAt: timestamptz('changed_at').notNull().defaultNow(),
  reason: text('reason'),
});
