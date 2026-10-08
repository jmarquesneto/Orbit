import { splitInstallments } from '../../../shared/domain/money.js';
import { installmentDescription, invoiceDates, invoiceMonthFor, planInstallments } from './invoice-calendar.js';

describe('splitInstallments', () => {
  it('soma exatamente o total, sobra nos primeiros centavos', () => {
    expect(splitInstallments(10_000, 3)).toEqual([3_334, 3_333, 3_333]);
    expect(splitInstallments(10_000, 4)).toEqual([2_500, 2_500, 2_500, 2_500]);
  });

  it.each([
    [1, 1],
    [99_999, 7],
    [123_456_789, 48],
  ])('total %i em %i parcelas fecha a conta', (total, n) => {
    const parts = splitInstallments(total, n);
    expect(parts).toHaveLength(n);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });

  it('rejeita entradas impossíveis', () => {
    expect(() => splitInstallments(0, 1)).toThrow();
    expect(() => splitInstallments(100, 0)).toThrow();
    expect(() => splitInstallments(2, 3)).toThrow();
    expect(() => splitInstallments(10.5, 2)).toThrow();
  });
});

describe('invoiceDates', () => {
  it('vencimento depois do fechamento → mesmo mês', () => {
    expect(invoiceDates({ year: 2026, month: 10 }, { closingDay: 3, dueDay: 10 })).toEqual({
      refMonth: '2026-10-01',
      closingDate: '2026-10-03',
      dueDate: '2026-10-10',
    });
  });

  it('vencimento antes do fechamento → mês seguinte (inclusive virada de ano)', () => {
    expect(invoiceDates({ year: 2026, month: 12 }, { closingDay: 25, dueDay: 5 })).toEqual({
      refMonth: '2026-12-01',
      closingDate: '2026-12-25',
      dueDate: '2027-01-05',
    });
  });

  it('dia 31 em mês curto usa o último dia (inclusive ano bissexto)', () => {
    expect(invoiceDates({ year: 2027, month: 2 }, { closingDay: 31, dueDay: 10 }).closingDate).toBe('2027-02-28');
    expect(invoiceDates({ year: 2028, month: 2 }, { closingDay: 31, dueDay: 10 }).closingDate).toBe('2028-02-29');
    expect(invoiceDates({ year: 2026, month: 1 }, { closingDay: 31, dueDay: 30 }).dueDate).toBe('2026-02-28');
  });
});

describe('invoiceMonthFor', () => {
  const cycle = { closingDay: 10, dueDay: 17 };
  it('compra antes do fechamento entra na fatura do mês', () => {
    expect(invoiceMonthFor('2026-10-09', cycle)).toEqual({ year: 2026, month: 10 });
  });
  it('compra NO dia do fechamento vai para a fatura seguinte', () => {
    expect(invoiceMonthFor('2026-10-10', cycle)).toEqual({ year: 2026, month: 11 });
  });
  it('compra depois do fechamento em dezembro vai para janeiro', () => {
    expect(invoiceMonthFor('2026-12-20', cycle)).toEqual({ year: 2027, month: 1 });
  });
  it('fechamento 31 em fevereiro considera o último dia do mês', () => {
    expect(invoiceMonthFor('2026-02-28', { closingDay: 31, dueDay: 8 })).toEqual({ year: 2026, month: 3 });
    expect(invoiceMonthFor('2026-02-27', { closingDay: 31, dueDay: 8 })).toEqual({ year: 2026, month: 2 });
  });
});

describe('planInstallments', () => {
  it('compra de R$ 1.000,00 em 10x a partir de 20/11 (fecha 15, vence 22)', () => {
    const plan = planInstallments('2026-11-20', 100_000, 10, { closingDay: 15, dueDay: 22 });
    expect(plan).toHaveLength(10);
    expect(plan[0]).toEqual({
      number: 1,
      amountCents: 10_000,
      invoice: { refMonth: '2026-12-01', closingDate: '2026-12-15', dueDate: '2026-12-22' },
    });
    expect(plan.map((p) => p.invoice.refMonth)).toEqual([
      '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01',
      '2027-05-01', '2027-06-01', '2027-07-01', '2027-08-01', '2027-09-01',
    ]);
    expect(new Set(plan.map((p) => p.invoice.refMonth)).size).toBe(10);
  });

  it('descrição numera as parcelas só quando há mais de uma', () => {
    expect(installmentDescription('Geladeira', 2, 10)).toBe('Geladeira (2/10)');
    expect(installmentDescription('Mercado', 1, 1)).toBe('Mercado');
  });
});
