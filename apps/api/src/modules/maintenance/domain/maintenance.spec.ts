import { todayIso } from '../../../shared/domain/calendar.js';
import { dueState, nextDueDate } from './maintenance.js';

describe('recorrência da manutenção', () => {
  it('conta a partir da data real de conclusão', () => {
    expect(nextDueDate('2026-10-09', 'weekly')).toBe('2026-10-16');
    expect(nextDueDate('2026-10-09', 'monthly')).toBe('2026-11-09');
    expect(nextDueDate('2026-10-09', 'quarterly')).toBe('2027-01-09');
    expect(nextDueDate('2026-10-09', 'semiannual')).toBe('2027-04-09');
    expect(nextDueDate('2026-10-09', 'annual')).toBe('2027-10-09');
  });

  it('ajusta dia inexistente ao fim do mês e encerra tarefa única', () => {
    expect(nextDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextDueDate('2028-01-31', 'monthly')).toBe('2028-02-29');
    expect(nextDueDate('2026-08-31', 'semiannual')).toBe('2027-02-28');
    expect(nextDueDate('2026-10-09', 'once')).toBeNull();
  });

  it('situação: atrasada, próximos 7 dias ou mais adiante', () => {
    expect(dueState('2026-10-08', '2026-10-09')).toBe('overdue');
    expect(dueState('2026-10-09', '2026-10-09')).toBe('week');
    expect(dueState('2026-10-16', '2026-10-09')).toBe('week');
    expect(dueState('2026-10-17', '2026-10-09')).toBe('later');
  });

  it('"hoje" respeita o fuso de Brasília (22h de 09/10 ainda é dia 09)', () => {
    expect(todayIso(new Date('2026-10-10T01:00:00Z'), 'America/Sao_Paulo')).toBe('2026-10-09');
    expect(todayIso(new Date('2026-10-10T01:00:00Z'), 'UTC')).toBe('2026-10-10');
  });
});
