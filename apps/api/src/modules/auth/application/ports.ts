import type { Role, UserRecord, UserStatus } from '../domain/user.js';

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(data: { email: string; passwordHash: string; role: Role; at: Date }): Promise<UserRecord>;
  updateLoginState(
    id: string,
    state: { failedLogins: number; lockedUntil: Date | null; lastLoginAt?: Date },
  ): Promise<void>;
  updateStatus(id: string, status: UserStatus): Promise<void>;
  list(): Promise<UserRecord[]>;
  countAdmins(): Promise<number>;
}
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface SessionRecord {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SessionRepository {
  create(data: {
    userId: string;
    familyId: string;
    refreshHash: Buffer;
    ip: string | null;
    userAgent: string | null;
    expiresAt: Date;
    at: Date;
  }): Promise<SessionRecord>;
  findById(id: string): Promise<SessionRecord | null>;
  /** Trava a sessão até o fim da transação: duas renovações simultâneas não passam juntas. */
  findByRefreshHashForUpdate(hash: Buffer): Promise<SessionRecord | null>;
  revoke(id: string, at: Date): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
}
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: Role;
}

export interface AccessTokenService {
  sign(claims: AccessTokenClaims, ttlSeconds: number): Promise<string>;
  /** Rejeita assinatura inválida, expiração, emissor/audiência errados ou algoritmo diferente. */
  verify(token: string): Promise<AccessTokenClaims>;
}
export const ACCESS_TOKEN_SERVICE = Symbol('ACCESS_TOKEN_SERVICE');

export interface AuthConfig {
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
