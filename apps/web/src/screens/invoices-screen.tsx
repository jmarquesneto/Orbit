'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Empty, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import { api, del, errorMessage, post } from '@/lib/api';
import { isoToBr, money, monthLabel } from '@/lib/format';
import { useInvoices, useWallets } from '@/lib/queries';
import type { Invoice, InvoiceDetail } from '@/lib/types';

function invoiceBadge(i: Invoice) {
  if (i.status === 'paid') return <span className="badge ok">Paga</span>;
  if (i.closingDate <= new Date().toISOString().slice(0, 10)) return <span className="badge warn">Fechada</span>;
  return <span className="badge info">Aberta</span>;
}

export function InvoicesScreen() {
  const queryClient = useQueryClient();
  const wallets = useWallets();
  const cards = (wallets.data ?? []).filter((w) => w.type === 'credit');
  const accounts = (wallets.data ?? []).filter((w) => w.type !== 'credit');
  const [cardId, setCardId] = useState('');
  const [month, setMonth] = useState('');
  const [payFrom, setPayFrom] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cardId && cards[0]) setCardId(cards[0].id);
  }, [cards, cardId]);
  const card = cards.find((c) => c.id === cardId);

  const invoices = useInvoices(cardId || undefined);
  useEffect(() => {
    const list = invoices.data ?? [];
    if (list.length && !list.some((i) => i.refMonth.slice(0, 7) === month)) {
      setMonth((list.find((i) => i.status !== 'paid') ?? list[0]!).refMonth.slice(0, 7));
    }
  }, [invoices.data, month]);
  const defaultPayFrom = card?.card?.payFrom ?? accounts[0]?.id ?? '';
  useEffect(() => setPayFrom(defaultPayFrom), [defaultPayFrom]);

  const detail = useQuery({
    queryKey: ['invoice', cardId, month],
    queryFn: () => api<{ invoice: InvoiceDetail }>(`/wallets/${cardId}/invoices/${month}`).then((r) => r.invoice),
    enabled: Boolean(cardId && month),
  });

  const refresh = () => void queryClient.invalidateQueries();
  const pay = useMutation({
    mutationFn: () => post(`/wallets/${cardId}/invoices/${month}/payment`, { fromWalletId: payFrom || null }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (planId: string) => del(`/wallets/${cardId}/purchases/${planId}`),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });

  if (wallets.isLoading) return <Loading />;
  if (!cards.length) {
    return (
      <>
        <PageHeader eyebrow="Cartões de crédito" title="Faturas" />
        <Empty title="Nenhum cartão cadastrado">
          <Link className="btn primary" href="/carteiras">
            Cadastrar cartão
          </Link>
        </Empty>
      </>
    );
  }

  const d = detail.data;
  return (
    <>
      <PageHeader eyebrow="Cartões de crédito" title="Faturas">
        <select className="select" style={{ width: 'auto' }} value={cardId} onChange={(e) => { setCardId(e.target.value); setMonth(''); }} aria-label="Cartão">
          {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </PageHeader>
      <ErrorAlert error={error} />

      {!invoices.data?.length ? (
        <Empty title="Nenhuma fatura ainda">
          <span className="small">As faturas aparecem quando você lança uma compra neste cartão.</span>
        </Empty>
      ) : (
        <div className="row" role="tablist" aria-label="Faturas" style={{ gap: 8 }}>
          {invoices.data.map((i) => (
            <button
              key={i.id}
              type="button"
              role="tab"
              aria-selected={i.refMonth.slice(0, 7) === month}
              className="pill"
              aria-pressed={i.refMonth.slice(0, 7) === month}
              onClick={() => setMonth(i.refMonth.slice(0, 7))}
            >
              {monthLabel(i.refMonth).replace(/ \d{4}$/, (y) => ` ${y.trim().slice(2)}`)} · {money(i.totalCents - i.paidCents)}
            </button>
          ))}
        </div>
      )}

      {d && (
        <section className="card">
          <div className="between">
            <div className="stack-sm" style={{ gap: 2 }}>
              <h2>Fatura de {monthLabel(d.refMonth).toLowerCase()}</h2>
              <span className="small muted">
                Fecha {isoToBr(d.closingDate)} · vence {isoToBr(d.dueDate)}
              </span>
            </div>
            {invoiceBadge(d)}
          </div>
          <span className="stat-value">{money(d.totalCents)}</span>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Compra</th>
                  <th scope="col" className="num">Valor</th>
                  <th scope="col"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {d.transactions.map((t) => (
                  <tr key={t.id}>
                    <td>{t.description}</td>
                    <td className="num expense">{money(t.amountCents)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {d.status !== 'paid' && t.planId && (
                        <button type="button" className="btn small" onClick={() => confirm('Cancelar a compra inteira (todas as parcelas)?') && cancel.mutate(t.planId!)}>
                          Cancelar compra
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.status !== 'paid' && d.totalCents > 0 && (
            <div className="row" style={{ alignItems: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <label className="field" style={{ flex: '1 1 220px' }}>
                Pagar com
                <select className="select" value={payFrom} onChange={(e) => setPayFrom(e.target.value)}>
                  {accounts.map((w) => <option key={w.id} value={w.id}>{w.name} · {money(w.balanceCents)}</option>)}
                </select>
              </label>
              <button type="button" className="btn primary" disabled={!payFrom || pay.isPending} onClick={() => pay.mutate()}>
                Pagar {money(d.totalCents - d.paidCents)}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
