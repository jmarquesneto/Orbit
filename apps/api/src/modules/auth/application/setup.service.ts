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
import { ConflictError, ValidationError } from '../../../shared/domain/errors.js';
import { checkPasswordPolicy } from '../domain/password-policy.js';
import { toUserView, type UserView } from '../domain/user.js';
import { PASSWORD_HASHER, type PasswordHasher, USER_REPOSITORY, type UserRepository } from './ports.js';
import { type IssuedSession, SessionService } from './session.service.js';

/**
 * Configuração inicial (como no Portainer): enquanto não existe NENHUMA conta, quem abre o
 * site cria o administrador. Depois da primeira conta, esta porta se fecha para sempre.
 * A verificação em duas etapas é exigida logo em seguida, no primeiro acesso.
 */
@Injectable()
export class SetupService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly sessions: SessionService,
  ) {}

  async isNeeded(): Promise<boolean> {
    return (await this.users.countAll()) === 0;
  }

  async createFirstAdmin(
    input: { name: string; email: string; password: string },
    ctx: RequestContext,
  ): Promise<{ user: UserView; session: IssuedSession }> {
    await enforceRateLimits(this.limiter, [{ key: `setup:ip:${ctx.ip ?? 'unknown'}`, limit: 10, windowSeconds: 600 }]);
    if (!(await this.isNeeded())) throw new ConflictError('O sistema já foi configurado. Entre com sua conta.');

    const email = input.email.trim().toLowerCase();
    const problems = checkPasswordPolicy(input.password, email);
    if (problems.length) {
      throw new ValidationError(
        'A senha não atende aos requisitos.',
        problems.map((message) => ({ path: 'password', message })),
      );
    }
    const passwordHash = await this.hasher.hash(input.password);

    return this.tx.run(async () => {
      await this.users.lockUserCreation();
      if ((await this.users.countAll()) > 0) {
        throw new ConflictError('O sistema já foi configurado. Entre com sua conta.');
      }
      const now = this.clock.now();
      const user = await this.users.create({ email, name: input.name, passwordHash, role: 'admin', at: now });
      await this.users.updateLoginState(user.id, { failedLogins: 0, lockedUntil: null, lastLoginAt: now });
      const session = await this.sessions.issue(user, ctx);
      await this.audit.record({
        actorId: user.id,
        action: 'user.setup_admin',
        entityType: 'user',
        entityId: user.id,
        ip: ctx.ip,
      });
      return { user: toUserView({ ...user, lastLoginAt: now }), session };
    });
  }
}
