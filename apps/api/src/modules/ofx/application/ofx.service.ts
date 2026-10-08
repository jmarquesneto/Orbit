import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../../infrastructure/database/pg-errors.js';
import {
  AUDIT_LOG,
  type AuditLog,
  CLOCK,
  type Clock,
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/ports.js';
import type { IsoDate } from '../../../shared/domain/calendar.js';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/errors.js';
import { BudgetsService } from '../../budgets/application/budgets.service.js';
import { AccessControlService } from '../../sharing/application/access-control.service.js';
import { TRANSACTION_REPOSITORY, type TransactionRepository } from '../../transactions/application/ports.js';
import { balanceEffect, type TransactionRecord } from '../../transactions/domain/transaction.js';
import { WalletsService } from '../../wallets/application/wallets.service.js';
import { type MatchCandidate, reconcile } from '../domain/matching.js';
import type { OfxStatement } from '../domain/statement.js';
import {
  OFX_PARSER,
  OFX_REPOSITORY,
  type OfxEntryRecord,
  type OfxImportRecord,
  type OfxParser,
  type OfxRepository,
} from './ports.js';

export interface OfxEntryView extends OfxEntryRecord {
  suggestion: { id: string; description: string; amountCents: number; dueDate: IsoDate } | null;
}

export interface OfxImportView {
  import: OfxImportRecord;
  wallet: { id: string; name: string; balanceCents: number };
  entries: OfxEntryView[];
  counts: Record<'linked' | 'suggest' | 'new' | 'other', number>;
}

const SEARCH_MARGIN_DAYS = 10;

function shiftDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const signed = (t: TransactionRecord) => (t.kind === 'income' ? t.amountCents : -t.amountCents);

/**
 * Conciliação bancária (tela "Conciliação OFX"):
 *  1. o arquivo é lido em worker isolada e vira o JSON padronizado;
 *  2. cada linha é comparada aos lançamentos em aberto da conta (valor e data);
 *  3. correspondências exatas são aplicadas sozinhas; o resto espera a decisão da pessoa;
 *  4. FITID já importado e arquivo repetido nunca entram duas vezes.
 */
@Injectable()
export class OfxService {
  constructor(
    @Inject(OFX_PARSER) private readonly parser: OfxParser,
    @Inject(OFX_REPOSITORY) private readonly repo: OfxRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly wallets: WalletsService,
    private readonly budgets: BudgetsService,
    private readonly access: AccessControlService,
  ) {}

  /** Só lê o arquivo e devolve o JSON padronizado, sem gravar nada. */
  parse(bytes: Buffer): Promise<OfxStatement> {
    return this.parser.parse(bytes);
  }

  async importFile(actorId: string, walletId: string, file: { name: string; bytes: Buffer }): Promise<OfxImportView> {
    const statement = await this.parser.parse(file.bytes);
    if (statement.kind !== 'bank') {
      throw new ValidationError('Por enquanto a conciliação aceita extratos de conta. Faturas de cartão: em breve.');
    }
    const sha = createHash('sha256').update(file.bytes).digest();

    try {
      const importId = await this.tx.runAs(actorId, async () => {
        const wallet = await this.wallets.requireSpendable(walletId);
        const created = await this.repo.createImport({
          walletId: wallet.id,
          uploadedBy: actorId,
          fileName: file.name.replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120) || 'extrato.ofx',
          fileSha256: sha,
          bankId: statement.bankId,
          accountMask: statement.accountMask,
          periodStart: statement.period.start,
          periodEnd: statement.period.end,
          ledgerBalanceCents: statement.ledgerBalance?.amountCents ?? null,
        });

        const entries = statement.transactions;
        const dates = entries.map((e) => e.postedAt).sort();
        const candidates = dates.length
          ? await this.transactions.findReconcilable(
              wallet.id,
              shiftDays(dates[0]!, -SEARCH_MARGIN_DAYS),
              shiftDays(dates.at(-1)!, SEARCH_MARGIN_DAYS),
            )
          : [];
        const imported = await this.transactions.existingFitIds(wallet.id, entries.map((e) => e.fitId));
        const results = reconcile(
          entries,
          candidates.map((c): MatchCandidate => ({ id: c.id, signedCents: signed(c), dueDate: c.dueDate })),
          imported,
        );

        const rows = await this.repo.createEntries(
          entries.map((e, i) => ({
            importId: created.id,
            fitid: e.fitId,
            postedAt: e.postedAt,
            amountCents: e.amountCents,
            memo: e.memo,
            match: results[i]!.match,
            score: results[i]!.score,
            suggestedTransactionId: results[i]!.transactionId,
            resolution: results[i]!.match === 'dup' ? 'ignored' : 'pending',
            transactionId: null,
          })),
        );
        // Correspondência exata (mesmo valor, mesmo dia): aplica sem perguntar; dá para desfazer.
        for (const row of rows) {
          if (row.match === 'auto' && row.suggestedTransactionId) {
            try {
              await this.link(row, row.suggestedTransactionId, wallet.id);
            } catch (err) {
              // Sem permissão no orçamento do lançamento: fica como sugestão para a pessoa decidir.
              if (!(err instanceof DomainError)) throw err;
            }
          }
        }
        await this.audit.record({
          actorId,
          action: 'ofx.import',
          entityType: 'ofx_import',
          entityId: created.id,
          diff: { walletId: wallet.id, entries: rows.length },
        });
        return created.id;
      });
      return this.get(actorId, importId);
    } catch (err) {
      if (isUniqueViolation(err, 'ofx_imports_wallet_file_unique')) {
        throw new ConflictError('Este arquivo já foi importado nesta conta.');
      }
      throw err;
    }
  }

  list(actorId: string): Promise<OfxImportRecord[]> {
    return this.tx.runAs(actorId, () => this.repo.listImports(30));
  }

  get(actorId: string, importId: string): Promise<OfxImportView> {
    return this.tx.runAs(actorId, async () => {
      const imp = await this.mustFindImport(importId);
      const wallet = await this.wallets.requireSpendable(imp.walletId);
      const entries = await this.repo.listEntries(importId);
      const views: OfxEntryView[] = [];
      for (const e of entries) {
        const s = e.suggestedTransactionId ? await this.transactions.findById(e.suggestedTransactionId) : null;
        views.push({
          ...e,
          suggestion: s ? { id: s.id, description: s.description, amountCents: s.amountCents, dueDate: s.dueDate } : null,
        });
      }
      const counts = { linked: 0, suggest: 0, new: 0, other: 0 };
      for (const e of entries) {
        if (e.resolution === 'linked' || e.resolution === 'created') counts.linked++;
        else if (e.resolution === 'ignored') counts.other++;
        else if (e.match === 'suggest') counts.suggest++;
        else counts.new++;
      }
      return {
        import: imp,
        wallet: { id: wallet.id, name: wallet.name, balanceCents: wallet.balanceCents },
        entries: views,
        counts,
      };
    });
  }

  /** Confirma a sugestão (ou outro lançamento escolhido) como sendo esta linha do extrato. */
  confirm(actorId: string, importId: string, entryId: string, transactionId?: string): Promise<OfxImportView> {
    return this.mutate(actorId, importId, entryId, async (imp, entry) => {
      const target = transactionId ?? entry.suggestedTransactionId;
      if (!target) throw new ValidationError('Escolha o lançamento correspondente.');
      await this.link(entry, target, imp.walletId);
    });
  }

  /** Cria um lançamento já pago a partir da linha do extrato. */
  createFromEntry(
    actorId: string,
    importId: string,
    entryId: string,
    input: { budgetId: string; categoryId?: string | null; description?: string },
  ): Promise<OfxImportView> {
    return this.mutate(actorId, importId, entryId, async (imp, entry) => {
      await this.access.require(actorId, 'budget', input.budgetId, 'create');
      const kind = entry.amountCents >= 0 ? 'income' : 'expense';
      if (input.categoryId) await this.budgets.requireCategory(input.budgetId, input.categoryId, kind);
      const created = await this.transactions.create({
        budgetId: input.budgetId,
        walletId: imp.walletId,
        categoryId: input.categoryId ?? null,
        invoiceId: null,
        planId: null,
        installmentNo: null,
        description: input.description?.trim() || entry.memo.slice(0, 120),
        amountCents: Math.abs(entry.amountCents),
        kind,
        status: 'paid',
        dueDate: entry.postedAt,
        paidAt: this.clock.now(),
        ofxFitid: entry.fitid,
        createdBy: actorId,
      });
      await this.wallets.adjustBalance(imp.walletId, entry.amountCents);
      await this.repo.resolveEntry(entry.id, 'created', created.id);
    });
  }

  ignore(actorId: string, importId: string, entryId: string): Promise<OfxImportView> {
    return this.mutate(actorId, importId, entryId, async (_imp, entry) => {
      await this.repo.resolveEntry(entry.id, 'ignored', null);
    });
  }

  /** Volta a linha para "pendente", desfazendo o efeito no lançamento e no saldo. */
  undo(actorId: string, importId: string, entryId: string): Promise<OfxImportView> {
    return this.mutate(
      actorId,
      importId,
      entryId,
      async (imp, entry) => {
        if (entry.match === 'dup') throw new ConflictError('Linhas duplicadas não podem ser reabertas.');
        const linked = entry.transactionId ? await this.transactions.findById(entry.transactionId) : null;
        if (entry.resolution === 'linked' && linked) {
          if (!(await this.transactions.unlinkFromBank(linked.id))) throw new ForbiddenError();
          await this.wallets.adjustBalance(imp.walletId, -balanceEffect(linked.kind, linked.amountCents));
        }
        if (entry.resolution === 'created' && linked) {
          await this.access.require(actorId, 'budget', linked.budgetId, 'delete');
          await this.transactions.delete(linked.id);
          await this.wallets.adjustBalance(imp.walletId, -balanceEffect(linked.kind, linked.amountCents));
        }
        await this.repo.resolveEntry(entry.id, 'pending', null);
      },
      { allowResolved: true },
    );
  }

  complete(actorId: string, importId: string): Promise<OfxImportView> {
    return this.tx.runAs(actorId, async () => {
      await this.mustFindImport(importId);
      await this.repo.setImportStatus(importId, 'done');
      return this.get(actorId, importId);
    });
  }

  // ------------------------------------------------------------------ internos

  private async mutate(
    actorId: string,
    importId: string,
    entryId: string,
    fn: (imp: OfxImportRecord, entry: OfxEntryRecord) => Promise<void>,
    opts: { allowResolved?: boolean } = {},
  ): Promise<OfxImportView> {
    await this.tx.runAs(actorId, async () => {
      const imp = await this.mustFindImport(importId);
      const entry = await this.repo.findEntryForUpdate(importId, entryId);
      if (!entry) throw new NotFoundError('Linha do extrato não encontrada.');
      if (!opts.allowResolved && entry.resolution !== 'pending') {
        throw new ConflictError('Esta linha já foi resolvida. Use "Desfazer" para mudar.');
      }
      await fn(imp, entry);
    });
    return this.get(actorId, importId);
  }

  /** Vincula a linha ao lançamento: valor do banco prevalece, lançamento vira pago, saldo ajusta. */
  private async link(entry: OfxEntryRecord, transactionId: string, walletId: string): Promise<void> {
    const target = await this.transactions.findById(transactionId);
    if (!target || target.walletId !== walletId) throw new NotFoundError('Lançamento não encontrado nesta conta.');
    if (target.status === 'paid' || target.ofxFitid) throw new ConflictError('Este lançamento já está pago.');
    if (Math.sign(signed(target)) !== Math.sign(entry.amountCents)) {
      throw new ValidationError('Entrada do extrato só casa com receita; saída, com despesa.');
    }
    const ok = await this.transactions.linkToBank(target.id, {
      amountCents: Math.abs(entry.amountCents),
      paidAt: new Date(`${entry.postedAt}T12:00:00Z`),
      ofxFitid: entry.fitid,
    });
    if (!ok) throw new ForbiddenError('Sem permissão para alterar este lançamento.');
    await this.wallets.adjustBalance(walletId, entry.amountCents);
    await this.repo.resolveEntry(entry.id, 'linked', target.id);
  }

  private async mustFindImport(id: string): Promise<OfxImportRecord> {
    const imp = await this.repo.findImport(id);
    if (!imp) throw new NotFoundError('Importação não encontrada.');
    return imp;
  }
}

