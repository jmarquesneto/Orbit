'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { SharePanel } from '@/components/share-panel';
import { Empty, ErrorAlert, Loading, PageHeader, Progress } from '@/components/ui';
import { errorMessage, post } from '@/lib/api';
import { money, monthLabel, parseMoneyInput, todayIso } from '@/lib/format';
import { useGoals, useWallets } from '@/lib/queries';
import type { Goal } from '@/lib/types';
import { ROLE_LABEL } from '@/lib/types';

function GoalCard({ goal }: { goal: Goal }) {
  const queryClient = useQueryClient();
  const wallets = useWallets();
  const accounts = (wallets.data ?? []).filter((w) => w.type !== 'credit');
  const [error, setError] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const canMove = goal.role === 'owner' || goal.role === 'create';

  const move = useMutation({
    mutationFn: (body: Record<string, unknown>) => post(`/goals/${goal.id}/movements`, body),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      void queryClient.invalidateQueries({ queryKey: ['wallets'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const f = new FormData(e.currentTarget);
    const amount = parseMoneyInput(String(f.get('amount') ?? ''));
    if (!amount) return setError('Informe um valor válido.');
    move.mutate({
      walletId: String(f.get('walletId')),
      kind: submitter?.value === 'withdraw' ? 'withdraw' : 'deposit',
      amountCents: amount,
      occurredOn: todayIso(),
    });
    e.currentTarget.reset();
  }

  return (
    <article className="card" style={{ gap: 12 }}>
      <div className="between">
        <h3 style={{ fontSize: 16 }}>{goal.name}</h3>
        <span className={`badge${goal.role === 'owner' ? '' : ' ok'}`}>
          {goal.role === 'owner' ? `${goal.progressPercent}%` : `Compartilhada · ${ROLE_LABEL[goal.role]}`}
        </span>
      </div>
      <span className="mono" style={{ fontSize: 20 }}>
        {money(goal.balanceCents)} <span className="small muted">de {money(goal.targetCents)}</span>
      </span>
      <Progress value={goal.balanceCents} max={goal.targetCents} variant="goal" />
      {goal.targetDate && <span className="small muted">Meta: {monthLabel(goal.targetDate).toLowerCase()}</span>}
      <ErrorAlert error={error} />
      {canMove && accounts.length > 0 && (
        <form className="row" style={{ alignItems: 'flex-end', gap: 8 }} onSubmit={onSubmit}>
          <label className="field" style={{ flex: '1 1 120px' }}>
            Valor (R$)
            <input className="input mono" name="amount" inputMode="decimal" placeholder="0,00" required />
          </label>
          <label className="field" style={{ flex: '1 1 140px' }}>
            Carteira
            <select className="select" name="walletId">
              {accounts.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <button className="btn primary small" type="submit" value="deposit" disabled={move.isPending}>
            Guardar
          </button>
          <button className="btn small" type="submit" value="withdraw" disabled={move.isPending}>
            Resgatar
          </button>
        </form>
      )}
      <button type="button" className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => setShowShare((v) => !v)} aria-expanded={showShare}>
        {showShare ? 'Ocultar compartilhamento' : 'Compartilhamento'}
      </button>
      {showShare && <SharePanel type="goal" id={goal.id} isOwner={goal.role === 'owner'} />}
    </article>
  );
}

export function GoalsScreen() {
  const queryClient = useQueryClient();
  const goals = useGoals();
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => post('/goals', body),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const target = parseMoneyInput(String(f.get('target') ?? ''));
    if (!target) return setError('Informe o valor da meta. Ex.: 20.000,00');
    const date = String(f.get('targetDate') ?? '');
    create.mutate({ name: String(f.get('name')), targetCents: target, targetDate: date || null });
    e.currentTarget.reset();
  }

  return (
    <>
      <PageHeader eyebrow="Reservas e objetivos" title="Caixinhas" />
      {goals.isLoading ? (
        <Loading />
      ) : !goals.data?.length ? (
        <Empty title="Nenhuma caixinha ainda">
          <span className="small">Separe dinheiro para uma viagem, a reserva de emergência ou um objetivo.</span>
        </Empty>
      ) : (
        <div className="grid" style={{ ['--min' as string]: '300px' }}>
          {goals.data.map((g) => <GoalCard key={g.id} goal={g} />)}
        </div>
      )}
      <form className="card" onSubmit={onSubmit}>
        <h2 style={{ fontSize: 17 }}>Nova caixinha</h2>
        <ErrorAlert error={error} />
        <div className="form-grid" style={{ alignItems: 'end' }}>
          <label className="field">
            Nome
            <input className="input" name="name" required maxLength={60} placeholder="Viagem" />
          </label>
          <label className="field">
            Meta (R$)
            <input className="input mono" name="target" inputMode="decimal" placeholder="0,00" required />
          </label>
          <label className="field">
            Até quando (opcional)
            <input className="input" name="targetDate" type="date" />
          </label>
          <button className="btn primary" type="submit" disabled={create.isPending}>
            Criar caixinha
          </button>
        </div>
      </form>
    </>
  );
}
