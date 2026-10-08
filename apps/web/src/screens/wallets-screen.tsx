'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { TransfersList } from '@/components/transfers';
import { Empty, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import { del, errorMessage, post } from '@/lib/api';
import { money, parseMoneyInput } from '@/lib/format';
import { useWallets } from '@/lib/queries';
import type { Wallet } from '@/lib/types';

const TYPE_LABEL: Record<Wallet['type'], string> = { checking: 'Conta', cash: 'Dinheiro', credit: 'Cartão de crédito' };

export function WalletsScreen() {
  const queryClient = useQueryClient();
  const wallets = useWallets();
  const [type, setType] = useState<Wallet['type']>('checking');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => post('/wallets', body),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['wallets'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const archive = useMutation({
    mutationFn: (id: string) => del(`/wallets/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wallets'] }),
    onError: (e) => setError(errorMessage(e)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    const body: Record<string, unknown> = {
      type,
      name: text('name'),
      institution: text('institution') || null,
      last4: text('last4') || null,
    };
    if (type === 'credit') {
      const limit = text('limit') ? parseMoneyInput(text('limit')) : 0;
      if (limit === null) return setError('Limite inválido. Ex.: 5.000,00');
      body.card = {
        limitCents: limit,
        closingDay: Number(text('closingDay')),
        dueDay: Number(text('dueDay')),
        payFromWalletId: text('payFrom') || null,
      };
    } else {
      const opening = text('opening');
      const negative = opening.startsWith('-');
      const cents = opening ? parseMoneyInput(opening.replace(/^-/, '')) : 0;
      if (cents === null) return setError('Saldo inicial inválido. Ex.: 1.250,00');
      body.openingCents = negative ? -cents : cents;
    }
    create.mutate(body);
    e.currentTarget.reset();
  }

  const accounts = (wallets.data ?? []).filter((w) => w.type !== 'credit');
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <>
      <PageHeader eyebrow="Onde o dinheiro está" title="Carteiras" />

      {wallets.isLoading ? (
        <Loading />
      ) : !wallets.data?.length ? (
        <Empty title="Cadastre sua primeira carteira">
          <span className="small">Conta corrente, dinheiro ou cartão de crédito (com dias de fechamento e vencimento).</span>
        </Empty>
      ) : (
        <div className="grid">
          {wallets.data.map((w) => (
            <article key={w.id} className="card" style={{ gap: 10 }}>
              <div className="between">
                <h3 style={{ fontSize: 16 }}>{w.name}</h3>
                <span className="badge">{TYPE_LABEL[w.type]}</span>
              </div>
              {w.card ? (
                <span className="small muted">
                  {w.last4 ? `••${w.last4} · ` : ''}Fecha dia {w.card.closingDay} · vence dia {w.card.dueDay}
                  {w.card.limitCents > 0 ? ` · limite ${money(w.card.limitCents)}` : ''}
                </span>
              ) : (
                <span className="mono" style={{ fontSize: 22, color: w.balanceCents < 0 ? 'var(--expense)' : undefined }}>
                  {money(w.balanceCents)}
                </span>
              )}
              <span className="small muted">{w.institution ?? ' '}</span>
              <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => confirm(`Arquivar “${w.name}”?`) && archive.mutate(w.id)}>
                Arquivar
              </button>
            </article>
          ))}
        </div>
      )}

      <form className="card" onSubmit={onSubmit}>
        <h2 style={{ fontSize: 17 }}>Nova carteira</h2>
        <div className="segmented" role="group" aria-label="Tipo">
          {(['checking', 'cash', 'credit'] as const).map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <ErrorAlert error={error} />
        <div className="form-grid">
          <label className="field">
            Nome
            <input className="input" name="name" required maxLength={60} placeholder={type === 'credit' ? 'Cartão Nubank' : 'Conta Itaú'} />
          </label>
          <label className="field">
            Instituição (opcional)
            <input className="input" name="institution" maxLength={60} />
          </label>
          {type !== 'cash' && (
            <label className="field">
              4 últimos dígitos (opcional)
              <input className="input mono" name="last4" inputMode="numeric" pattern="\d{4}" maxLength={4} />
            </label>
          )}
          {type === 'credit' ? (
            <>
              <label className="field">
                Limite (R$)
                <input className="input mono" name="limit" inputMode="decimal" placeholder="0,00" />
              </label>
              <label className="field">
                Dia de fechamento
                <select className="select" name="closingDay" defaultValue="3">
                  {days.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className="field">
                Dia de vencimento
                <select className="select" name="dueDay" defaultValue="10">
                  {days.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className="field">
                Pagar fatura com
                <select className="select" name="payFrom" defaultValue="">
                  <option value="">Escolher na hora</option>
                  {accounts.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
            </>
          ) : (
            <label className="field">
              Saldo atual (R$)
              <input className="input mono" name="opening" inputMode="decimal" placeholder="0,00" />
            </label>
          )}
        </div>
        <button className="btn primary" type="submit" style={{ alignSelf: 'flex-start' }} disabled={create.isPending}>
          Criar carteira
        </button>
      </form>
      {accounts.length >= 2 && <TransfersList wallets={wallets.data ?? []} />}
    </>
  );
}
