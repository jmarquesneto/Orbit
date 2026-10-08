import {
  addMonths,
  clampedDate,
  firstOfMonth,
  type IsoDate,
  parseIsoDate,
  type YearMonth,
} from '../../../shared/domain/calendar.js';
import { splitInstallments } from '../../../shared/domain/money.js';

export interface CardCycle {
  closingDay: number; // 1–31
  dueDay: number; // 1–31
}

export interface InvoiceDates {
  refMonth: IsoDate; // sempre dia 1
  closingDate: IsoDate;
  dueDate: IsoDate;
}

/**
 * Datas da fatura de competência `ym`: fecha no dia de fechamento desse mês e vence no dia de
 * vencimento seguinte ao fechamento — no mesmo mês se o vencimento vem depois do fechamento
 * (fecha 3, vence 10), ou no mês seguinte se vem antes (fecha 25, vence 5).
 * Meses curtos usam o último dia (fechamento 31 em fevereiro → 28/29).
 */
export function invoiceDates(ym: YearMonth, cycle: CardCycle): InvoiceDates {
  const dueMonth = cycle.dueDay > cycle.closingDay ? ym : addMonths(ym, 1);
  return {
    refMonth: firstOfMonth(ym),
    closingDate: clampedDate(ym, cycle.closingDay),
    dueDate: clampedDate(dueMonth, cycle.dueDay),
  };
}

/**
 * Competência da fatura que recebe uma compra: a primeira cujo fechamento é DEPOIS da compra.
 * Compras feitas no próprio dia do fechamento já caem na fatura seguinte ("melhor dia de compra").
 */
export function invoiceMonthFor(purchaseDate: IsoDate, cycle: CardCycle): YearMonth {
  const { year, month, day } = parseIsoDate(purchaseDate);
  const ym = { year, month };
  const closingThisMonth = parseIsoDate(clampedDate(ym, cycle.closingDay)).day;
  return day < closingThisMonth ? ym : addMonths(ym, 1);
}

export interface PlannedInstallment {
  number: number; // 1..N
  amountCents: number;
  invoice: InvoiceDates;
}

/**
 * O coração do parcelamento: uma compra de X parcelas vira X lançamentos, cada um preso
 * à fatura de um mês consecutivo a partir da fatura da data da compra.
 */
export function planInstallments(
  purchaseDate: IsoDate,
  totalCents: number,
  count: number,
  cycle: CardCycle,
): PlannedInstallment[] {
  const first = invoiceMonthFor(purchaseDate, cycle);
  return splitInstallments(totalCents, count).map((amountCents, i) => ({
    number: i + 1,
    amountCents,
    invoice: invoiceDates(addMonths(first, i), cycle),
  }));
}

export function installmentDescription(description: string, number: number, count: number): string {
  return count > 1 ? `${description} (${number}/${count})` : description;
}
