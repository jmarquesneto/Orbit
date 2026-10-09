import type { Role } from '../../auth/domain/user.js';

export interface InvitationRecord {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  invitedBy: string;
  expiresAt: Date;
  usedAt: Date | null;
  usedBy: string | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export type InvitationStatus = 'pending' | 'used' | 'revoked' | 'expired';

/** Flow, etapa 5: "existe, não expirou, não usado, não revogado". */
export function invitationStatus(inv: InvitationRecord, now: Date): InvitationStatus {
  if (inv.usedAt) return 'used';
  if (inv.revokedAt) return 'revoked';
  if (inv.expiresAt <= now) return 'expired';
  return 'pending';
}

export const MIN_TTL_HOURS = 1;
export const MAX_TTL_HOURS = 24 * 30;
