import { Inject, Injectable } from '@nestjs/common';
import { enforceRateLimits } from '../../../shared/application/rate-limit.js';
import {
  AUDIT_LOG,
  type AuditLog,
  CLOCK,
  type Clock,
  EPHEMERAL_STORE,
  type EphemeralStore,
  RATE_LIMITER,
  type RateLimiter,
  type RequestContext,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import {
  ConflictError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidMfaCodeError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/errors.js';
import { generateSecureToken, hashToken, isWellFormedToken } from '../../../shared/domain/secure-token.js';
import { SettingsService } from '../../settings/application/settings.service.js';
import {
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  otpauthUri,
  verifyTotp,
} from '../domain/totp.js';
import {
  type AuthUser,
  canAuthenticate,
  registerFailedLogin,
  toUserView,
  type UserRecord,
  type UserView,
} from '../domain/user.js';
import {
  QR_RENDERER,
  type QrRenderer,
  RECOVERY_CODE_REPOSITORY,
  type RecoveryCodeRepository,
  SECRET_CIPHER,
  type SecretCipher,
  SESSION_REPOSITORY,
  type SessionRepository,
  USER_REPOSITORY,
  type UserRepository,
} from './ports.js';
import { type IssuedSession, SessionService } from './session.service.js';

const PENDING_TTL = 10 * 60; // segundos para concluir o cadastro do app
const CHALLENGE_TTL = 5 * 60; // segundos entre a senha e o código no login
const MAX_CHALLENGE_ATTEMPTS = 5;

const pendingKey = (userId: string) => `mfa:pending:${userId}`;
const challengeKey = (token: string) => `mfa:challenge:${hashToken(token).toString('hex')}`;

export interface MfaStatus {
  enabled: boolean;
  required: boolean;
  recoveryCodesLeft: number;
}

/**
 * Verificação em duas etapas (Flow: etapas 8–9 e "Publicar pede seu código MFA").
 *  - cadastro: segredo gerado aqui, mostrado em QR; só é gravado (cifrado) depois que a
 *    pessoa digita um código válido — prova de que o app autenticador recebeu o segredo;
 *  - login: senha certa gera um desafio de 5 min; o código troca o desafio pela sessão;
 *  - 10 códigos de recuperação de uso único, guardados só como hash;
 *  - erros de código contam no mesmo bloqueio da senha (5 erros → 15 min).
 */
@Injectable()
export class MfaService {
  private policyCache: { value: boolean; at: number } | null = null;

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessionsRepo: SessionRepository,
    @Inject(RECOVERY_CODE_REPOSITORY) private readonly recovery: RecoveryCodeRepository,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(QR_RENDERER) private readonly qr: QrRenderer,
    @Inject(EPHEMERAL_STORE) private readonly store: EphemeralStore,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
  ) {
    this.settings.onChange((key) => {
      if (key === 'security.mfa_required') this.invalidatePolicyCache();
    });
  }

  /** Política da instalação (cache de 30 s: é consultada em toda requisição). */
  async isRequired(): Promise<boolean> {
    const now = Date.now();
    if (this.policyCache && now - this.policyCache.at < 30_000) return this.policyCache.value;
    const value = await this.settings.get('security.mfa_required').catch(() => true);
    this.policyCache = { value, at: now };
    return value;
  }

  invalidatePolicyCache(): void {
    this.policyCache = null;
  }

  async status(userId: string): Promise<MfaStatus> {
    const user = await this.mustFind(userId);
    return {
      enabled: user.mfaEnabled,
      required: await this.isRequired(),
      recoveryCodesLeft: user.mfaEnabled ? await this.recovery.countUnused(userId) : 0,
    };
  }

  // ------------------------------------------------------------------ cadastro

  async startEnrollment(auth: AuthUser): Promise<{ otpauthUri: string; secret: string; qrCode: string }> {
    const user = await this.mustFind(auth.id);
    if (user.mfaEnabled) throw new ConflictError('A verificação em duas etapas já está ativa.');
    const secret = generateTotpSecret();
    await this.store.set(pendingKey(user.id), this.cipher.encrypt(secret).toString('base64'), PENDING_TTL);
    const { name } = await this.settings.getBranding();
    const uri = otpauthUri(name, user.email, secret);
    return { otpauthUri: uri, secret: base32Encode(secret), qrCode: await this.qr.toDataUri(uri) };
  }

  async confirmEnrollment(auth: AuthUser, code: string, ip: string | null): Promise<{ recoveryCodes: string[] }> {
    const sealed = await this.store.get(pendingKey(auth.id));
    if (!sealed) throw new ValidationError('O tempo para configurar acabou. Gere um novo QR code.');
    const secret = this.cipher.decrypt(Buffer.from(sealed, 'base64'));
    const step = verifyTotp(secret, code.trim(), this.clock.now(), null);
    if (step === null) throw new InvalidMfaCodeError();

    const codes = generateRecoveryCodes();
    await this.tx.run(async () => {
      await this.users.setMfa(auth.id, { enabled: true, secret: this.cipher.encrypt(secret), lastStep: step });
      await this.recovery.replaceAll(auth.id, codes.map(hashRecoveryCode));
      await this.sessions.markMfaVerified(auth.sessionId);
      await this.audit.record({ actorId: auth.id, action: 'mfa.enable', entityType: 'user', entityId: auth.id, ip });
    });
    await this.store.del(pendingKey(auth.id));
    return { recoveryCodes: codes };
  }

  // --------------------------------------------------------------------- login

  /** Chamado pelo login depois da senha certa: devolve o desafio que troca pelo código. */
  async createLoginChallenge(userId: string): Promise<string> {
    const { token } = generateSecureToken();
    await this.store.set(challengeKey(token), JSON.stringify({ userId, attempts: 0 }), CHALLENGE_TTL);
    return token;
  }

  async completeLogin(
    challenge: unknown,
    code: string,
    ctx: RequestContext,
  ): Promise<{ user: UserView; session: IssuedSession }> {
    await enforceRateLimits(this.limiter, [
      { key: `mfa:ip:${ctx.ip ?? 'unknown'}`, limit: 30, windowSeconds: 300 },
    ]);
    if (!isWellFormedToken(challenge)) throw new InvalidCredentialsError();
    const key = challengeKey(challenge);
    const raw = await this.store.get(key);
    if (!raw) throw new InvalidCredentialsError();
    const state = JSON.parse(raw) as { userId: string; attempts: number };

    const user = await this.users.findById(state.userId);
    const now = this.clock.now();
    if (!user || !canAuthenticate(user, now) || !user.mfaEnabled) {
      await this.store.del(key);
      throw new InvalidCredentialsError();
    }

    const used = await this.checkCode(user, code);
    if (!used) {
      state.attempts += 1;
      if (state.attempts >= MAX_CHALLENGE_ATTEMPTS) await this.store.del(key);
      else await this.store.set(key, JSON.stringify(state), CHALLENGE_TTL);
      await this.registerFailure(user, ctx.ip);
      throw new InvalidMfaCodeError();
    }

    await this.store.del(key);
    return this.tx.run(async () => {
      await this.users.updateLoginState(user.id, { failedLogins: 0, lockedUntil: null, lastLoginAt: now });
      const session = await this.sessions.issue(user, ctx, { mfaVerifiedAt: now });
      await this.audit.record({
        actorId: user.id,
        action: 'auth.login',
        entityType: 'session',
        entityId: session.sessionId,
        ip: ctx.ip,
        diff: { mfa: used },
      });
      return { user: toUserView({ ...user, lastLoginAt: now }), session };
    });
  }

  // ------------------------------------------------------------- reconfirmação

  /** Confirma o código de novo na sessão atual (ações de admin exigem uma confirmação recente). */
  async reauthenticate(auth: AuthUser, code: string, ip: string | null): Promise<void> {
    await enforceRateLimits(this.limiter, [{ key: `mfa:reauth:${auth.id}`, limit: 10, windowSeconds: 300 }]);
    const user = await this.mustFind(auth.id);
    if (!user.mfaEnabled) throw new ValidationError('Ative a verificação em duas etapas primeiro.');
    if (!(await this.checkCode(user, code))) {
      await this.registerFailure(user, ip);
      throw new InvalidMfaCodeError();
    }
    await this.sessions.markMfaVerified(auth.sessionId);
  }

  async regenerateRecoveryCodes(auth: AuthUser, code: string, ip: string | null): Promise<{ recoveryCodes: string[] }> {
    const user = await this.mustFind(auth.id);
    if (!user.mfaEnabled) throw new ValidationError('Ative a verificação em duas etapas primeiro.');
    if (!(await this.checkCode(user, code))) {
      await this.registerFailure(user, ip);
      throw new InvalidMfaCodeError();
    }
    const codes = generateRecoveryCodes();
    await this.tx.run(async () => {
      await this.recovery.replaceAll(user.id, codes.map(hashRecoveryCode));
      await this.audit.record({ actorId: user.id, action: 'mfa.recovery_regenerate', entityType: 'user', entityId: user.id, ip });
    });
    return { recoveryCodes: codes };
  }

  async disable(auth: AuthUser, code: string, ip: string | null): Promise<void> {
    if (await this.isRequired()) {
      throw new ForbiddenError('Nesta instalação a verificação em duas etapas é obrigatória.');
    }
    const user = await this.mustFind(auth.id);
    if (!user.mfaEnabled) return;
    if (!(await this.checkCode(user, code))) {
      await this.registerFailure(user, ip);
      throw new InvalidMfaCodeError();
    }
    await this.tx.run(async () => {
      await this.users.setMfa(user.id, { enabled: false, secret: null, lastStep: null });
      await this.recovery.deleteAll(user.id);
      await this.audit.record({ actorId: user.id, action: 'mfa.disable', entityType: 'user', entityId: user.id, ip });
    });
  }

  /**
   * Admin redefine o MFA de quem perdeu o celular: desativa, apaga os códigos e derruba as
   * sessões. No próximo login a pessoa cadastra o app de novo.
   */
  async adminReset(actorId: string | null, userId: string, ip: string | null): Promise<UserView> {
    if (actorId === userId) throw new ForbiddenError('Use a sua página de segurança para mudar o próprio MFA.');
    return this.tx.run(async () => {
      const user = await this.mustFind(userId);
      await this.users.setMfa(userId, { enabled: false, secret: null, lastStep: null });
      await this.recovery.deleteAll(userId);
      await this.sessionsRepo.revokeAllForUser(userId, this.clock.now());
      await this.audit.record({ actorId, action: 'mfa.admin_reset', entityType: 'user', entityId: userId, ip });
      return toUserView({ ...user, mfaEnabled: false });
    });
  }

  // ------------------------------------------------------------------ internos

  /**
   * Aceita um código TOTP (não reutilizável) ou um código de recuperação (uso único).
   * Devolve qual tipo foi usado, ou null se nenhum vale.
   */
  private async checkCode(user: UserRecord, rawCode: string): Promise<'totp' | 'recovery' | null> {
    const code = rawCode.trim();
    if (looksLikeRecoveryCode(code) && !/^\d+$/.test(code)) {
      return (await this.recovery.consume(user.id, hashRecoveryCode(code), this.clock.now())) ? 'recovery' : null;
    }
    if (!user.mfaSecret) return null;
    const secret = this.cipher.decrypt(user.mfaSecret);
    const step = verifyTotp(secret, code, this.clock.now(), user.mfaLastStep);
    if (step === null) return null;
    await this.users.setMfaLastStep(user.id, step);
    return 'totp';
  }

  private async registerFailure(user: UserRecord, ip: string | null): Promise<void> {
    const next = registerFailedLogin(user, this.clock.now());
    await this.users.updateLoginState(user.id, next);
    await this.audit.record({
      actorId: user.id,
      action: 'mfa.failed',
      entityType: 'user',
      entityId: user.id,
      ip,
      diff: { locked: next.lockedUntil !== null },
    });
  }

  private async mustFind(id: string): Promise<UserRecord> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError('Usuário não encontrado.');
    return user;
  }
}
