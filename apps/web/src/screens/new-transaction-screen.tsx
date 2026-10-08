'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { BudgetPicker } from '@/components/budget-picker';
import { Empty, ErrorAlert, PageHeader } from '@/components/ui';
import { errorMessage, post } from '@/lib/api';
import { isoToBr, money, monthLabel, parseMoneyInput, todayIso } from '@/lib/format';
import { useBudgets, useCategories, useWallets } from '@/lib/queries';
import type { Wallet } from '@/lib/types';

const INSTALLMENTS = [1, 2, 3, 4, 5, 6, 10, 12];

function walletSub(w: Wallet) {
  if (w.type === 'credit' && w.card) return `Cartão${w.last4 ? ` ••${w.last4}` : ''} · fecha dia ${w.card.closingDay}`;
  return `${w.type === 'cash' ? 'Dinheiro' : 'Conta'} · ${money(w.balanceCents)}`;
}

/** Em qual fatura cai a 1ª parcela (mesma regra do servidor: compra no dia do fechamento vai para a próxima). */
function firstInvoiceMonth(purchase: string, closingDay: number): string {
  const [y, m, d] = purchase.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const closing = Math.min(closingDay, lastDay);
  const idx = y * 12 + (m - 1) + (d < closing ? 0 : 1);
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Tela "Lançamento de despesa" do design. */
export function NewTransactionScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const budgets = useBudgets();
  const wallets = useWallets();

  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(todayIso());
  const [budgetId, setBudgetId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [walletId, setWalletId] = useState('');
  const [installments, setInstallments] = useState(1);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Uma chave por formulário: clique duplo ou reenvio não duplicam a compra.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const writable = (budgets.data ?? []).filter((b) => b.role === 'owner' || b.role === 'create');
  useEffect(() => {
    if (!budgetId && writable[0]) setBudgetId(writable[0].id);
  }, [writable, budgetId]);

  const categories = useCategories(budgetId || undefined);
  const kindCategories = (categories.data ?? []).filter((c) => c.kind === kind);

  const usable = (wallets.data ?? []).filter((w) => kind === 'expense' || w.type !== 'credit');
  useEffect(() => {
    if (!usable.some((w) => w.id === walletId)) setWalletId(usable[0]?.id ?? '');
  }, [usable, walletId]);
  const wallet = usable.find((w) => w.id === walletId);
  const isCard = wallet?.type === 'credit';

  const amount = parseMoneyInput(amountText);
  const perInstallment = useMemo(() => {
    if (!amount || !isCard) return null;
    const base = Math.floor(amount / installments);
    const extra = amount - base * installments;
    return extra ? `${installments}x de ${money(base)} (1ª de ${money(base + extra)})` : `${installments}x de ${money(base)}`;
  }, [amount, installments, isCard]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return setError('Informe um valor válido, por exemplo 1.234,56.');
    if (!wallet) return setError('Escolha a carteira.');
    setBusy(true);
    setError(null);
    try {
      if (isCard) {
        await post(`/wallets/${wallet.id}/purchases`, {
          budgetId,
          categoryId: categoryId || null,
          description,
          totalCents: amount,
          installments,
          purchaseDate: date,
          idempotencyKey,
        });
      } else {
        await post(`/budgets/${budgetId}/transactions`, {
          walletId: wallet.id,
          categoryId: categoryId || null,
          description,
          amountCents: amount,
          kind,
          dueDate: date,
          paid,
        });
      }
      await queryClient.invalidateQueries();
      router.push('/lancamentos');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (budgets.data && !writable.length) {
    return (
      <>
        <PageHeader eyebrow="Lançamentos / Novo" title="Novo lançamento" />
        <Empty title="Você precisa de um orçamento onde possa lançar">
          <Link className="btn primary" href="/orcamentos">
            Criar orçamento
          </Link>
        </Empty>
      </>
    );
  }
  if (wallets.data && !wallets.data.length) {
    return (
      <>
        <PageHeader eyebrow="Lançamentos / Novo" title="Novo lançamento" />
        <Empty title="Cadastre sua primeira carteira">
          <span className="small">Conta, dinheiro ou cartão (com dias de fechamento e vencimento).</span>
          <Link className="btn primary" href="/carteiras">
            Criar carteira
          </Link>
        </Empty>
      </>
    );
  }

  const invoiceMonth = isCard && wallet?.card ? firstInvoiceMonth(date, wallet.card.closingDay) : null;

  return (
    <>
      <PageHeader eyebrow={<><Link href="/" className="muted">Visão geral</Link> / Lançamentos / Novo</>} title="Novo lançamento" />
      <form className="card" style={{ gap: 24, maxWidth: 820 }} onSubmit={onSubmit}>
        <div className="segmented" role="group" aria-label="Tipo de lançamento">
          <button type="button" className="expense" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>
            Despesa
          </button>
          <button type="button" className="income" aria-pressed={kind === 'income'} onClick={() => setKind('income')}>
            Receita
          </button>
          <button type="button" disabled title="Em breve">
            Transferência
          </button>
        </div>

        <div className="form-grid" style={{ ['--min' as string]: '220px' }}>
          <label className="field">
            Descrição
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} required />
          </label>
          <label className="field">
            {isCard ? 'Valor total (R$)' : 'Valor (R$)'}
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
        </div>

        <div className="form-grid" style={{ ['--min' as string]: '180px' }}>
          <label className="field">
            {isCard ? 'Data da compra' : 'Vencimento'}
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <BudgetPicker budgets={budgets.data ?? []} value={budgetId} onChange={setBudgetId} onlyWritable />
          <label className="field">
            Categoria
            <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sem categoria</option>
              {kindCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset style={{ margin: 0, padding: 0, border: 0 }} className="stack-sm">
          <legend className="small text-2" style={{ padding: 0, marginBottom: 10 }}>
            {kind === 'expense' ? 'Conta de origem' : 'Conta de destino'}
          </legend>
          <div className="choice-grid">
            {usable.map((w) => (
              <button type="button" key={w.id} className="choice" aria-pressed={w.id === walletId} onClick={() => setWalletId(w.id)}>
                <span style={{ fontWeight: 600 }}>{w.name}</span>
                <span className="xsmall muted">{walletSub(w)}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {isCard ? (
          <div className="stack-sm" style={{ padding: 16, border: '1px solid #222a35', borderRadius: 10 }}>
            <div className="between">
              <span className="small text-2">Parcelamento</span>
              <span className="mono small">{perInstallment}</span>
            </div>
            <div className="row" role="group" aria-label="Número de parcelas" style={{ gap: 8 }}>
              {INSTALLMENTS.map((n) => (
                <button type="button" key={n} className="pill" aria-pressed={installments === n} onClick={() => setInstallments(n)}>
                  {n}x
                </button>
              ))}
            </div>
            {invoiceMonth && wallet?.card && (
              <p className="small muted" style={{ margin: 0 }}>
                Compra em {isoToBr(date).slice(0, 5)}, fechamento no dia {wallet.card.closingDay}: a 1ª parcela entra na
                fatura de {monthLabel(invoiceMonth).toLowerCase()}.
                {installments > 1 && ' As demais viram provisões nas faturas seguintes e aparecem como “Provisionado”.'}
              </p>
            )}
          </div>
        ) : (
          <div className="stack-sm">
            <span className="small text-2">Status</span>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="pill" aria-pressed={!paid} onClick={() => setPaid(false)}>
                Em aberto
              </button>
              <button type="button" className="pill" aria-pressed={paid} onClick={() => setPaid(true)}>
                {kind === 'expense' ? 'Pago' : 'Recebido'}
              </button>
            </div>
          </div>
        )}

        <ErrorAlert error={error} />
        <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <Link className="btn" href="/lancamentos">
            Cancelar
          </Link>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar lançamento'}
          </button>
        </div>
      </form>
    </>
  );
}
