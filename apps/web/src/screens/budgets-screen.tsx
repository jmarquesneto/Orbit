'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Empty, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import { errorMessage, post } from '@/lib/api';
import { useBudgets } from '@/lib/queries';
import type { Budget } from '@/lib/types';
import { ROLE_LABEL } from '@/lib/types';

export function BudgetsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const budgets = useBudgets();
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { name: string; periodStartDay: number }) => post<{ budget: Budget }>('/budgets', body),
    onSuccess: async ({ budget }) => {
      await queryClient.invalidateQueries({ queryKey: ['budgets'] });
      router.push(`/orcamentos/${budget.id}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({ name: String(form.get('name')), periodStartDay: Number(form.get('periodStartDay')) });
  }

  return (
    <>
      <PageHeader eyebrow="Planejamento" title="Orçamentos" />
      <form className="card" onSubmit={onSubmit}>
        <h2 style={{ fontSize: 17 }}>Novo orçamento</h2>
        <ErrorAlert error={error} />
        <div className="form-grid" style={{ alignItems: 'end' }}>
          <label className="field">
            Nome
            <input className="input" name="name" placeholder="Pessoal" defaultValue={budgets.data?.length ? '' : 'Pessoal'} required maxLength={60} />
          </label>
          <label className="field">
            O mês começa no dia
            <select className="select" name="periodStartDay" defaultValue="1">
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? '1 (mês corrido)' : `${d} (ex.: dia do salário)`}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="submit" disabled={create.isPending}>
            Criar orçamento
          </button>
        </div>
      </form>

      {budgets.isLoading ? (
        <Loading />
      ) : !budgets.data?.length ? (
        <Empty title="Nenhum orçamento ainda" />
      ) : (
        <div className="grid" style={{ ['--min' as string]: '280px' }}>
          {budgets.data.map((b) => (
            <Link key={b.id} href={`/orcamentos/${b.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="between">
                <h3>{b.name}</h3>
                <span className={`badge${b.role === 'owner' ? '' : ' ok'}`}>{ROLE_LABEL[b.role]}</span>
              </div>
              <span className="small muted">
                {b.currency} · mês começa no dia {b.periodStartDay}
              </span>
              <span className="small" style={{ color: 'var(--accent)' }}>
                {b.role === 'owner' || b.role === 'create' ? 'Abrir · categorias e planejado →' : 'Abrir →'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
