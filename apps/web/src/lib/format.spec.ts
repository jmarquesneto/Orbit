import { describe, expect, it } from 'vitest';
import { isoToBr, money, monthLabel, parseMoneyInput, percent, shiftMonth, signedMoney } from './format';

describe('dinheiro', () => {
  it.each([
    ['1.234,56', 123_456],
    ['1234,5', 123_450],
    ['1234.56', 123_456],
    ['R$ 10', 1_000],
    ['0,01', 1],
  ])('"%s" → %i centavos', (text, cents) => expect(parseMoneyInput(text)).toBe(cents));

  it.each(['', 'abc', '0', '1,234', '-5', '1.23.4'])('"%s" não é valor válido', (text) => {
    expect(parseMoneyInput(text)).toBeNull();
  });

  it('formata em reais, com sinal tipográfico', () => {
    expect(money(123_456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(signedMoney(-31_240).replace(/\s/g, ' ')).toBe('− R$ 312,40');
  });
});

describe('datas', () => {
  it('converte ISO sem passar por fuso', () => expect(isoToBr('2026-10-08')).toBe('08/10/2026'));
  it('navega meses, inclusive virada de ano', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
  it('rótulo do mês', () => expect(monthLabel('2026-10-01')).toBe('Outubro 2026'));
  it('percentual seguro com zero', () => {
    expect(percent(5, 0)).toBe(0);
    expect(percent(828, 800)).toBe(104);
  });
});
