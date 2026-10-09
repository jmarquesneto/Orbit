import type { Role } from '../../auth/domain/user.js';
import type { InvitationRecord } from '../domain/invitation.js';

export interface InvitationRepository {
  create(data: {
    tokenHash: Buffer;
    email: string;
    name: string | null;
    role: Role;
    invitedBy: string;
    expiresAt: Date;
    at: Date;
  }): Promise<InvitationRecord>;
  findByTokenHash(hash: Buffer): Promise<InvitationRecord | null>;
  /** Trava o convite até o fim da transação: dois aceites simultâneos não passam juntos. */
  findByTokenHashForUpdate(hash: Buffer): Promise<InvitationRecord | null>;
  findById(id: string): Promise<InvitationRecord | null>;
  list(): Promise<InvitationRecord[]>;
  markUsed(id: string, userId: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
}
export const INVITATION_REPOSITORY = Symbol('INVITATION_REPOSITORY');

/** Monta o link público do convite (o frontend tem a tela /convite). */
export interface InvitationLinkBuilder {
  /** `origin`: endereço que o admin está usando; sem ele, vale WEB_ORIGIN. */
  build(token: string, origin?: string | null): string;
}
export const INVITATION_LINK_BUILDER = Symbol('INVITATION_LINK_BUILDER');
