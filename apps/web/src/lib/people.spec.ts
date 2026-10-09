import { describe, expect, it } from 'vitest';
import { currentInvoice } from '@/screens/invoices-screen';
import type { Invoice } from './types';
import { firstName } from './types';

describe('saudação', () => {
  it('usa o primeiro nome e, sem nome, a parte do e-mail', () => {
    expect(firstName({ name: 'Marina  Alves', email: 'm@x.com' })).toBe('Marina');
    expect(firstName({ name: null, email: 'marina.alves@x.com' })).toBe('marina.alves');
  });
});

describe('faturas: "Todos os cartões"', () => {
  const inv = (refMonth: string, dueDate: string, status: Invoice['status']): Invoice => ({
    id: refMonth,
    cardId: 'c',
    refMonth,
    closingDate: dueDate,
    dueDate,
    totalCents: 100,
    paidCents: 0,
    status,
  });

  it('mostra a primeira fatura não paga; se todas pagas, a mais recente', () => {
    expect(currentInvoice([inv('2026-11-01', '2026-11-10', 'open'), inv('2026-10-01', '2026-10-10', 'closed')])?.id).toBe('2026-10-01');
    expect(currentInvoice([inv('2026-09-01', '2026-09-10', 'paid'), inv('2026-10-01', '2026-10-10', 'paid')])?.id).toBe('2026-10-01');
    expect(currentInvoice([])).toBeNull();
  });
});
