import { addDays, addMonths, clampedDate, daysBetween, type IsoDate, parseIsoDate } from '../../../shared/domain/calendar.js';

export const FREQUENCIES = ['once', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  once: 'Única',
  weekly: 'Semanal',
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
};

const MONTHS: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/**
 * Recorrência por intervalo (MER-Manutenção): o próximo vencimento conta a partir da data
 * REAL de conclusão, nunca do vencimento antigo. Dia inexistente é ajustado ao fim do mês
 * (31/01 + 1 mês = 28/02). Tarefa única não tem próximo: devolve null (encerra).
 */
export function nextDueDate(completedOn: IsoDate, frequency: Frequency): IsoDate | null {
  if (frequency === 'once') return null;
  if (frequency === 'weekly') return addDays(completedOn, 7);
  const d = parseIsoDate(completedOn);
  return clampedDate(addMonths(d, MONTHS[frequency]!), d.day);
}

export type DueState = 'overdue' | 'week' | 'later';

/** "Atrasada" é calculada (next_due_on < hoje), nunca gravada. */
export function dueState(nextDueOn: IsoDate, today: IsoDate): DueState {
  const days = daysBetween(today, nextDueOn);
  if (days < 0) return 'overdue';
  return days <= 7 ? 'week' : 'later';
}

export interface EquipmentRecord {
  id: string;
  budgetId: string;
  name: string;
  location: string;
  manualUrl: string | null;
  createdBy: string;
  createdAt: Date;
  archivedAt: Date | null;
}

export interface TaskRecord {
  id: string;
  equipmentId: string;
  name: string;
  frequency: Frequency;
  assigneeId: string;
  nextDueOn: IsoDate | null;
  lastDoneOn: IsoDate | null;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  version: number;
}

export interface LogRecord {
  id: number;
  taskId: string;
  equipmentId: string;
  taskName: string;
  completedBy: string;
  completedOn: IsoDate;
  dueOn: IsoDate | null;
  nextDueOn: IsoDate | null;
  transactionId: string | null;
  note: string | null;
  idempotencyKey: string;
  createdAt: Date;
}
