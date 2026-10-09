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
import { NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { checkPasswordPolicy } from '../domain/password-policy.js';
import { type AuthUser, registerFailedLogin, toUserView, type UserRecord, type UserView } from '../domain/user.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  SESSION_REPOSITORY,
  type SessionRepository,
  USER_REPOSITORY,
  type UserRepository,
} from './ports.js';

/** Dados da própria conta: nome de exibição e troca de senha. */
@Injectable()
export class AccountService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async updateName(auth: AuthUser, name: string, ip: string | null): Promise<UserView> {
    return this.tx.run(async () => {
      const user = await this.mustFind(auth.id);
      await this.users.updateName(user.id, name);
      await this.audit.record({
        actorId: user.id,
        action: 'user.rename',
        entityType: 'user',
        entityId: user.id,
        ip,
        diff: { from: user.name, to: name },
      });
      return toUserView({ ...user, name });
    });
  }

  /**
   * Troca a senha conferindo a atual. Senha atual errada conta no mesmo bloqueio do login.
   * As OUTRAS sessões caem (quem tinha a senha antiga perde o acesso); este aparelho continua.
   */
  async changePassword(
    auth: AuthUser,
    input: { currentPassword: string; newPassword: string },
    ctx: RequestContext,
  ): Promise<void> {
    await enforceRateLimits(this.limiter, [{ key: `password:change:${auth.id}`, limit: 10, windowSeconds: 900 }]);
    const user = await this.mustFind(auth.id);
    if (!(await this.hasher.verify(user.passwordHash, input.currentPassword))) {
      const next = registerFailedLogin(user, this.clock.now());
      await this.tx.run(async () => {
        await this.users.updateLoginState(user.id, next);
        await this.audit.record({
          actorId: user.id,
          action: 'auth.password_change_failed',
          entityType: 'user',
          entityId: user.id,
          ip: ctx.ip,
          diff: { locked: next.lockedUntil !== null },
        });
      });
      throw new ValidationError('Senha atual incorreta.', [{ path: 'currentPassword', message: 'Senha atual incorreta.' }]);
    }
    if (input.newPassword === input.currentPassword) {
      throw new ValidationError('A nova senha precisa ser diferente da atual.', [
        { path: 'newPassword', message: 'A nova senha precisa ser diferente da atual.' },
      ]);
    }
    const problems = checkPasswordPolicy(input.newPassword, user.email);
    if (problems.length) {
      throw new ValidationError(
        'A senha não atende aos requisitos.',
        problems.map((message) => ({ path: 'newPassword', message })),
      );
    }
    const hash = await this.hasher.hash(input.newPassword);
    await this.tx.run(async () => {
      const now = this.clock.now();
      await this.users.setPassword(user.id, hash, false);
      const current = await this.sessions.findById(auth.sessionId);
      if (current) await this.sessions.revokeOtherFamilies(user.id, current.familyId, now);
      await this.audit.record({
        actorId: user.id,
        action: 'auth.password_change',
        entityType: 'user',
        entityId: user.id,
        ip: ctx.ip,
      });
    });
  }

  private async mustFind(id: string): Promise<UserRecord> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError('Usuário não encontrado.');
    return user;
  }
}
