import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/ports.js';
import { ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  type AccessGrant,
  grantFromRole,
  OWNER_GRANT,
  type Permission,
  type ResourceType,
} from '../domain/permissions.js';
import { SHARING_REPOSITORY, type SharingRepository } from './ports.js';

const NOT_FOUND: Record<ResourceType, string> = {
  budget: 'Orçamento não encontrado.',
  goal: 'Caixinha não encontrada.',
};

/**
 * Verificação de permissão feita em TODA requisição a um orçamento ou caixinha:
 * o usuário autenticado é comparado com o dono e com a tabela resource_shares.
 * (O Row-Level Security do Postgres repete a mesma regra como segunda barreira.)
 *
 * Quem não pode nem ver o recurso recebe 404 — não confirmamos que ele existe.
 * Quem vê mas não tem a permissão pedida recebe 403.
 * Deve ser chamado dentro de `tx.runAs(userId, ...)`.
 */
@Injectable()
export class AccessControlService {
  constructor(
    @Inject(SHARING_REPOSITORY) private readonly repo: SharingRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async grantFor(userId: string, type: ResourceType, id: string): Promise<AccessGrant | null> {
    const ownerId = await this.repo.findOwnerId(type, id);
    if (ownerId === null) return null;
    if (ownerId === userId) return OWNER_GRANT;
    const role = await this.repo.findActiveShareRole(type, id, userId, this.clock.now());
    return role ? grantFromRole(role.code, role) : null;
  }

  async require(
    userId: string,
    type: ResourceType,
    id: string,
    permission: Permission,
  ): Promise<AccessGrant> {
    const grant = await this.grantFor(userId, type, id);
    if (!grant?.can.read) throw new NotFoundError(NOT_FOUND[type]);
    if (!grant.can[permission]) throw new ForbiddenError();
    return grant;
  }

  async requireOwner(userId: string, type: ResourceType, id: string): Promise<void> {
    const grant = await this.require(userId, type, id, 'read');
    if (!grant.isOwner) throw new ForbiddenError('Somente o dono pode fazer isso.');
  }
}
