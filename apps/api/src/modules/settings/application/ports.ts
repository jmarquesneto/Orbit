import type { Branding } from '../domain/setting-definitions.js';

export interface StoredSetting {
  key: string;
  value: unknown;
  isPublic: boolean;
  version: number;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface SettingsRepository {
  findAll(): Promise<StoredSetting[]>;
  findPublic(): Promise<StoredSetting[]>;
  find(key: string): Promise<StoredSetting | null>;
  /** Trava a linha até o fim da transação (evita duas edições simultâneas). */
  findForUpdate(key: string): Promise<StoredSetting | null>;
  update(key: string, value: unknown, nextVersion: number, actorId: string, at: Date): Promise<void>;
  insertRevision(rev: {
    key: string;
    version: number;
    oldValue: unknown;
    newValue: unknown;
    changedBy: string;
    reason: string | null;
    at: Date;
  }): Promise<void>;
}
export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');

export interface BrandingCache {
  get(): Promise<Branding | null>;
  set(branding: Branding): Promise<void>;
  invalidate(): Promise<void>;
}
export const BRANDING_CACHE = Symbol('BRANDING_CACHE');
