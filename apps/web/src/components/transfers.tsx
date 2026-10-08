'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api, del, errorMessage, post } from '@/lib/api';
import { isoToBr, money, parseMoneyInput, todayIso } from '@/lib/format';
import type { Transfer, Wallet } from '@/lib/types';
import { Icon } from './icons';
import { Empty, ErrorAlert } from './ui';

const spendable = (wallets: Wallet[]) => wallets.filter((w) => w.type !== 'credit');

/** Aba "Transferência" do lançamento: tira de uma conta e põe em outra. Não conta no orçamento. */
export function TransferForm({ wallets }: { wallets: Wallet[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const accounts = spendable(wallets);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!fromId && accounts[0]) setFromId(accounts[0].id);
    if (!toId && accounts[1]) setToId(accounts[1].id);
  }, [accounts, fromId, toId]);

  const from = accounts.find((w) => w.id === fromId);
  const amount = parseMoneyInput(amountText);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return setError('Informe um valor válido, por exemplo 1.234,56.');
    if (fromId === toId) return setError('Escolha contas diferentes para a origem e o destino.');
    setBusy(true);
    setError(null);
    try {
      await post('/transfers', {
        fromWalletId: fromId,
        toWalletId: toId,
        amountCents: amount,
        occurredOn: date,
        description: description.trim() || null,
      });
      await queryClient.invalidateQueries();
      router.push('/carteiras');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (accounts.length < 2) {
    return (
      <Empty title="Você precisa de pelo menos duas contas">
        <span className="small">Transferências movem dinheiro entre contas ou dinheiro em espécie (cartão não entra).</span>
        <Link className="btn primary" href="/carteiras">
          Criar carteira
        </Link>
      </Empty>
    );
  }

  const option = (w: Wallet) => (
    <option key={w.id} value={w.id}>
      {w.name} · {money(w.balanceCents)}
    </option>
  );

  return (
    <form className="stack-sm" style={{ gap: 24 }} onSubmit={onSubmit} aria-label="Transferência entre contas">
      <div className="form-grid" style={{ ['--min' as string]: '220px', alignItems: 'end' }}>
        <label className="field">
          Sai de
          <select className="select" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {accounts.map(option)}
          </select>
        </label>
        <label className="field">
          Entra em
          <select className="select" value={toId} onChange={(e) => setToId(e.target.value)}>
            {accounts.map(option)}
          </select>
        </label>
      </div>
      <div className="form-grid" style={{ ['--min' as string]: '180px' }}>
        <label className="field">
          Valor (R$)
          <input
            className="input mono"
            inputMode="decimal"
            placeholder="0,00"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-invalid={amountText !== '' && !amount}
            required
          />
        </label>
        <label className="field">
          Data
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          Descrição (opcional)
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} />
        </label>
      </div>
      {from && amount ? (
        <p className="small muted" style={{ margin: 0 }}>
          {from.name} fica com {money(from.balanceCents - amount)}. Transferências não contam como receita nem despesa
          no orçamento.
        </p>
      ) : null}
      <ErrorAlert error={error} />
      <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <Link className="btn" href="/lancamentos">
          Cancelar
        </Link>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Transferindo…' : 'Transferir'}
        </button>
      </div>
    </form>
  );
}

/** Últimas transferências, com "Desfazer" (devolve o valor para a conta de origem). */
export function TransfersList({ wallets }: { wallets: Wallet[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['transfers'],
    queryFn: () => api<{ transfers: Transfer[] }>('/transfers?limit=20').then((r) => r.transfers),
  });
  const undo = useMutation({
    mutationFn: (id: string) => del(`/transfers/${id}`),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
      void queryClient.invalidateQueries({ queryKey: ['wallets'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const nameOf = (id: string) => wallets.find((w) => w.id === id)?.name ?? 'Carteira arquivada';

  return (
    <section className="card" aria-labelledby="h-transfers">
      <div className="between">
        <h2 id="h-transfers" style={{ fontSize: 18 }}>Transferências</h2>
        <Link className="btn small" href="/lancamentos/novo?tipo=transferencia">
          <Icon name="swap" size={16} />
          Nova transferência
        </Link>
      </div>
      <ErrorAlert error={error} />
      {!list.data?.length ? (
        <p className="small muted" style={{ margin: 0 }}>Nenhuma transferência ainda.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">De → Para</th>
                <th scope="col">Descrição</th>
                <th scope="col" style={{ textAlign: 'right' }}>Valor</th>
                <th scope="col"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{isoToBr(t.occurredOn)}</td>
                  <td>
                    {nameOf(t.fromWalletId)} → {nameOf(t.toWalletId)}
                  </td>
                  <td className="muted">{t.description ?? '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(t.amountCents)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn small"
                      disabled={undo.isPending}
                      onClick={() => {
                        if (window.confirm('Desfazer esta transferência? O valor volta para a conta de origem.')) undo.mutate(t.id);
                      }}
                    >
                      Desfazer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
