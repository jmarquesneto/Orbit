export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

export type UserStatus = 'active' | 'locked';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: UserStatus;
  failedLogins: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  mfaEnabled: boolean;
  /** Segredo TOTP cifrado (AES-256-GCM). Nunca sai da camada de aplicação. */
  mfaSecret: Buffer | null;
  mfaLastStep: number | null;
}

/** Visão pública de um usuário — nunca inclui hash de senha nem segredo MFA. */
export interface UserView {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export function toUserView(u: UserRecord): UserView {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    status: u.status,
    mfaEnabled: u.mfaEnabled,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

/** Quem fez a requisição, já autenticado pelo guard. */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
  mfaEnabled: boolean;
  /** Quando o MFA foi confirmado pela última vez nesta sessão. */
  mfaVerifiedAt: Date | null;
}

/** Ações sensíveis de admin exigem MFA confirmado há no máximo 5 minutos. */
export const MFA_REAUTH_WINDOW_MS = 5 * 60_000;

// ---- Bloqueio por tentativas erradas (Flow: 5 tentativas → 15 minutos) ----

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export function isTemporarilyLocked(user: Pick<UserRecord, 'lockedUntil'>, now: Date): boolean {
  return user.lockedUntil !== null && user.lockedUntil > now;
}

export function canAuthenticate(user: Pick<UserRecord, 'status' | 'lockedUntil'>, now: Date): boolean {
  return user.status === 'active' && !isTemporarilyLocked(user, now);
}

/** Calcula o novo estado após uma senha errada. Ao atingir o limite, bloqueia e zera o contador. */
export function registerFailedLogin(
  user: Pick<UserRecord, 'failedLogins'>,
  now: Date,
): { failedLogins: number; lockedUntil: Date | null } {
  const failed = user.failedLogins + 1;
  if (failed >= MAX_FAILED_LOGINS) {
    return { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) };
  }
  return { failedLogins: failed, lockedUntil: null };
}
