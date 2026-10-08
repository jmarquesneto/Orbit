import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

// ======================================================= Motor financeiro
// Valores SEMPRE em centavos (bigint), nunca em ponto flutuante. Datas de calendário
// (vencimento, competência) são `date` em texto ISO, sem fuso horário.

const cents = (name: string) => bigint(name, { mode: 'number' });
const calendarDate = (name: string) => date(name, { mode: 'string' });

export const walletType = pgEnum('wallet_type', ['checking', 'cash', 'credit']);
export const categoryKind = pgEnum('category_kind', ['income', 'expense']);
export const transactionKind = pgEnum('transaction_kind', ['income', 'expense', 'xfer']);
export const transactionStatus = pgEnum('transaction_status', ['open', 'paid', 'provisioned']);
export const invoiceStatus = pgEnum('invoice_status', ['open', 'closed', 'paid']);
export const shareResourceType = pgEnum('share_resource_type', ['budget', 'goal']);
export const goalMovementKind = pgEnum('goal_movement_kind', ['deposit', 'withdraw']);

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('BRL'),
    periodStartDay: smallint('period_start_day').notNull().default(1),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('budgets_owner_idx').on(t.ownerId),
    check('budgets_period_start_day', sql`${t.periodStartDay} BETWEEN 1 AND 28`),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    kind: categoryKind('kind').notNull(),
    plannedCents: cents('planned_cents').notNull().default(0),
    color: text('color'),
  },
  (t) => [
    index('categories_budget_idx').on(t.budgetId),
    check('categories_planned_non_negative', sql`${t.plannedCents} >= 0`),
  ],
);

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    type: walletType('type').notNull(),
    name: text('name').notNull(),
    institution: text('institution'),
    last4: char('last4', { length: 4 }),
    openingCents: cents('opening_cents').notNull().default(0),
    /** Cache: saldo inicial + lançamentos pagos. Recalculável a partir de transactions. */
    balanceCents: cents('balance_cents').notNull().default(0),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('wallets_owner_idx').on(t.ownerId),
    check('wallets_last4_digits', sql`${t.last4} IS NULL OR ${t.last4} ~ '^[0-9]{4}$'`),
  ],
);

export const creditCards = pgTable(
  'credit_cards',
  {
    walletId: uuid('wallet_id')
      .primaryKey()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    limitCents: cents('limit_cents').notNull(),
    closingDay: smallint('closing_day').notNull(),
    dueDay: smallint('due_day').notNull(),
    payFrom: uuid('pay_from').references(() => wallets.id),
  },
  (t) => [
    check('credit_cards_days', sql`${t.closingDay} BETWEEN 1 AND 31 AND ${t.dueDay} BETWEEN 1 AND 31`),
    check('credit_cards_limit_non_negative', sql`${t.limitCents} >= 0`),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => creditCards.walletId, { onDelete: 'cascade' }),
    /** Competência da fatura: sempre o dia 1 do mês. */
    refMonth: calendarDate('ref_month').notNull(),
    closingDate: calendarDate('closing_date').notNull(),
    dueDate: calendarDate('due_date').notNull(),
    totalCents: cents('total_cents').notNull().default(0),
    paidCents: cents('paid_cents').notNull().default(0),
    status: invoiceStatus('status').notNull().default('open'),
  },
  (t) => [
    unique('invoices_card_month_unique').on(t.cardId, t.refMonth),
    check('invoices_ref_month_first_day', sql`extract(day from ${t.refMonth}) = 1`),
  ],
);

