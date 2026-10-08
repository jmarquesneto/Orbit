import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  AUDIT_LOG,
  type AuditLog,
  CLOCK,
  type Clock,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { generateSecureToken } from '../../../shared/domain/secure-token.js';
import { toUserView, type UserStatus, type UserView } from '../domain/user.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  SESSION_REPOSITORY,
  type SessionRepository,
  USER_REPOSITORY,
  type UserRepository,
} from './ports.js';

@Injectable()
export class UsersAdminService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(): Promise<UserView[]> {
    return (await this.users.list()).map(toUserView);
  }

  /** Bloquear derruba todas as sessões do usuário na hora. */
  async setStatus(actorId: string, userId: string, status: UserStatus, ip: string | null): Promise<UserView> {
    if (actorId === userId) throw new ForbiddenError('Você não pode alterar o próprio status.');
    return this.tx.run(async () => {
      const user = await this.users.findById(userId);
      if (!user) throw new NotFoundError('Usuário não encontrado.');
      await this.users.updateStatus(userId, status);
      if (status === 'locked') await this.sessions.revokeAllForUser(userId, this.clock.now());
      await this.audit.record({
        actorId,
        action: 'user.status_change',
        entityType: 'user',
        entityId: userId,
        ip,
        diff: { from: user.status, to: status },
      });
      return toUserView({ ...user, status });
    });
  }

  /**
   * Cria um administrador pela linha de comando (bootstrap do primeiro acesso).
   * A senha é aleatória (256 bits) e mostrada uma única vez a quem rodou o comando.
   */
  async bootstrapAdmin(rawEmail: string): Promise<{ user: UserView; password: string }> {
    const parsed = z.email().max(254).safeParse(rawEmail.trim().toLowerCase());
    if (!parsed.success) throw new ValidationError('E-mail inválido.');
    const email = parsed.data;

    return this.tx.run(async () => {
      if (await this.users.findByEmail(email)) {
        throw new ConflictError('Já existe um usuário com este e-mail.');
      }
      const password = generateSecureToken().token;
      const user = await this.users.create({
        email,
        passwordHash: await this.hasher.hash(password),
        role: 'admin',
        at: this.clock.now(),
      });
      await this.audit.record({
        actorId: null,
        action: 'user.bootstrap_admin',
        entityType: 'user',
        entityId: user.id,
      });
      return { user: toUserView(user), password };
    });
  }
}
