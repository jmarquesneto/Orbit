import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { settingRevisions, systemSettings } from '../../../infrastructure/database/schema.js';
import type { SettingsRepository, StoredSetting } from '../application/ports.js';

@Injectable()
export class DrizzleSettingsRepository implements SettingsRepository {
  constructor(private readonly ctx: DbContext) {}

  findAll(): Promise<StoredSetting[]> {
    return this.ctx.db.select().from(systemSettings).orderBy(asc(systemSettings.key));
  }

  findPublic(): Promise<StoredSetting[]> {
    return this.ctx.db.select().from(systemSettings).where(eq(systemSettings.isPublic, true));
  }

  async find(key: string): Promise<StoredSetting | null> {
    const [row] = await this.ctx.db.select().from(systemSettings).where(eq(systemSettings.key, key));
    return row ?? null;
  }

  async findForUpdate(key: string): Promise<StoredSetting | null> {
    const [row] = await this.ctx.db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .for('update');
    return row ?? null;
  }

  async update(key: string, value: unknown, nextVersion: number, actorId: string, at: Date) {
    await this.ctx.db
      .update(systemSettings)
      .set({ value, version: nextVersion, updatedBy: actorId, updatedAt: at })
      .where(eq(systemSettings.key, key));
  }

  async insertRevision(rev: Parameters<SettingsRepository['insertRevision']>[0]) {
    await this.ctx.db.insert(settingRevisions).values({
      settingKey: rev.key,
      version: rev.version,
      oldValue: rev.oldValue,
      newValue: rev.newValue,
      changedBy: rev.changedBy,
      reason: rev.reason,
      changedAt: rev.at,
    });
  }
}