export const installmentPlans = pgTable(
  'installment_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => creditCards.walletId, { onDelete: 'cascade' }),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    description: text('description').notNull(),
    totalCents: cents('total_cents').notNull(),
    count: smallint('count').notNull(),
    purchaseDate: calendarDate('purchase_date').notNull(),
    firstInvoice: uuid('first_invoice')
      .notNull()
      .references(() => invoices.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    /** Reenvio da mesma compra (clique duplo, rede instável) não duplica as parcelas. */
    idempotencyKey: uuid('idempotency_key').notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    check('installment_plans_count', sql`${t.count} BETWEEN 1 AND 48`),
    check('installment_plans_total_positive', sql`${t.totalCents} > 0`),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    planId: uuid('plan_id').references(() => installmentPlans.id, { onDelete: 'cascade' }),
    installmentNo: smallint('installment_no'),
    description: text('description').notNull(),
    amountCents: cents('amount_cents').notNull(),
    kind: transactionKind('kind').notNull(),
    status: transactionStatus('status').notNull().default('open'),
    dueDate: calendarDate('due_date').notNull(),
    paidAt: timestamptz('paid_at'),
    ofxFitid: text('ofx_fitid'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    /** Lock otimista: toda edição informa a versão lida; versão diferente = conflito. */
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    index('transactions_budget_due_idx').on(t.budgetId, t.dueDate),
    index('transactions_invoice_idx').on(t.invoiceId),
    index('transactions_plan_idx').on(t.planId),
    // OFX: o mesmo lançamento do banco nunca entra duas vezes na mesma carteira.
    uniqueIndex('transactions_wallet_fitid_unique')
      .on(t.walletId, t.ofxFitid)
      .where(sql`${t.ofxFitid} IS NOT NULL`),
    check('transactions_amount_positive', sql`${t.amountCents} > 0`),
    check(
      'transactions_installment_consistent',
      sql`(${t.planId} IS NULL) = (${t.installmentNo} IS NULL)`,
    ),
    check('transactions_paid_consistent', sql`(${t.status} = 'paid') = (${t.paidAt} IS NOT NULL)`),
  ],
);

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    targetCents: cents('target_cents').notNull(),
    targetDate: calendarDate('target_date'),
    balanceCents: cents('balance_cents').notNull().default(0),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('goals_owner_idx').on(t.ownerId),
    check('goals_target_positive', sql`${t.targetCents} > 0`),
    check('goals_balance_non_negative', sql`${t.balanceCents} >= 0`),
  ],
);

export const goalMovements = pgTable(
  'goal_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    kind: goalMovementKind('kind').notNull(),
    amountCents: cents('amount_cents').notNull(),
    occurredOn: calendarDate('occurred_on').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('goal_movements_goal_idx').on(t.goalId),
    check('goal_movements_amount_positive', sql`${t.amountCents} > 0`),
  ],
);

// ============================================== Compartilhamento · RBAC

export const shareRoles = pgTable('share_roles', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  canRead: boolean('can_read').notNull(),
  canUpdate: boolean('can_update').notNull(),
  canCreate: boolean('can_create').notNull(),
  canDelete: boolean('can_delete').notNull(),
  canShare: boolean('can_share').notNull(),
});

export const resourceShares = pgTable(
  'resource_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceType: shareResourceType('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    granteeId: uuid('grantee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleCode: text('role_code')
      .notNull()
      .references(() => shareRoles.code),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamptz('expires_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    // Um compartilhamento ATIVO por pessoa e recurso; revogados ficam no histórico.
    uniqueIndex('resource_shares_active_unique')
      .on(t.resourceType, t.resourceId, t.granteeId)
      .where(sql`${t.revokedAt} IS NULL`),
    index('resource_shares_grantee_idx').on(t.granteeId),
  ],
);

// =================================================== Conciliação OFX

export const ofxImportStatus = pgEnum('ofx_import_status', ['review', 'done']);
export const ofxMatch = pgEnum('ofx_match', ['auto', 'suggest', 'new', 'dup']);
export const ofxResolution = pgEnum('ofx_resolution', ['pending', 'linked', 'created', 'ignored']);

export const ofxImports = pgTable(
  'ofx_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    fileName: text('file_name').notNull(),
    /** O mesmo arquivo não entra duas vezes na mesma conta. */
    fileSha256: bytea('file_sha256').notNull(),
    bankId: text('bank_id'),
    accountMask: text('account_mask'),
    periodStart: calendarDate('period_start'),
    periodEnd: calendarDate('period_end'),
    ledgerBalanceCents: bigint('ledger_balance_cents', { mode: 'number' }),
    status: ofxImportStatus('status').notNull().default('review'),
    createdAt: createdAt(),
  },
  (t) => [unique('ofx_imports_wallet_file_unique').on(t.walletId, t.fileSha256)],
);

export const ofxEntries = pgTable(
  'ofx_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: uuid('import_id')
      .notNull()
      .references(() => ofxImports.id, { onDelete: 'cascade' }),
    fitid: text('fitid').notNull(),
    postedAt: calendarDate('posted_at').notNull(),
    /** Com sinal, como no extrato: negativo = saída da conta. */
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    /** Texto do banco já saneado (sem controle, sem < >, até 255 caracteres). */
    memo: text('memo').notNull(),
    match: ofxMatch('match').notNull(),
    score: smallint('score').notNull().default(0),
    suggestedTransactionId: uuid('suggested_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    resolution: ofxResolution('resolution').notNull().default('pending'),
    transactionId: uuid('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('ofx_entries_import_idx').on(t.importId),
    check('ofx_entries_score_range', sql`${t.score} BETWEEN 0 AND 100`),
  ],
);
