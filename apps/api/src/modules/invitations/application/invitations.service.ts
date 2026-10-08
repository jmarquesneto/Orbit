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
import {
  ConflictError,
  InvalidInvitationError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/errors.js';
import { generateSecureToken, hashToken, isWellFormedToken } from '../../../shared/domain/secure-token.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  USER_REPOSITORY,
  type UserRepository,
} from '../../auth/application/ports.js';
import { type IssuedSession, SessionService } from '../../auth/application/session.service.js';
import { checkPasswordPolicy } from '../../auth/domain/password-policy.js';
import { type Role, toUserView, type UserView } from '../../auth/domain/user.js';
import { SettingsService } from '../../settings/application/settings.service.js';
import {
  type InvitationRecord,
  type InvitationStatus,
  invitationStatus,
} from '../domain/invitation.js';
import {
  INVITATION_LINK_BUILDER,
  INVITATION_REPOSITORY,
  type InvitationLinkBuilder,
  type InvitationRepository,
} from './ports.js';

export interface InvitationView {
  id: string;
  email: string;
  role: Role;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
}

/**
 * Convites (Flow: do link ao primeiro acesso). O token tem 256 bits, só o SHA-256 vai ao
 * banco e ele é de uso único. Toda falha do lado do convidado devolve a MESMA resposta
 * neutra, para não revelar se o convite existe ou se o e-mail já tem conta.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(INVITATION_LINK_BUILDER) private readonly links: InvitationLinkBuilder,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly sessions: SessionService,
  ) {}

  // ------------------------------------------------------------- lado do admin

  async create(
    actorId: string,
    input: { email: string; role: Role; ttlHours?: number },
    ip: string | null,
  ): Promise<{ invitation: InvitationView; link: string }> {
    const email = input.email.trim().toLowerCase();
    if (await this.users.findByEmail(email)) {
      throw new ConflictError('Já existe uma conta com este e-mail.');
    }
    const ttlHours = input.ttlHours ?? (await this.settings.get('invite.ttl_hours'));
    const now = this.clock.now();
    const { token, hash } = generateSecureToken();

    const invitation = await this.tx.run(async () => {
      const created = await this.invitations.create({
        tokenHash: hash,
        email,
        role: input.role,
        invitedBy: actorId,
        expiresAt: new Date(now.getTime() + ttlHours * 3_600_000),
        at: now,
      });
      await this.audit.record({
        actorId,
        action: 'invitation.create',
        entityType: 'invitation',
        entityId: created.id,
        ip,
        diff: { email, role: input.role, ttlHours },
      });
      return created;
    });

    // O link com o token em claro é devolvido UMA vez, só para o admin que criou.
    return { invitation: this.toView(invitation, now), link: this.links.build(token) };
  }

  async list(): Promise<InvitationView[]> {
    const now = this.clock.now();
    return (await this.invitations.list()).map((i) => this.toView(i, now));
  }

  async revoke(actorId: string, id: string, ip: string | null): Promise<InvitationView> {
    return this.tx.run(async () => {
      const now = this.clock.now();
      const inv = await this.invitations.findById(id);
      if (!inv) throw new NotFoundError('Convite não encontrado.');
      if (invitationStatus(inv, now) !== 'pending') {
        throw new ConflictError('Só convites pendentes podem ser revogados.');
      }
      await this.invitations.revoke(id, now);
      await this.audit.record({
        actorId,
        action: 'invitation.revoke',
        entityType: 'invitation',
        entityId: id,
        ip,
      });
      return this.toView({ ...inv, revokedAt: now }, now);
    });
  }

  // -------------------------------------------------------- lado do convidado

  /** Flow, etapa 6: a tela de boas-vindas mostra o e-mail (travado) do convite. */
  async inspect(token: unknown, ctx: RequestContext): Promise<{ email: string; expiresAt: Date }> {
    await enforceRateLimits(this.limiter, [
      { key: `invite:inspect:${ctx.ip ?? 'unknown'}`, limit: 30, windowSeconds: 600 },
    ]);
    const inv = await this.findPending(token);
    return { email: inv.email, expiresAt: inv.expiresAt };
  }

  /** Flow, etapa 10: numa transação, cria o usuário, consome o token e abre a sessão. */
  async accept(
    token: unknown,
    password: string,
    ctx: RequestContext,
  ): Promise<{ user: UserView; session: IssuedSession }> {
    await enforceRateLimits(this.limiter, [
      { key: `invite:accept:${ctx.ip ?? 'unknown'}`, limit: 10, windowSeconds: 600 },
    ]);
    const preview = await this.findPending(token);

    const problems = checkPasswordPolicy(password, preview.email);
    if (problems.length) {
      throw new ValidationError(
        'A senha não atende aos requisitos.',
        problems.map((message) => ({ path: 'password', message })),
      );
    }
    // Argon2 é deliberadamente lento: calcula antes de travar a linha do convite.
    const passwordHash = await this.hasher.hash(password);

    return this.tx.run(async () => {
      const now = this.clock.now();
      const inv = await this.invitations.findByTokenHashForUpdate(hashToken(token as string));
      if (!inv || invitationStatus(inv, now) !== 'pending') throw new InvalidInvitationError();
      if (await this.users.findByEmail(inv.email)) throw new InvalidInvitationError();

      const user = await this.users.create({ email: inv.email, passwordHash, role: inv.role, at: now });
      await this.invitations.markUsed(inv.id, user.id, now);
      await this.users.updateLoginState(user.id, { failedLogins: 0, lockedUntil: null, lastLoginAt: now });
      const session = await this.sessions.issue(user, ctx);
      await this.audit.record({
        actorId: user.id,
        action: 'invitation.accept',
        entityType: 'invitation',
        entityId: inv.id,
        ip: ctx.ip,
        diff: { role: inv.role },
      });
      return { user: toUserView({ ...user, lastLoginAt: now }), session };
    });
  }

  private async findPending(token: unknown): Promise<InvitationRecord> {
    if (!isWellFormedToken(token)) throw new InvalidInvitationError();
    const inv = await this.invitations.findByTokenHash(hashToken(token));
    if (!inv || invitationStatus(inv, this.clock.now()) !== 'pending') {
      throw new InvalidInvitationError();
    }
    return inv;
  }

  private toView(inv: InvitationRecord, now: Date): InvitationView {
    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      status: invitationStatus(inv, now),
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      usedAt: inv.usedAt,
    };
  }
}
