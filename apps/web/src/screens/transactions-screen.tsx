'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BudgetPicker } from '@/components/budget-picker';
import { Icon } from '@/components/icons';
import { Empty, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import { del, errorMessage, post } from '@/lib/api';
import { currentMonth, isoToBr, monthLabel, shiftMonth, signedMoney, todayIso } from '@/lib/format';
import { useBudgets, useCategories, useTransactions, useWallets } from '@/lib/queries';
import type { Transaction } from '@/lib/types';

function StatusBadge({ t }: { t: Transaction }) {
  if (t.status === 'paid') return <span className="badge ok">{t.ofxFitid ? 'Pago · conciliado' : 'Pago'}</span>;
  if (t.status === 'provisioned') return <span className="badge info">Provisionado</span>;
  // "Vencido" é calculado na hora, nunca gravado.
  if (t.dueDate < todayIso()) return <span className="badge warn">Vencido</span>;
  return <span className="badge">Em aberto</span>;
}

export function TransactionsScreen() {
  const queryClient = useQueryClient();
  const budgets = useBudgets();
  const wallets = useWallets();
  const [budgetId, setBudgetId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!budgetId && budgets.data?.[0]) setBudgetId(budgets.data[0].id);
  }, [budgets.data, budgetId]);

  const budget = budgets.data?.find((b) => b.id === budgetId);
  const txs = useTransactions(budgetId || undefined, month);
  const categories = useCategories(budgetId || undefined);
  const catName = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
  const walletName = new Map((wallets.data ?? []).map((w) => [w.id, w.name]));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['wallets'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
  };
  const pay = useMutation({
    mutationFn: (t: Transaction) =>
      post(`/budgets/${t.budgetId}/transactions/${t.id}/payment`, { paid: t.status !== 'paid', version: t.version }),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (t: Transaction) => del(`/budgets/${t.budgetId}/transactions/${t.id}`),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });

  const months = Array.from({ length: 9 }, (_, i) => shiftMonth(currentMonth(), i - 4));
  const canEdit = budget?.role === 'owner' || budget?.role === 'edit' || budget?.role === 'create';

  return (
    <>
      <PageHeader eyebrow="Movimentações" title="Lançamentos">
        <Link className="btn primary" href="/lancamentos/novo">
          <Icon name="plus" />
          Novo lançamento
        </Link>
      </PageHeader>

      {budgets.data && !budgets.data.length ? (
        <Empty title="Primeiro crie um orçamento">
          <Link className="btn primary" href="/orcamentos">
            Criar orçamento
          </Link>
        </Empty>
      ) : (
        <section className="card">
          <div className="form-grid">
            {budgets.data && <BudgetPicker budgets={budgets.data} value={budgetId} onChange={setBudgetId} />}
            <label className="field">
              Mês
              <select className="select" value={month} onChange={(e) => setMonth(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ErrorAlert error={error} />
          {txs.isLoading ? (
            <Loading />
          ) : !txs.data?.length ? (
            <p className="muted">Nenhum lançamento neste mês.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Vencimento</th>
                    <th scope="col">Descrição</th>
                    <th scope="col">Categoria</th>
                    <th scope="col">Carteira</th>
                    <th scope="col" className="num">
                      Valor
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {txs.data.map((t) => (
                    <tr key={t.id}>
                      <td className="mono">{isoToBr(t.dueDate)}</td>
                      <td>{t.description}</td>
                      <td className="text-2">{t.categoryId ? catName.get(t.categoryId) : '—'}</td>
                      <td className="text-2">{walletName.get(t.walletId) ?? '—'}</td>
                      <td className={`num ${t.kind === 'income' ? 'income' : 'expense'}`}>
                        {signedMoney(t.kind === 'income' ? t.amountCents : -t.amountCents)}
                      </td>
                      <td>
                        <StatusBadge t={t} />
                      </td>
                      <td>
                        {canEdit && !t.invoiceId && walletName.has(t.walletId) && (
                          <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                            <button type="button" className="btn small" onClick={() => pay.mutate(t)} disabled={pay.isPending}>
                              {t.status === 'paid' ? 'Desfazer pagamento' : 'Marcar pago'}
                            </button>
                            {budget?.role === 'owner' && t.status !== 'paid' && (
                              <button
                                type="button"
                                className="btn small danger"
                                onClick={() => confirm(`Excluir “${t.description}”?`) && remove.mutate(t)}
                              >
                                Excluir
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
