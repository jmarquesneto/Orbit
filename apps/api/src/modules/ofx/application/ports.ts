import type { IsoDate } from '../../../shared/domain/calendar.js';
import type { MatchKind } from '../domain/matching.js';
import type { OfxStatement } from '../domain/statement.js';

export interface OfxParser {
  /** Lê os bytes de um arquivo OFX e devolve o extrato no formato padronizado. */
  parse(bytes: Buffer): Promise<OfxStatement>;
}
export const OFX_PARSER = Symbol('OFX_PARSER');

export type OfxResolution = 'pending' | 'linked' | 'created' | 'ignored';

export interface OfxImportRecord {
  id: string;
  walletId: string;
  uploadedBy: string;
  fileName: string;
  bankId: string | null;
  accountMask: string | null;
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
  ledgerBalanceCents: number | null;
  status: 'review' | 'done';
  createdAt: Date;
}

export interface OfxEntryRecord {
  id: string;
  importId: string;
  fitid: string;
  postedAt: IsoDate;
  amountCents: number;
  memo: string;
  match: MatchKind;
  score: number;
  suggestedTransactionId: string | null;
  resolution: OfxResolution;
  transactionId: string | null;
}

export interface OfxRepository {
  createImport(data: Omit<OfxImportRecord, 'id' | 'createdAt' | 'status'> & { fileSha256: Buffer }): Promise<OfxImportRecord>;
  findImport(id: string): Promise<OfxImportRecord | null>;
  listImports(limit: number): Promise<OfxImportRecord[]>;
  setImportStatus(id: string, status: 'review' | 'done'): Promise<void>;
  createEntries(rows: Omit<OfxEntryRecord, 'id'>[]): Promise<OfxEntryRecord[]>;
  listEntries(importId: string): Promise<OfxEntryRecord[]>;
  findEntryForUpdate(importId: string, entryId: string): Promise<OfxEntryRecord | null>;
  resolveEntry(id: string, resolution: OfxResolution, transactionId: string | null): Promise<void>;
}
export const OFX_REPOSITORY = Symbol('OFX_REPOSITORY');
