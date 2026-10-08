'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { SharePanel } from '@/components/share-panel';
import { ErrorAlert, Loading, PageHeader, Progress } from '@/components/ui';
import { api, del, errorMessage, post } from '@/lib/api';
import { currentMonth, money, monthLabel, parseMoneyInput, percent, shiftMonth } from '@/lib/format';
import { keys } from '@/lib/queries';
import type { Budget, BudgetSummary } from '@/lib/types';
import { ROLE_LABEL } from '@/lib/types';

export function BudgetDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'expense' | 'income'>('expense');

  const budget = useQuery({ queryKey: ['budget', id], queryFn: () => api<{ budget: Budget }>(`/budgets/${id}`).then((r) => r.budget) });
  const summary = useQuery({
    queryKey: keys.summary(id, month),
    queryFn: () => api<{ summary: BudgetSummary }>(`/budgets/${id}/summary?month=${month}`).then((r) => r.summary),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
    void queryClient.invalidateQueries({ queryKey: keys.categories(id) });
  };
  const addCategory = useMutation({
    mutationFn: (body: { name: string; kind: string; plannedCents: number }) => post(`/budgets/${id}/categories`, body),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const removeCategory = useMutation({
    mutationFn: (categoryId: string) => del(`/budgets/${id}/categories/${categoryId}`),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  const archive = useMutation({
    mutationFn: () => del(`/budgets/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['budgets'] });
      router.push('/orcamentos');
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function onAddCategory(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const planned = String(form.get('planned') ?? '');
    const plannedCents = planned ? parseMoneyInput(planned) : 0;
    if (plannedCents === null) return setError('Valor planejado inválido. Ex.: 1.500,00');
    addCategory.mutate({ name: String(form.get('name')), kind, plannedCents });
    e.currentTarget.reset();
  }

  if (budget.isLoading) return <Loading />;
  if (!budget.data) return <ErrorAlert error={errorMessage(budget.error)} />;
  const b = budget.data;
  const s = summary.data;
  const perms = b.permissions;
  const months = Array.from({ length: 7 }, (_, i) => shiftMonth(currentMonth(), i - 3));

  return (
    <>
      <PageHeader eyebrow={<><Link href="/orcamentos" className="muted">Orçamentos</Link> / {ROLE_LABEL[b.role]}</>} title={b.name}>
        <select className="select" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        {b.role === 'owner' && (
          <button type="button" className="btn danger" onClick={() => confirm(`Arquivar “${b.name}”?`) && archive.mutate()}>
            Arquivar
          </button>
        )}
      </PageHeader>
      <ErrorAlert error={error} />

      {s && (
        <section className="grid" style={{ ['--min' as string]: '200px' }} aria-label="Resumo">
          <div className="card" style={{ gap: 6 }}>
            <span className="small muted">Receitas</span>
            <span className="stat-value income">{money(s.totals.incomeCents)}</span>
          </div>
          <div className="card" style={{ gap: 6 }}>
            <span className="small muted">Despesas</span>
            <span className="stat-value expense">{money(s.totals.expenseCents)}</span>
          </div>
          <div className="card" style={{ gap: 6 }}>
            <span className="small muted">Saldo do mês</span>
            <span className="stat-value">{money(s.totals.balanceCents)}</span>
          </div>
          <div className="card" style={{ gap: 6 }}>
            <span className="small muted">Gasto do planejado</span>
            <span className="stat-value">{percent(s.totals.expenseCents, s.totals.plannedExpenseCents)}%</span>
            <Progress value={s.totals.expenseCents} max={s.totals.plannedExpenseCents} />
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="h-cat">
        <h2 id="h-cat" style={{ fontSize: 17 }}>
          Categorias · planejado x realizado
        </h2>
        {s?.categories.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Categoria</th>
                  <th scope="col" className="num">Planejado</th>
                  <th scope="col" className="num">Realizado</th>
                  <th scope="col" style={{ width: '28%' }}>Uso</th>
                  <th scope="col"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {s.categories.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name} <span className={`badge${c.kind === 'income' ? ' ok' : ' warn'}`}>{c.kind === 'income' ? 'Receita' : 'Despesa'}</span>
                    </td>
                    <td className="num">{money(c.plannedCents)}</td>
                    <td className="num">{money(c.actualCents)}</td>
                    <td>{c.plannedCents > 0 && <Progress value={c.actualCents} max={c.plannedCents} />}</td>
                    <td>
                      {perms?.delete && (
                        <button type="button" className="btn small danger" onClick={() => confirm(`Excluir “${c.name}”? Os lançamentos ficam sem categoria.`) && removeCategory.mutate(c.id)}>
                          Excluir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <span className="small muted">Nenhuma categoria ainda.</span>
        )}
        {perms?.create && (
          <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={onAddCategory}>
            <div className="segmented" role="group" aria-label="Tipo da categoria">
              <button type="button" className="expense" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>
                Despesa
              </button>
              <button type="button" className="income" aria-pressed={kind === 'income'} onClick={() => setKind('income')}>
                Receita
              </button>
            </div>
            <label className="field" style={{ flex: '2 1 200px' }}>
              Nome
              <input className="input" name="name" required maxLength={60} placeholder="Mercado" />
            </label>
            <label className="field" style={{ flex: '1 1 140px' }}>
              Planejado no mês (R$)
              <input className="input mono" name="planned" inputMode="decimal" placeholder="0,00" />
            </label>
            <button className="btn primary" type="submit" disabled={addCategory.isPending}>
              Adicionar
            </button>
          </form>
        )}
      </section>

      <SharePanel type="budget" id={id} isOwner={b.role === 'owner'} />
    </>
  );
}
