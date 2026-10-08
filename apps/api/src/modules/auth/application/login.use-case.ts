import { Inject, Injectable } from '@nestjs/common';
import { enforceRateLimits } from '../../../shared/application/rate-limit.js';
import {
  AUDIT_LOG,
  type AuditLog,
  CLOCK,
  type Clock,
  RATE_LIMITER,
  type RateLimiter,
  type RequestContext,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import { InvalidCredentialsError } from '../../../shared/domain/errors.js';
import { canAuthenticate, registerFailedLogin, toUserView, type UserView } from '../domain/user.js';
import { PASSWORD_HASHER, type PasswordHasher, USER_REPOSITORY, type UserRepository } from './ports.js';
import { type IssuedSession, SessionService } from './session.service.js';

@Injectable()
export class LoginUseCase {
  /** Hash de referência: e-mails inexistentes custam o mesmo tempo que senhas erradas. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly sessions: SessionService,
  ) {}

  async execute(
    input: { email: string; password: string },
    ctx: RequestContext,
  ): Promise<{ user: UserView; session: IssuedSession }> {
    const email = input.email.trim().toLowerCase();
    await enforceRateLimits(this.limiter, [
      { key: `login:ip:${ctx.ip ?? 'unknown'}`, limit: 20, windowSeconds: 300 },
      { key: `login:email:${email}`, limit: 10, windowSeconds: 900 },
    ]);

    const user = await this.users.findByEmail(email);
    if (!user) {
      await this.hasher.verify(await this.referenceHash(), input.password);
      throw new InvalidCredentialsError();
    }

    const passwordOk = await this.hasher.verify(user.passwordHash, input.password);
    const now = this.clock.now();

    if (!canAuthenticate(user, now)) {
      await this.audit.record({
        actorId: user.id,
        action: 'auth.login_blocked',
        entityType: 'user',
        entityId: user.id,
        ip: ctx.ip,
      });
      throw new InvalidCredentialsError();
    }

    if (!passwordOk) {
      const next = registerFailedLogin(user, now);
      await this.tx.run(async () => {
        await this.users.updateLoginState(user.id, next);
        await this.audit.record({
          actorId: user.id,
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: user.id,
          ip: ctx.ip,
          diff: { locked: next.lockedUntil !== null },
        });
      });
      throw new InvalidCredentialsError();
    }

    return this.tx.run(async () => {
      await this.users.updateLoginState(user.id, { failedLogins: 0, lockedUntil: null, lastLoginAt: now });
      const session = await this.sessions.issue(user, ctx);
      await this.audit.record({
        actorId: user.id,
        action: 'auth.login',
        entityType: 'session',
        entityId: session.sessionId,
        ip: ctx.ip,
      });
      return { user: toUserView({ ...user, lastLoginAt: now }), session };
    });
  }

  private referenceHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('referencia-para-tempo-constante');
    return this.dummyHash;
  }
}
