import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_LOG,
  type AuditLog,
  CLOCK,
  type Clock,
  type RequestContext,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import { generateSecureToken, hashToken, isWellFormedToken } from '../../../shared/domain/secure-token.js';
import { type AuthUser, canAuthenticate, type Role } from '../domain/user.js';
import {
  ACCESS_TOKEN_SERVICE,
  type AccessTokenService,
  AUTH_CONFIG,
  type AuthConfig,
  SESSION_REPOSITORY,
  type SessionRepository,
  USER_REPOSITORY,
  type UserRepository,
} from './ports.js';

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Sessões (Flow: "access token de 15 min, refresh rotativo com detecção de reuso").
 * Cada login abre uma família; cada renovação revoga o refresh usado e emite outro na
 * mesma família. Se um refresh já usado reaparecer, alguém o copiou: a família inteira cai.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ACCESS_TOKEN_SERVICE) private readonly tokens: AccessTokenService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async issue(
    user: { id: string; role: Role },
    ctx: RequestContext,
    opts: { familyId?: string; mfaVerifiedAt?: Date | null } = {},
  ): Promise<IssuedSession> {
    const familyId = opts.familyId ?? randomUUID();
    const now = this.clock.now();
    const refresh = generateSecureToken();
    const refreshExpiresAt = new Date(now.getTime() + this.config.refreshTtlSeconds * 1000);
    const session = await this.sessions.create({
      userId: user.id,
      familyId,
      refreshHash: refresh.hash,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      expiresAt: refreshExpiresAt,
      at: now,
      mfaVerifiedAt: opts.mfaVerifiedAt ?? null,
    });
    const accessToken = await this.tokens.sign(
      { sub: user.id, sid: session.id, role: user.role },
      this.config.accessTtlSeconds,
    );
    return {
      sessionId: session.id,
      accessToken,
      accessExpiresAt: new Date(now.getTime() + this.config.accessTtlSeconds * 1000),
      refreshToken: refresh.token,
      refreshExpiresAt,
    };
  }

  async rotate(refreshToken: unknown, ctx: RequestContext): Promise<IssuedSession> {
    if (!isWellFormedToken(refreshToken)) throw new UnauthenticatedError();

    // A revogação por reuso precisa persistir mesmo com a renovação negada,
    // então o resultado sai da transação e o erro é lançado só depois do commit.
    const outcome = await this.tx.run(async () => {
      const now = this.clock.now();
      const session = await this.sessions.findByRefreshHashForUpdate(hashToken(refreshToken));
      if (!session) return { ok: false as const };

      if (session.revokedAt) {
        await this.sessions.revokeFamily(session.familyId, now);
        await this.audit.record({
          actorId: session.userId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'session_family',
          entityId: session.familyId,
          ip: ctx.ip,
        });
        return { ok: false as const };
      }
      if (session.expiresAt <= now) return { ok: false as const };

      const user = await this.users.findById(session.userId);
      if (!user || !canAuthenticate(user, now)) {
        await this.sessions.revokeFamily(session.familyId, now);
        return { ok: false as const };
      }

      await this.sessions.revoke(session.id, now);
      // A renovação herda a última confirmação de MFA: a janela de 5 min não "reinicia".
      return {
        ok: true as const,
        issued: await this.issue(user, ctx, { familyId: session.familyId, mfaVerifiedAt: session.mfaVerifiedAt }),
      };
    });

    if (!outcome.ok) throw new UnauthenticatedError();
    return outcome.issued;
  }

  markMfaVerified(sessionId: string): Promise<void> {
    return this.sessions.markMfaVerified(sessionId, this.clock.now());
  }

  /** Logout: encerra a família da sessão atual (este dispositivo). */
  async end(sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (session) await this.sessions.revokeFamily(session.familyId, this.clock.now());
  }

  /**
   * Usado pelo guard em toda requisição. Além da assinatura do JWT, confere no banco se a
   * sessão segue ativa e se o usuário pode entrar — logout, bloqueio e troca de papel valem
   * na hora, sem esperar o access token expirar. O papel vem do banco, não do token.
   */
  async authenticate(accessToken: string): Promise<AuthUser> {
    const claims = await this.tokens.verify(accessToken).catch(() => {
      throw new UnauthenticatedError();
    });
    const now = this.clock.now();
    const session = await this.sessions.findById(claims.sid);
    if (!session || session.revokedAt || session.expiresAt <= now || session.userId !== claims.sub) {
      throw new UnauthenticatedError();
    }
    const user = await this.users.findById(claims.sub);
    if (!user || !canAuthenticate(user, now)) throw new UnauthenticatedError();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      mustChangePassword: user.mustChangePassword,
      role: user.role,
      sessionId: session.id,
      mfaEnabled: user.mfaEnabled,
      mfaVerifiedAt: session.mfaVerifiedAt,
    };
  }
}
