import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import {
  AUDIT_LOG,
  type AuditLog,
  CLOCK,
  type Clock,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import {
  type Branding,
  isSettingKey,
  SETTING_DEFINITIONS,
  type SettingKey,
  type SettingValue,
} from '../domain/setting-definitions.js';
import {
  BRANDING_CACHE,
  type BrandingCache,
  SETTINGS_REPOSITORY,
  type SettingsRepository,
  type StoredSetting,
} from './ports.js';

export interface SettingView {
  key: string;
  value: unknown;
  isPublic: boolean;
  description: string;
  version: number;
  updatedAt: Date;
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(SETTINGS_REPOSITORY) private readonly repo: SettingsRepository,
    @Inject(BRANDING_CACHE) private readonly cache: BrandingCache,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Identidade pública (nome, cor, logo). Servida a qualquer visitante, com cache. */
  async getBranding(): Promise<Branding> {
    const cached = await this.cache.get();
    if (cached) return cached;
    const rows = new Map((await this.repo.findPublic()).map((s) => [s.key, s.value]));
    const branding: Branding = {
      name: SETTING_DEFINITIONS['app.name'].schema.parse(rows.get('app.name')),
      accent: SETTING_DEFINITIONS['app.accent'].schema.parse(rows.get('app.accent')),
      logoUrl: SETTING_DEFINITIONS['app.logo_url'].schema.parse(rows.get('app.logo_url') ?? null),
    };
    await this.cache.set(branding);
    return branding;
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const row = await this.repo.find(key);
    if (!row) throw new NotFoundError(`Configuração ${key} ausente.`);
    return SETTING_DEFINITIONS[key].schema.parse(row.value) as SettingValue<K>;
  }

  async list(): Promise<SettingView[]> {
    return (await this.repo.findAll())
      .filter((s) => isSettingKey(s.key))
      .map((s) => this.toView(s));
  }

  /** Valida, grava, versiona e audita numa única transação; depois invalida o cache público. */
  async update(
    actorId: string,
    key: string,
    rawValue: unknown,
    meta: { ip: string | null; reason?: string | null },
  ): Promise<SettingView> {
    if (!isSettingKey(key)) throw new NotFoundError('Configuração desconhecida.');
    const parsed = SETTING_DEFINITIONS[key].schema.safeParse(rawValue);
    if (!parsed.success) {
      throw new ValidationError(
        'Valor inválido para esta configuração.',
        parsed.error.issues.map((i) => ({ path: 'value', message: i.message })),
      );
    }
    const value = parsed.data;

    const updated = await this.tx.run(async () => {
      const current = await this.repo.findForUpdate(key);
      if (!current) throw new NotFoundError('Configuração ausente.');
      const now = this.clock.now();
      const nextVersion = current.version + 1;
      await this.repo.update(key, value, nextVersion, actorId, now);
      await this.repo.insertRevision({
        key,
        version: nextVersion,
        oldValue: current.value,
        newValue: value,
        changedBy: actorId,
        reason: meta.reason ?? null,
        at: now,
      });
      await this.audit.record({
        actorId,
        action: 'settings.update',
        entityType: 'system_setting',
        entityId: key,
        ip: meta.ip,
        diff: { from: current.value, to: value, version: nextVersion },
      });
      return { ...current, value, version: nextVersion, updatedBy: actorId, updatedAt: now };
    });

    if (updated.isPublic) await this.cache.invalidate();
    return this.toView(updated);
  }

  private toView(s: StoredSetting): SettingView {
    const def = isSettingKey(s.key) ? SETTING_DEFINITIONS[s.key] : undefined;
    return {
      key: s.key,
      value: s.value,
      isPublic: s.isPublic,
      description: def?.description ?? '',
      version: s.version,
      updatedAt: s.updatedAt,
    };
  }
}
