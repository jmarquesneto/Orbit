import type { ResourceType, ShareRoleCode, ShareRoleFlags } from '../domain/permissions.js';

export interface ShareRoleRecord extends ShareRoleFlags {
  code: ShareRoleCode;
  label: string;
}

export interface ShareRecord {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  granteeId: string;
  granteeEmail: string;
  roleCode: ShareRoleCode;
  grantedBy: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface SharingRepository {
  /** Dono do recurso, se o usuário corrente puder vê-lo (RLS); senão null. */
  findOwnerId(type: ResourceType, id: string): Promise<string | null>;
  findActiveShareRole(
    type: ResourceType,
    id: string,
    userId: string,
    now: Date,
  ): Promise<ShareRoleRecord | null>;
  listRoles(): Promise<ShareRoleRecord[]>;
  findRole(code: string): Promise<ShareRoleRecord | null>;
  listActiveForResource(type: ResourceType, id: string, now: Date): Promise<ShareRecord[]>;
  findById(id: string): Promise<ShareRecord | null>;
  create(data: {
    type: ResourceType;
    resourceId: string;
    granteeId: string;
    roleCode: ShareRoleCode;
    grantedBy: string;
    expiresAt: Date | null;
  }): Promise<ShareRecord>;
  revoke(id: string, at: Date): Promise<void>;
}
export const SHARING_REPOSITORY = Symbol('SHARING_REPOSITORY');
