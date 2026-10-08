import { Inject, Injectable } from '@nestjs/common';
import { enforceRateLimits } from '../../../shared/application/rate-limit.js';
import {
  AUDIT_LOG,
  type AuditLog,
  CLOCK,
  type Clock,
  RATE_LIMITER,
  type RateLimiter,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { USER_REPOSITORY, type UserRepository } from '../../auth/application/ports.js';
import type { ResourceType, ShareRoleCode } from '../domain/permissions.js';
import { AccessControlService } from './access-control.service.js';
import { type ShareRecord, type ShareRoleRecord, SHARING_REPOSITORY, type SharingRepository } from './ports.js';

export interface ShareView {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  grantee: { id: string; email: string };
  role: ShareRoleCode;
  expiresAt: Date | null;
  createdAt: Date;
}

function toView(s: ShareRecord): ShareView {
  return {
    id: s.id,
    resourceType: s.resourceType,
    resourceId: s.resourceId,
    grantee: { id: s.granteeId, email: s.granteeEmail },
    role: s.roleCode,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
  };
}

@Injectable()
export class SharingService {
  constructor(
    @Inject(SHARING_REPOSITORY) private readonly repo: SharingRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
  ) {}

  listRoles(): Promise<ShareRoleRecord[]> {
    return this.repo.listRoles();
  }

  async share(
    actorId: string,
    input: { type: ResourceType; resourceId: string; email: string; role: ShareRoleCode; expiresAt?: Date },
    ip: string | null,
  ): Promise<ShareView> {
    // Limita a "sondagem" de e-mails cadastrados por meio do compartilhamento.
    await enforceRateLimits(this.limiter, [{ key: `share:${actorId}`, limit: 30, windowSeconds: 3_600 }]);
    if (input.expiresAt && input.expiresAt <= this.clock.now()) {
      throw new ValidationError('A data de expiração precisa estar no futuro.');
    }

    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, input.type, input.resourceId, 'share');
      const role = await this.repo.findRole(input.role);
      if (!role) throw new ValidationError('Papel de compartilhamento inválido.');

      const grantee = await this.users.findByEmail(input.email.trim().toLowerCase());
      if (!grantee || grantee.status !== 'active') {
        throw new NotFoundError('Não encontramos um usuário ativo com este e-mail.');
      }
      const ownerId = await this.repo.findOwnerId(input.type, input.resourceId);
      if (grantee.id === ownerId) throw new ConflictError('O dono já tem acesso total.');

      const created = await this.repo.create({
        type: input.type,
        resourceId: input.resourceId,
        granteeId: grantee.id,
        roleCode: role.code,
        grantedBy: actorId,
        expiresAt: input.expiresAt ?? null,
      });
      await this.audit.record({
        actorId,
        action: 'share.grant',
        entityType: input.type,
        entityId: input.resourceId,
        ip,
        diff: { granteeId: grantee.id, role: role.code },
      });
      return toView(created);
    });
  }

  list(actorId: string, type: ResourceType, resourceId: string): Promise<ShareView[]> {
    return this.tx.runAs(actorId, async () => {
      await this.access.require(actorId, type, resourceId, 'read');
      return (await this.repo.listActiveForResource(type, resourceId, this.clock.now())).map(toView);
    });
  }

  /** O dono revoga qualquer acesso; o convidado pode sair de um compartilhamento. */
  revoke(actorId: string, shareId: string, ip: string | null): Promise<void> {
    return this.tx.runAs(actorId, async () => {
      const share = await this.repo.findById(shareId);
      if (!share || share.revokedAt) throw new NotFoundError('Compartilhamento não encontrado.');
      if (share.granteeId !== actorId) {
        await this.access.require(actorId, share.resourceType, share.resourceId, 'share');
      }
      await this.repo.revoke(shareId, this.clock.now());
      await this.audit.record({
        actorId,
        action: 'share.revoke',
        entityType: share.resourceType,
        entityId: share.resourceId,
        ip,
        diff: { granteeId: share.granteeId },
      });
    });
  }
}
