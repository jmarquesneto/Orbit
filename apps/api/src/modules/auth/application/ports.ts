import type { Role, UserRecord, UserStatus } from '../domain/user.js';

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(data: {
    email: string;
    name?: string | null;
    passwordHash: string;
    role: Role;
    at: Date;
  }): Promise<UserRecord>;
  updateName(id: string, name: string): Promise<void>;
  setPassword(id: string, passwordHash: string, mustChange: boolean): Promise<void>;
  updateLoginState(
    id: string,
    state: { failedLogins: number; lockedUntil: Date | null; lastLoginAt?: Date },
  ): Promise<void>;
  updateStatus(id: string, status: UserStatus): Promise<void>;
  setMfa(id: string, data: { enabled: boolean; secret: Buffer | null; lastStep: number | null }): Promise<void>;
  setMfaLastStep(id: string, step: number): Promise<void>;
  list(): Promise<UserRecord[]>;
  countAdmins(): Promise<number>;
  countAll(): Promise<number>;
  /** Trava a criação de contas até o fim da transação (duas configurações iniciais simultâneas). */
  lockUserCreation(): Promise<void>;
}
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface SessionRecord {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  mfaVerifiedAt: Date | null;
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
    mfaVerifiedAt?: Date | null;
  }): Promise<SessionRecord>;
  markMfaVerified(id: string, at: Date): Promise<void>;
  /** Encerra todas as sessões do usuário, menos a da família informada (o aparelho atual). */
  revokeOtherFamilies(userId: string, keepFamilyId: string, at: Date): Promise<void>;
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

export interface RecoveryCodeRepository {
  replaceAll(userId: string, hashes: Buffer[]): Promise<void>;
  /** Marca como usado e devolve true só se o código existia e ainda não tinha sido usado. */
  consume(userId: string, hash: Buffer, at: Date): Promise<boolean>;
  countUnused(userId: string): Promise<number>;
  deleteAll(userId: string): Promise<void>;
}
export const RECOVERY_CODE_REPOSITORY = Symbol('RECOVERY_CODE_REPOSITORY');

/** Cifra simétrica autenticada para segredos em repouso (segredo do MFA). */
export interface SecretCipher {
  encrypt(plain: Buffer): Buffer;
  decrypt(sealed: Buffer): Buffer;
}
export const SECRET_CIPHER = Symbol('SECRET_CIPHER');

export interface QrRenderer {
  /** Devolve uma imagem SVG do QR code como data URI. */
  toDataUri(text: string): Promise<string>;
}
export const QR_RENDERER = Symbol('QR_RENDERER');
