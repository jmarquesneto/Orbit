import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DbContext } from '../../../infrastructure/database/db-context.js';
import { ofxEntries, ofxImports } from '../../../infrastructure/database/schema.js';
import type { OfxEntryRecord, OfxImportRecord, OfxRepository, OfxResolution } from '../application/ports.js';

const importColumns = {
  id: ofxImports.id,
  walletId: ofxImports.walletId,
  uploadedBy: ofxImports.uploadedBy,
  fileName: ofxImports.fileName,
  bankId: ofxImports.bankId,
  accountMask: ofxImports.accountMask,
  periodStart: ofxImports.periodStart,
  periodEnd: ofxImports.periodEnd,
  ledgerBalanceCents: ofxImports.ledgerBalanceCents,
  status: ofxImports.status,
  createdAt: ofxImports.createdAt,
};

@Injectable()
export class DrizzleOfxRepository implements OfxRepository {
  constructor(private readonly ctx: DbContext) {}

  async createImport(data: Parameters<OfxRepository['createImport']>[0]): Promise<OfxImportRecord> {
    const [row] = await this.ctx.db.insert(ofxImports).values(data).returning(importColumns);
    if (!row) throw new Error('Falha ao registrar importação');
    return row;
  }

  async findImport(id: string): Promise<OfxImportRecord | null> {
    const [row] = await this.ctx.db.select(importColumns).from(ofxImports).where(eq(ofxImports.id, id));
    return row ?? null;
  }

  listImports(limit: number): Promise<OfxImportRecord[]> {
    return this.ctx.db.select(importColumns).from(ofxImports).orderBy(desc(ofxImports.createdAt)).limit(limit);
  }

  async setImportStatus(id: string, status: 'review' | 'done') {
    await this.ctx.db.update(ofxImports).set({ status }).where(eq(ofxImports.id, id));
  }

  async createEntries(rows: Omit<OfxEntryRecord, 'id'>[]): Promise<OfxEntryRecord[]> {
    return rows.length ? this.ctx.db.insert(ofxEntries).values(rows).returning() : [];
  }

  listEntries(importId: string): Promise<OfxEntryRecord[]> {
    return this.ctx.db
      .select()
      .from(ofxEntries)
      .where(eq(ofxEntries.importId, importId))
      .orderBy(asc(ofxEntries.postedAt), asc(ofxEntries.fitid));
  }

  async findEntryForUpdate(importId: string, entryId: string): Promise<OfxEntryRecord | null> {
    const [row] = await this.ctx.db
      .select()
      .from(ofxEntries)
      .where(and(eq(ofxEntries.id, entryId), eq(ofxEntries.importId, importId)))
      .for('update');
    return row ?? null;
  }

  async resolveEntry(id: string, resolution: OfxResolution, transactionId: string | null) {
    await this.ctx.db.update(ofxEntries).set({ resolution, transactionId }).where(eq(ofxEntries.id, id));
  }
}
