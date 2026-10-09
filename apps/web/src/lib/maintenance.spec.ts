import { describe, expect, it } from 'vitest';
import { dueLabel, initials, nextDueDate } from './maintenance';

describe('manutenção no navegador', () => {
  it('prevê o próximo vencimento igual ao servidor', () => {
    expect(nextDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextDueDate('2026-10-09', 'weekly')).toBe('2026-10-16');
    expect(nextDueDate('2026-10-09', 'annual')).toBe('2027-10-09');
    expect(nextDueDate('2026-10-09', 'once')).toBeNull();
  });

  it('textos de vencimento e iniciais', () => {
    expect(dueLabel('2026-10-05', -4)).toEqual({ text: 'Atrasada há 4 dias · vencia 05/10', tone: 'overdue' });
    expect(dueLabel('2026-10-09', 0).text).toBe('Vence hoje');
    expect(dueLabel('2026-10-20', 11).tone).toBe('later');
    expect(initials('Marina Souza')).toBe('MS');
    expect(initials('rafael')).toBe('RA');
  });
});
