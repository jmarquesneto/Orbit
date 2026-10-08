'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { BudgetPicker } from '@/components/budget-picker';
import { Icon } from '@/components/icons';
import { Empty, ErrorAlert, PageHeader } from '@/components/ui';
import { api, errorMessage, post } from '@/lib/api';
import { isoToBr, isoToShort, money, signedMoney } from '@/lib/format';
import { useBudgets, useWallets } from '@/lib/queries';
import type { OfxCandidate, OfxEntry, OfxImportView } from '@/lib/types';

type Filter = 'all' | 'ok' | 'suggest' | 'new' | 'other';

function group(e: OfxEntry): Exclude<Filter, 'all'> {
  if (e.resolution === 'linked' || e.resolution === 'created') return 'ok';
  if (e.resolution === 'ignored') return 'other';
  return e.match === 'suggest' ? 'suggest' : 'new';
}

function badge(e: OfxEntry): [string, string] {
  if (e.match === 'dup') return ['Duplicado', ''];
  if (e.resolution === 'linked') return [e.match === 'auto' ? 'Conciliado automaticamente' : 'Conciliado por você', 'ok'];
  if (e.resolution === 'created') return ['Lançamento criado', 'ok'];
  if (e.resolution === 'ignored') return ['Ignorado', ''];
  if (e.match === 'suggest') return [`Sugestão · ${e.score}% de confiança`, 'info'];
  return ['Novo', 'warn'];
}

function matchText(e: OfxEntry): [string, string] {
  if (e.match === 'dup') return ['Já importado antes', 'Mesmo FITID — descartado automaticamente'];
  if (e.suggestion) {
    const diff = Math.abs(e.amountCents) - e.suggestion.amountCents;
    return [
      `${e.suggestion.description} (${money(e.suggestion.amountCents)})`,
      diff === 0 ? `Valor idêntico · vence ${isoToBr(e.suggestion.dueDate)}` : `Valor difere ${money(Math.abs(diff))} · o do banco prevalece`,
    ];
  }
  if (e.resolution === 'created') return ['Lançamento criado a partir do extrato', 'Já conta no saldo da carteira'];
  return ['Sem correspondência', 'Crie um lançamento ou ignore'];
}

const TABS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'ok', label: 'Conciliadas' },
  { id: 'suggest', label: 'Sugestões' },
  { id: 'new', label: 'Novas' },
  { id: 'other', label: 'Duplicadas / ignoradas' },
];

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Arquivo enviado', 'Revisar correspondências', 'Confirmar'];
  return (
    <ol className="row" style={{ margin: 0, padding: 0, listStyle: 'none', gap: 8, fontSize: 14 }}>
      {steps.map((s, i) => {
        const n = i + 1;
        const style =
          n < current
            ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' }
            : n === current
              ? { background: 'var(--neutral-bg)', color: 'var(--text)', fontWeight: 600 }
              : { border: '1px solid var(--border-strong)', color: 'var(--muted)' };
        return (
          <li key={s} aria-current={n === current ? 'step' : undefined} className="row" style={{ gap: 8, padding: '6px 12px', borderRadius: 99, ...style }}>
            <span className="mono">{n}</span>
            {s}
          </li>
        );
      })}
    </ol>
  );
}

