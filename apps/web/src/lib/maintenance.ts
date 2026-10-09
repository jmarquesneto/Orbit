import type { DueState, Frequency } from './types';

export const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'once', label: 'Única' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'semiannual', label: 'Semestral' },
  { value: 'annual', label: 'Anual' },
];

const MONTHS: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/** Mesma regra do servidor: data real de conclusão + intervalo, ajustando o fim do mês. */
export function nextDueDate(completedOn: string, frequency: Frequency): string | null {
  if (frequency === 'once') return null;
  const [y, m, d] = completedOn.split('-').map(Number) as [number, number, number];
  if (frequency === 'weekly') {
    const dt = new Date(Date.UTC(y, m - 1, d + 7));
    return dt.toISOString().slice(0, 10);
  }
  const idx = y * 12 + (m - 1) + MONTHS[frequency]!;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "05/10" */
export const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Texto e tom do vencimento, como no design ("Atrasada há 4 dias · vencia 05/10"). */
export function dueLabel(nextDueOn: string | null, daysUntil: number | null): { text: string; tone: DueState | 'none'; } {
  if (!nextDueOn || daysUntil === null) return { text: 'Encerrada', tone: 'none' };
  if (daysUntil < 0) {
    const n = -daysUntil;
    return { text: `Atrasada há ${n} ${n === 1 ? 'dia' : 'dias'} · vencia ${shortDate(nextDueOn)}`, tone: 'overdue' };
  }
  if (daysUntil === 0) return { text: 'Vence hoje', tone: 'week' };
  if (daysUntil === 1) return { text: `Vence amanhã · ${shortDate(nextDueOn)}`, tone: 'week' };
  return { text: `Vence em ${daysUntil} dias · ${shortDate(nextDueOn)}`, tone: daysUntil <= 7 ? 'week' : 'later' };
}

/** Iniciais para o avatar do responsável ("Marina Souza" → "MS"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
