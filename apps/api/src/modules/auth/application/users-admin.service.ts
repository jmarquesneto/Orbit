import { randomInt } from 'node:crypto';
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
import { PersonNameSchema, toUserView, type UserStatus, type UserView } from '../domain/user.js';
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
   * Para quem esqueceu a senha: gera uma senha provisória (mostrada uma vez ao admin, que a
   * repassa à pessoa), destrava a conta e derruba as sessões. No próximo acesso a pessoa é
   * obrigada a criar uma senha nova. O MFA continua valendo.
   */
  async resetPassword(
    actorId: string,
    userId: string,
    ip: string | null,
  ): Promise<{ user: UserView; temporaryPassword: string }> {
    if (actorId === userId) throw new ForbiddenError('Use "Minha conta" para trocar a sua própria senha.');
    const temporaryPassword = generateTemporaryPassword();
    const hash = await this.hasher.hash(temporaryPassword);
    return this.tx.run(async () => {
      const user = await this.users.findById(userId);
      if (!user) throw new NotFoundError('Usuário não encontrado.');
      await this.users.setPassword(userId, hash, true);
      await this.sessions.revokeAllForUser(userId, this.clock.now());
      await this.audit.record({ actorId, action: 'user.password_reset', entityType: 'user', entityId: userId, ip });
      return {
        user: toUserView({ ...user, mustChangePassword: true, failedLogins: 0, lockedUntil: null }),
        temporaryPassword,
      };
    });
  }

  /**
   * Primeiro administrador sem terminal: só age se ainda NÃO existe nenhum admin. A senha é
   * provisória (troca obrigatória no 1º login), então o log em que ela aparece perde o valor
   * assim que a pessoa entra. Devolve null quando já havia administrador.
   */
  async bootstrapFirstAdmin(
    rawEmail: string,
    rawName?: string,
  ): Promise<{ user: UserView; temporaryPassword: string } | null> {
    if ((await this.users.countAdmins()) > 0) return null;
    const email = rawEmail.trim().toLowerCase();
    const name = rawName ? PersonNameSchema.safeParse(rawName) : null;
    const temporaryPassword = generateTemporaryPassword();
    const hash = await this.hasher.hash(temporaryPassword);
    return this.tx.run(async () => {
      if ((await this.users.countAdmins()) > 0) return null;
      if (await this.users.findByEmail(email)) {
        throw new ConflictError('Já existe um usuário (não administrador) com BOOTSTRAP_ADMIN_EMAIL.');
      }
      const user = await this.users.create({
        email,
        name: name?.success ? name.data : null,
        passwordHash: hash,
        role: 'admin',
        at: this.clock.now(),
      });
      await this.users.setPassword(user.id, hash, true);
      await this.audit.record({ actorId: null, action: 'user.bootstrap_admin', entityType: 'user', entityId: user.id });
      return { user: toUserView({ ...user, mustChangePassword: true }), temporaryPassword };
    });
  }

  /**
   * Cria um administrador pela linha de comando (bootstrap do primeiro acesso).
   * A senha é aleatória (256 bits) e mostrada uma única vez a quem rodou o comando.
   */
  async bootstrapAdmin(rawEmail: string, rawName?: string): Promise<{ user: UserView; password: string }> {
    const parsed = z.email().max(254).safeParse(rawEmail.trim().toLowerCase());
    if (!parsed.success) throw new ValidationError('E-mail inválido.');
    const email = parsed.data;
    const name = rawName ? PersonNameSchema.safeParse(rawName) : null;
    if (name && !name.success) throw new ValidationError(`Nome inválido: ${name.error.issues[0]?.message ?? ''}`);

    return this.tx.run(async () => {
      if (await this.users.findByEmail(email)) {
        throw new ConflictError('Já existe um usuário com este e-mail.');
      }
      const password = generateSecureToken().token;
      const user = await this.users.create({
        email,
        name: name?.data ?? null,
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

/** Sem letras/números que se confundem (0/O, 1/l/I): fácil de ditar ou digitar. */
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** 16 caracteres aleatórios em 4 grupos (~79 bits), ex.: "k7mp-2xqa-9ztn-h4rw". */
export function generateTemporaryPassword(): string {
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join(''),
  );
  return groups.join('-');
}
