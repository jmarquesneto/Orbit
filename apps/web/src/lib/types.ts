/** Formatos devolvidos pela API (espelham os casos de uso do backend). */

export type Role = 'owner' | 'read' | 'edit' | 'create';
export type Permissions = Record<'read' | 'update' | 'create' | 'delete' | 'share', boolean>;

export interface Me {
  id: string;
  email: string;
  /** Nome de exibição; contas antigas podem não ter. */
  name: string | null;
  /** Senha provisória definida pelo admin: precisa ser trocada antes de usar o sistema. */
  mustChangePassword: boolean;
  role: 'admin' | 'user';
  mfaEnabled: boolean;
  /** A instalação exige MFA de todos (security.mfa_required). */
  mfaRequired: boolean;
}

export interface MfaStatus {
  enabled: boolean;
  required: boolean;
  recoveryCodesLeft: number;
}

export interface MfaSetup {
  otpauthUri: string;
  secret: string;
  qrCode: string;
}

export interface Transfer {
  id: string;
  fromWalletId: string;
  toWalletId: string;
  amountCents: number;
  occurredOn: string;
  description: string | null;
  createdAt: string;
}

export interface OfxCandidate {
  id: string;
  description: string;
  amountCents: number;
  kind: 'income' | 'expense' | 'xfer';
  dueDate: string;
  score: number;
}

export interface Budget {
  id: string;
  ownerId: string;
  name: string;
  currency: string;
  periodStartDay: number;
  role: Role;
  permissions?: Permissions;
}

export interface Category {
  id: string;
  budgetId: string;
  parentId: string | null;
  name: string;
  kind: 'income' | 'expense';
  plannedCents: number;
  color: string | null;
}

export interface BudgetSummary {
  month: string;
  period: { from: string; to: string };
  totals: { incomeCents: number; expenseCents: number; balanceCents: number; plannedExpenseCents: number };
  categories: (Category & { actualCents: number; remainingCents: number })[];
  uncategorized: { incomeCents: number; expenseCents: number };
}

export interface Transaction {
  id: string;
  budgetId: string;
  walletId: string;
  categoryId: string | null;
  invoiceId: string | null;
  planId: string | null;
  installmentNo: number | null;
  description: string;
  amountCents: number;
  kind: 'income' | 'expense' | 'xfer';
  status: 'open' | 'paid' | 'provisioned';
  dueDate: string;
  ofxFitid: string | null;
  version: number;
}

export interface Wallet {
  id: string;
  type: 'checking' | 'cash' | 'credit';
  name: string;
  institution: string | null;
  last4: string | null;
  balanceCents: number;
  card: { limitCents: number; closingDay: number; dueDay: number; payFrom: string | null } | null;
}

export interface Invoice {
  id: string;
  cardId: string;
  refMonth: string;
  closingDate: string;
  dueDate: string;
  totalCents: number;
  paidCents: number;
  status: 'open' | 'closed' | 'paid';
}

export interface InvoiceDetail extends Invoice {
  transactions: { id: string; description: string; amountCents: number; installmentNo: number | null; planId: string | null; status: string }[];
}

export interface Goal {
  id: string;
  ownerId: string;
  name: string;
  targetCents: number;
  targetDate: string | null;
  balanceCents: number;
  progressPercent: number;
  role: Role;
}

export interface Share {
  id: string;
  grantee: { id: string; email: string };
  role: Exclude<Role, 'owner'>;
  expiresAt: string | null;
}

export interface OfxEntry {
  id: string;
  fitid: string;
  postedAt: string;
  amountCents: number;
  memo: string;
  match: 'auto' | 'suggest' | 'new' | 'dup';
  score: number;
  resolution: 'pending' | 'linked' | 'created' | 'ignored';
  transactionId: string | null;
  suggestion: { id: string; description: string; amountCents: number; dueDate: string } | null;
}

export interface OfxImportView {
  import: {
    id: string;
    walletId: string;
    fileName: string;
    periodStart: string | null;
    periodEnd: string | null;
    ledgerBalanceCents: number | null;
    status: 'review' | 'done';
    createdAt: string;
  };
  wallet: { id: string; name: string; balanceCents: number };
  entries: OfxEntry[];
  counts: { linked: number; suggest: number; new: number; other: number };
}

export interface Setting {
  key: string;
  value: unknown;
  isPublic: boolean;
  description: string;
  version: number;
}

export interface Invitation {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
  status: 'pending' | 'used' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  mustChangePassword: boolean;
  role: 'admin' | 'user';
  status: 'active' | 'locked';
  lastLoginAt: string | null;
  mfaEnabled: boolean;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Dono',
  read: 'Leitura',
  edit: 'Edição',
  create: 'Criação',
};

/** Como chamar a pessoa: o primeiro nome, ou a parte do e-mail antes do @ se não houver nome. */
export function firstName(user: { name: string | null; email: string }): string {
  return user.name?.trim().split(/\s+/)[0] || user.email.split('@')[0] || '';
}
