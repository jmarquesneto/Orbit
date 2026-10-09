'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useMe } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import { Empty, Loading, PageHeader, Progress, SuccessAlert } from '@/components/ui';
import {
  currentMonth,
  greeting,
  longDate,
  money,
  monthLabel,
  monthName,
  moneyShort,
  percent,
  shiftMonth,
} from '@/lib/format';
import { useAllInvoices, useBudgets, useGoals, useSummaries, useWallets } from '@/lib/queries';
import { firstName, ROLE_LABEL } from '@/lib/types';

/** Tela "Dashboard geral" do design. */
export function OverviewScreen() {
  const me = useMe();
  const welcome = useSearchParams().get('bem-vindo');
  const [month, setMonth] = useState(currentMonth());
  const budgets = useBudgets();
  const wallets = useWallets();
  const goals = useGoals();
  const summaries = useSummaries((budgets.data ?? []).map((b) => b.id), month);
  const cards = (wallets.data ?? []).filter((w) => w.type === 'credit');
  const invoices = useAllInvoices(cards.map((c) => c.id));

  const accounts = (wallets.data ?? []).filter((w) => w.type !== 'credit');
  const balance = accounts.reduce((s, w) => s + w.balanceCents, 0);
  const income = summaries.reduce((s, q) => s + (q.data?.totals.incomeCents ?? 0), 0);
  const expense = summaries.reduce((s, q) => s + (q.data?.totals.expenseCents ?? 0), 0);
  const futureInvoices = invoices
    .flatMap((q) => q.data ?? [])
    .filter((i) => i.status !== 'paid' && i.refMonth.slice(0, 7) > month);
  const provisioned = futureInvoices.reduce((s, i) => s + i.totalCents - i.paidCents, 0);
  const lastFuture = futureInvoices.map((i) => i.refMonth).sort().at(-1);

  const months = [-2, -1, 0, 1, 2].map((n) => shiftMonth(currentMonth(), n));

  return (
    <>
      <PageHeader eyebrow={longDate()} title={`${greeting()}, ${firstName(me)}`}>
        <label className="btn" style={{ gap: 8 }}>
          Mês
          <select
            className="select"
            style={{ minHeight: 0, border: 0, padding: 0, width: 'auto', background: 'transparent' }}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <Link className="btn" href="/ofx">
          Importar OFX
        </Link>
        <Link className="btn primary" href="/lancamentos/novo">
          <Icon name="plus" />
          Novo lançamento
        </Link>
      </PageHeader>

      {welcome && <SuccessAlert message="Conta ativada! Comece criando um orçamento e uma carteira." />}

      <section aria-label="Resumo do mês" className="grid" style={{ ['--min' as string]: '220px' }}>
        <div className="card" style={{ gap: 6 }}>
          <span className="small muted">Saldo em contas</span>
          <span className="stat-value">{money(balance)}</span>
          <span className="small muted">
            {accounts.length} {accounts.length === 1 ? 'conta' : 'contas'} · dinheiro incluso
          </span>
        </div>
        <div className="card" style={{ gap: 6 }}>
          <span className="small muted">Receitas de {monthName(month)}</span>
          <span className="stat-value income">{money(income)}</span>
          <span className="small muted">Somando todos os orçamentos</span>
        </div>
        <div className="card" style={{ gap: 6 }}>
          <span className="small muted">Despesas de {monthName(month)}</span>
          <span className="stat-value expense">{money(expense)}</span>
          <span className="small muted">Inclui parcelas de cartão do mês</span>
        </div>
        <div className="card" style={{ gap: 6 }}>
          <span className="small muted">Faturas futuras provisionadas</span>
          <span className="stat-value">{money(provisioned)}</span>
          <span className="small muted">
            {futureInvoices.length
              ? `${futureInvoices.length} faturas até ${monthLabel(lastFuture!).toLowerCase()}`
              : 'Nenhuma parcela futura'}
          </span>
        </div>
      </section>

      <section className="stack" aria-labelledby="h-orc">
        <div className="between">
          <h2 id="h-orc">Orçamentos</h2>
          <Link href="/orcamentos" className="small">
            + Novo orçamento
          </Link>
        </div>
        {budgets.isLoading ? (
          <Loading />
        ) : !budgets.data?.length ? (
          <Empty title="Crie seu primeiro orçamento">
            <span className="small">Sugestão: “Pessoal”, em BRL. Depois, adicione categorias com o valor planejado.</span>
            <Link className="btn primary" href="/orcamentos">
              Criar orçamento
            </Link>
          </Empty>
        ) : (
          <div className="grid" style={{ ['--min' as string]: '320px' }}>
            {budgets.data.map((b, i) => {
              const s = summaries[i]?.data;
              const planned = s?.totals.plannedExpenseCents ?? 0;
              const spent = s?.totals.expenseCents ?? 0;
              const top = (s?.categories ?? [])
                .filter((c) => c.kind === 'expense')
                .sort((a, c) => c.actualCents - a.actualCents)
                .slice(0, 3);
              return (
                <article key={b.id} className="card">
                  <div className="between" style={{ alignItems: 'flex-start' }}>
                    <div className="stack-sm" style={{ gap: 2 }}>
                      <h3>
                        <Link href={`/orcamentos/${b.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                          {b.name}
                        </Link>
                      </h3>
                      <span className="small muted">{b.role === 'owner' ? 'Seu orçamento' : 'Compartilhado com você'}</span>
                    </div>
                    <span className={`badge${b.role === 'owner' ? '' : ' ok'}`}>{ROLE_LABEL[b.role]}</span>
                  </div>
                  <div className="stack-sm">
                    <div className="between small">
                      <span className="muted">Gasto do planejado</span>
                      <span className="mono">
                        {moneyShort(spent)} / {moneyShort(planned)}
                      </span>
                    </div>
                    <Progress value={spent} max={planned} />
                  </div>
                  <div className="stack-sm small">
                    {top.length ? (
                      top.map((c) => {
                        const pct = percent(c.actualCents, c.plannedCents);
                        return (
                          <div key={c.id} className="between">
                            <span>{c.name}</span>
                            <span className="mono" style={{ color: pct > 100 ? 'var(--expense)' : 'var(--text-2)' }}>
                              {moneyShort(c.actualCents)}
                              {c.plannedCents > 0 ? ` · ${pct}%` : ''}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <span className="muted">Nenhuma despesa neste mês.</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="h-cx">
        <div className="between">
          <div className="stack-sm" style={{ gap: 2 }}>
            <h2 id="h-cx">Caixinhas</h2>
            <span className="small muted">Reservas separadas dos orçamentos — não entram no gasto do mês</span>
          </div>
          <Link href="/caixinhas" className="small">
            + Nova caixinha
          </Link>
        </div>
        {goals.isLoading ? (
          <Loading />
        ) : !goals.data?.length ? (
          <Empty title="Nenhuma caixinha ainda">
            <span className="small">Guarde dinheiro para objetivos como viagem ou reserva de emergência.</span>
          </Empty>
        ) : (
          <div className="grid">
            {goals.data.map((g) => (
              <article key={g.id} className="card" style={{ gap: 12 }}>
                <div className="between">
                  <h3 style={{ fontSize: 16 }}>{g.name}</h3>
                  {g.role === 'owner' ? (
                    <span className="small muted">{g.progressPercent}%</span>
                  ) : (
                    <span className="badge">Compartilhada · {ROLE_LABEL[g.role]}</span>
                  )}
                </div>
                <span className="mono" style={{ fontSize: 20 }}>
                  {moneyShort(g.balanceCents)} <span className="small muted">de {moneyShort(g.targetCents)}</span>
                </span>
                <Progress value={g.balanceCents} max={g.targetCents} variant="goal" />
                {g.targetDate && <span className="small muted">Meta: {monthLabel(g.targetDate).toLowerCase()}</span>}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
