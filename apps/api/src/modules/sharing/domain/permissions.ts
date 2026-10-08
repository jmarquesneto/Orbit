export const RESOURCE_TYPES = ['budget', 'goal'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const PERMISSIONS = ['read', 'update', 'create', 'delete', 'share'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Papéis do MER (share_roles · seed). O dono não é um papel gravado: é implícito. */
export const SHARE_ROLE_CODES = ['read', 'edit', 'create'] as const;
export type ShareRoleCode = (typeof SHARE_ROLE_CODES)[number];

export interface ShareRoleFlags {
  canRead: boolean;
  canUpdate: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canShare: boolean;
}

export interface AccessGrant {
  role: 'owner' | ShareRoleCode;
  isOwner: boolean;
  can: Record<Permission, boolean>;
}

export const OWNER_GRANT: AccessGrant = {
  role: 'owner',
  isOwner: true,
  can: { read: true, update: true, create: true, delete: true, share: true },
};

export function grantFromRole(code: ShareRoleCode, flags: ShareRoleFlags): AccessGrant {
  return {
    role: code,
    isOwner: false,
    can: {
      read: flags.canRead,
      update: flags.canUpdate,
      create: flags.canCreate,
      delete: flags.canDelete,
      share: flags.canShare,
    },
  };
}

export function isShareActive(share: { revokedAt: Date | null; expiresAt: Date | null }, now: Date): boolean {
  return share.revokedAt === null && (share.expiresAt === null || share.expiresAt > now);
}
