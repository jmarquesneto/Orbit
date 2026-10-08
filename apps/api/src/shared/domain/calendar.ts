/**
 * Datas de calendário (vencimento, competência) como texto ISO "AAAA-MM-DD", sem fuso:
 * 10/11 é 10/11 em qualquer servidor. Nada de `Date` aqui, que carrega hora e fuso.
 */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface YearMonth {
  year: number;
  month: number; // 1–12
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseIsoDate(value: IsoDate): YearMonth & { day: number } {
  if (!isValidIsoDate(value)) throw new RangeError(`Data inválida: ${value}`);
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return { year: y, month: m, day: d };
}

export function formatIsoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + n;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Dia `day` do mês, ou o último dia se o mês for mais curto (dia 31 em fevereiro → 28/29). */
export function clampedDate(ym: YearMonth, day: number): IsoDate {
  return formatIsoDate(ym.year, ym.month, Math.min(day, daysInMonth(ym.year, ym.month)));
}

export function firstOfMonth(ym: YearMonth): IsoDate {
  return formatIsoDate(ym.year, ym.month, 1);
}

/** "2026-10" → { year: 2026, month: 10 } */
export function parseYearMonth(value: string): YearMonth {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  const ym = m ? { year: Number(m[1]), month: Number(m[2]) } : null;
  if (!ym || ym.month < 1 || ym.month > 12) throw new RangeError(`Mês inválido: ${value}`);
  return ym;
}

export function todayIso(now: Date): IsoDate {
  return now.toISOString().slice(0, 10);
}