function Upload({ onImported }: { onImported: (v: OfxImportView) => void }) {
  const wallets = useWallets();
  const accounts = (wallets.data ?? []).filter((w) => w.type !== 'credit');
  const [error, setError] = useState<string | null>(null);
  const recent = useQuery({
    queryKey: ['ofx-imports'],
    queryFn: () => api<{ imports: OfxImportView['import'][] }>('/ofx/imports').then((r) => r.imports),
  });
  const upload = useMutation({
    mutationFn: (form: FormData) => api<OfxImportView>('/ofx/imports', { method: 'POST', body: form }),
    onSuccess: onImported,
    onError: (e) => setError(errorMessage(e)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    upload.mutate(new FormData(e.currentTarget));
  }

  if (wallets.data && !accounts.length) {
    return (
      <Empty title="Cadastre a conta do banco primeiro">
        <Link className="btn primary" href="/carteiras">Criar carteira</Link>
      </Empty>
    );
  }

  return (
    <>
      <form className="card" onSubmit={onSubmit}>
        <h2 style={{ fontSize: 17 }}>Enviar extrato</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Exporte o extrato no formato OFX pelo site ou app do seu banco. O arquivo é lido num processo isolado, sem rede,
          com limite de 5 MB; textos são saneados antes de salvar.
        </p>
        <ErrorAlert error={error} />
        <div className="form-grid" style={{ alignItems: 'end' }}>
          <label className="field">
            Conta de destino
            <select className="select" name="walletId" required>
              {accounts.map((w) => <option key={w.id} value={w.id}>{w.name}{w.last4 ? ` ••${w.last4}` : ''}</option>)}
            </select>
          </label>
          <label className="field">
            Arquivo .ofx
            <input className="input" style={{ paddingTop: 9 }} type="file" name="file" accept=".ofx,.qfx" required />
          </label>
          <button className="btn primary" type="submit" disabled={upload.isPending}>
            <Icon name="file" />
            {upload.isPending ? 'Lendo…' : 'Importar'}
          </button>
        </div>
      </form>
      {recent.data && recent.data.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: 17 }}>Importações recentes</h2>
          <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recent.data.map((i) => (
              <li key={i.id} className="between">
                <span>
                  {i.fileName}{' '}
                  <span className="small muted">
                    {i.periodStart && i.periodEnd ? `${isoToBr(i.periodStart)} – ${isoToBr(i.periodEnd)}` : ''}
                  </span>
                </span>
                <span className="row" style={{ gap: 8 }}>
                  <span className={`badge${i.status === 'done' ? ' ok' : ' info'}`}>{i.status === 'done' ? 'Concluída' : 'Em revisão'}</span>
                  <button type="button" className="btn small" onClick={() => api<OfxImportView>(`/ofx/imports/${i.id}`).then(onImported)}>
                    Abrir
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** "Escolher outro": lançamentos em aberto desta conta, do mais provável ao menos provável. */
function CandidatePicker({
  importId,
  entry,
  busy,
  onPick,
  onCancel,
}: {
  importId: string;
  entry: OfxEntry;
  busy: boolean;
  onPick: (transactionId: string) => void;
  onCancel: () => void;
}) {
  const candidates = useQuery({
    queryKey: ['ofx-candidates', importId, entry.id],
    queryFn: () =>
      api<{ candidates: OfxCandidate[] }>(`/ofx/imports/${importId}/entries/${entry.id}/candidates`).then((r) => r.candidates),
  });
  const list = candidates.data ?? [];
  return (
    <div className="stack-sm" style={{ flex: '1 1 100%', padding: 14, background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 10 }}>
      <div className="between">
        <span className="small text-2">
          Qual lançamento é este {entry.amountCents < 0 ? 'pagamento' : 'recebimento'} de {money(Math.abs(entry.amountCents))}?
        </span>
        <button type="button" className="btn link small" onClick={onCancel}>Fechar</button>
      </div>
      {candidates.isLoading ? (
        <span className="small muted" role="status">Procurando lançamentos…</span>
      ) : candidates.error ? (
        <ErrorAlert error={errorMessage(candidates.error)} />
      ) : !list.length ? (
        <span className="small muted">
          Nenhum lançamento em aberto nesta conta perto dessa data (±45 dias). Use “Criar lançamento”.
        </span>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Lançamentos em aberto">
          {list.map((c) => {
            const diff = Math.abs(entry.amountCents) - c.amountCents;
            return (
              <li key={c.id} className="row" style={{ gap: 12, padding: '8px 0', borderTop: '1px solid var(--border-row)' }}>
                <span className="mono small muted">{isoToShort(c.dueDate)}</span>
                <span className="stack-sm" style={{ flex: '1 1 200px', gap: 0, minWidth: 0 }}>
                  <span style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{c.description}</span>
                  <span className="xsmall muted">
                    {money(c.amountCents)}
                    {diff === 0 ? ' · valor idêntico' : ` · difere ${money(Math.abs(diff))}`}
                    {c.score > 0 ? ` · ${c.score}% de confiança` : ''}
                    {c.id === entry.suggestion?.id ? ' · sugerido' : ''}
                  </span>
                </span>
                <button type="button" className="btn small" disabled={busy} onClick={() => onPick(c.id)}>
                  Usar este
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Review({ view, onChange, onClose }: { view: OfxImportView; onChange: (v: OfxImportView) => void; onClose: () => void }) {
  const queryClient = useQueryClient();
  const budgets = useBudgets();
  const [filter, setFilter] = useState<Filter>('all');
  const [budgetId, setBudgetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const writable = (budgets.data ?? []).filter((b) => b.role === 'owner' || b.role === 'create');
  useEffect(() => {
    if (!budgetId && writable[0]) setBudgetId(writable[0].id);
  }, [writable, budgetId]);

  const act = useMutation({
    mutationFn: ({
      entry,
      action,
      transactionId,
    }: {
      entry: OfxEntry;
      action: 'confirm' | 'create' | 'ignore' | 'undo';
      transactionId?: string;
    }) =>
      post<OfxImportView>(
        `/ofx/imports/${view.import.id}/entries/${entry.id}/${action}`,
        action === 'create' ? { budgetId } : transactionId ? { transactionId } : {},
      ),
    onSuccess: (v) => {
      setError(null);
      setPicking(null);
      void queryClient.invalidateQueries({ queryKey: ['ofx-candidates'] });
      onChange(v);
      void queryClient.invalidateQueries({ queryKey: ['wallets'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const complete = useMutation({
    mutationFn: () => post<OfxImportView>(`/ofx/imports/${view.import.id}/complete`),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const counts = { all: view.entries.length, ok: 0, suggest: 0, new: 0, other: 0 };
  view.entries.forEach((e) => counts[group(e)]++);
  const rows = view.entries.filter((e) => filter === 'all' || group(e) === filter);
  const pending = counts.suggest + counts.new;
  const ledger = view.import.ledgerBalanceCents;
  const matches = ledger !== null && ledger === view.wallet.balanceCents;

  return (
    <>
      <section aria-label="Arquivo importado" className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 24 }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 14, minWidth: 0 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--hover)', display: 'grid', placeItems: 'center', color: 'var(--text-2)' }}>
            <Icon name="file" size={22} />
          </div>
          <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{view.import.fileName}</span>
            <span className="small muted">
              {view.import.periodStart && view.import.periodEnd
                ? `${isoToShort(view.import.periodStart)} – ${isoToBr(view.import.periodEnd)} · `
                : ''}
              {view.entries.length} transações · conta {view.wallet.name}
            </span>
          </div>
        </div>
        <div style={{ minWidth: 220 }}>
          <BudgetPicker budgets={budgets.data ?? []} value={budgetId} onChange={setBudgetId} label="Orçamento para lançamentos novos" onlyWritable />
        </div>
        <span className="row small" style={{ gap: 6, color: 'var(--ok-fg)', alignSelf: 'center' }}>
          <Icon name="check" size={14} />
          Arquivo validado
        </span>
      </section>

      <div role="tablist" aria-label="Filtrar transações" className="row" style={{ gap: 8 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={filter === t.id}
            onClick={() => setFilter(t.id)}
            className="btn small"
            style={{ borderColor: filter === t.id ? 'var(--accent)' : undefined, background: filter === t.id ? 'var(--hover)' : undefined }}
          >
            {t.label}
            <span className="mono xsmall" style={{ padding: '0 8px', borderRadius: 99, background: 'var(--bg)', color: 'var(--text-2)' }}>
              {counts[t.id]}
            </span>
          </button>
        ))}
      </div>
      <ErrorAlert error={error} />

      <section aria-label="Correspondências" className="card" style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
        <div className="row xsmall muted" style={{ padding: '10px 20px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em', gap: 16 }}>
          <span style={{ flex: '1 1 300px' }}>No extrato (OFX)</span>
          <span style={{ flex: '1 1 300px' }}>No sistema</span>
          <span style={{ flex: '0 1 260px', textAlign: 'right' }}>Ação</span>
        </div>
        {rows.map((e) => {
          const [label, tone] = badge(e);
          const [title, sub] = matchText(e);
          const done = e.resolution !== 'pending';
          return (
            <div key={e.id} className="row" style={{ gap: 16, padding: '16px 20px', borderBottom: '1px solid var(--border-row)', flexWrap: 'wrap' }}>
              <div className="row" style={{ flex: '1 1 300px', minWidth: 0, gap: 14, alignItems: 'flex-start' }}>
                <span className="mono small muted" style={{ paddingTop: 2 }}>{isoToShort(e.postedAt)}</span>
                <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
                  <span className="mono small" style={{ overflowWrap: 'anywhere' }}>{e.memo}</span>
                  <span className={`mono ${e.amountCents < 0 ? 'expense' : 'income'}`}>{signedMoney(e.amountCents)}</span>
                </div>
              </div>
              <div className="stack-sm" style={{ flex: '1 1 300px', minWidth: 0, gap: 4 }}>
                <span className={`badge ${tone}`}>{label}</span>
                <span style={{ fontSize: 14 }}>{title}</span>
                <span className="xsmall muted">{sub}</span>
              </div>
              <div className="row" style={{ flex: '0 1 260px', justifyContent: 'flex-end', gap: 8 }}>
                {!done && e.match === 'suggest' && (
                  <>
                    <button type="button" className="btn small" onClick={() => act.mutate({ entry: e, action: 'ignore' })}>Ignorar</button>
                    <button type="button" className="btn small" aria-expanded={picking === e.id} onClick={() => setPicking(picking === e.id ? null : e.id)}>
                      Escolher outro
                    </button>
                    <button type="button" className="btn small primary" onClick={() => act.mutate({ entry: e, action: 'confirm' })}>Confirmar</button>
                  </>
                )}
                {!done && e.match === 'new' && (
                  <>
                    <button type="button" className="btn small" onClick={() => act.mutate({ entry: e, action: 'ignore' })}>Ignorar</button>
                    <button type="button" className="btn small" aria-expanded={picking === e.id} onClick={() => setPicking(picking === e.id ? null : e.id)}>
                      Vincular a existente
                    </button>
                    <button type="button" className="btn small primary" disabled={!budgetId} onClick={() => act.mutate({ entry: e, action: 'create' })}>
                      Criar lançamento
                    </button>
                  </>
                )}
                {done && e.match !== 'dup' && (
                  <button type="button" className="btn link" onClick={() => act.mutate({ entry: e, action: 'undo' })}>Desfazer</button>
                )}
              </div>
              {!done && picking === e.id && (
                <CandidatePicker
                  importId={view.import.id}
                  entry={e}
                  busy={act.isPending}
                  onPick={(transactionId) => act.mutate({ entry: e, action: 'confirm', transactionId })}
                  onCancel={() => setPicking(null)}
                />
              )}
            </div>
          );
        })}
      </section>

      <footer className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="row" style={{ gap: 24 }}>
          <div className="stack-sm" style={{ gap: 0 }}>
            <span className="xsmall muted">Saldo final do extrato</span>
            <span className="mono" style={{ fontSize: 17 }}>{ledger === null ? '—' : money(ledger)}</span>
          </div>
          <div className="stack-sm" style={{ gap: 0 }}>
            <span className="xsmall muted">Saldo no sistema agora</span>
            <span className="mono" style={{ fontSize: 17, color: matches ? 'var(--income)' : undefined }}>
              {money(view.wallet.balanceCents)}
              {matches ? ' · confere' : ''}
            </span>
          </div>
          <div className="stack-sm" style={{ gap: 0 }}>
            <span className="xsmall muted">Pendentes</span>
            <span className="mono" style={{ fontSize: 17 }}>{pending === 0 ? 'nenhum' : pending}</span>
          </div>
        </div>
        <button type="button" className="btn primary" onClick={() => complete.mutate()} disabled={complete.isPending}>
          Concluir conciliação
        </button>
      </footer>
    </>
  );
}

/** Tela "Conciliação OFX" do design. */
export function OfxScreen() {
  const [view, setView] = useState<OfxImportView | null>(null);
  return (
    <>
      <PageHeader eyebrow="Importação de extrato" title="Conciliação bancária">
        <Steps current={view ? 2 : 1} />
      </PageHeader>
      {view ? <Review view={view} onChange={setView} onClose={() => setView(null)} /> : <Upload onImported={setView} />}
    </>
  );
}
