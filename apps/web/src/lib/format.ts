/** Formatação pt-BR. Valores sempre chegam em centavos inteiros. */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlShort = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export const money = (cents: number) => brl.format(cents / 100);
export const moneyShort = (cents: number) => brlShort.format(Math.round(cents / 100));

/** "+ R$ 10,00" / "− R$ 10,00" (sinal tipográfico, como no design). */
export const signedMoney = (cents: number) => `${cents < 0 ? '−' : '+'} ${brl.format(Math.abs(cents) / 100)}`;

/**
 * "1.234,56" / "1234,5" / "1234.56" → centavos. Feito por texto, sem float.
 * Devolve null se não for um valor monetário válido.
 */
export function parseMoneyInput(raw: string): number | null {
  const text = raw.replace(/\s|R\$/g, '');
  if (!text) return null;
  let m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(text); // 1.234,56
  if (!m) m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text); // 1234.56
  if (!m) return null;
  const units = Number(m[1]!.replace(/\./g, ''));
  const cents = units * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/** "2026-10-08" → "08/10/2026" sem passar por fuso horário. */
export function isoToBr(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export const isoToShort = (iso: string) => isoToBr(iso).slice(0, 5);

const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-10" ou "2026-10-01" → "Outubro 2026" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const name = monthNames[Number(m) - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

export const monthName = (ym: string) => monthNames[Number(ym.split('-')[1]) - 1] ?? '';

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const currentMonth = () => todayIso().slice(0, 7);

export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part * 100) / whole) : 0;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export function longDate(date = new Date()): string {
  const text = date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
