import { matchScore, reconcile } from './matching.js';
import { parseAmountCents, parseOfxDate, sanitizeText } from './statement.js';

describe('normalização do OFX', () => {
  it.each([
    ['-312.40', -31_240],
    ['9800,00', 980_000],
    ['+10', 1_000],
    ['0.5', 50],
    ['-0.01', -1],
  ])('valor %s → %i centavos', (raw, cents) => expect(parseAmountCents(raw)).toBe(cents));

  it.each(['1.234,56', 'abc', '1e5', '12.345', ''])('rejeita valor ambíguo ou inválido: %s', (raw) => {
    expect(() => parseAmountCents(raw)).toThrow();
  });

  it('datas OFX com hora e fuso viram AAAA-MM-DD', () => {
    expect(parseOfxDate('20261007120000[-3:BRT]')).toBe('2026-10-07');
    expect(parseOfxDate('20280229')).toBe('2028-02-29'); // ano bissexto
  });

  it('rejeita data impossível', () => {
    expect(() => parseOfxDate('20260229')).toThrow(); // 2026 não é bissexto
    expect(() => parseOfxDate('20270230')).toThrow();
  });

  it('texto saneado: sem marcação, sem controle, tamanho limitado', () => {
    expect(sanitizeText('PIX <img src=x onerror=alert(1)>\u0000 LOJA')).toBe('PIX img src=x onerror=alert(1) LOJA');
    expect(sanitizeText('a'.repeat(400))).toHaveLength(255);
    expect(sanitizeText(42)).toBe('');
  });
});

describe('conciliação', () => {
  const entry = (fitId: string, amountCents: number, postedAt: string) => ({ fitId, amountCents, postedAt });

  it('mesmo valor e mesma data = 100; sentido oposto = 0', () => {
    expect(matchScore(entry('a', -5_000, '2026-10-05'), { id: 't', signedCents: -5_000, dueDate: '2026-10-05' })).toBe(100);
    expect(matchScore(entry('a', 5_000, '2026-10-05'), { id: 't', signedCents: -5_000, dueDate: '2026-10-05' })).toBe(0);
  });

  it('nota cai com diferença de valor e de data, e zera fora dos limites', () => {
    const c = { id: 't', signedCents: -48_000, dueDate: '2026-10-04' };
    const s = matchScore(entry('a', -48_672, '2026-10-04'), c);
    expect(s).toBeGreaterThan(50);
    expect(s).toBeLessThan(100);
    expect(matchScore(entry('a', -48_000, '2026-10-20'), c)).toBe(0);
    expect(matchScore(entry('a', -60_000, '2026-10-04'), c)).toBe(0);
  });

  it('classifica auto, sugestão, novo e duplicado — cada lançamento casa uma vez só', () => {
    const results = reconcile(
      [
        entry('1', -31_240, '2026-10-02'),
        entry('2', -48_672, '2026-10-04'),
        entry('3', -3_990, '2026-10-06'),
        entry('1', -31_240, '2026-10-02'),
        entry('9', -10_000, '2026-10-01'),
        entry('10', -31_240, '2026-10-02'),
      ],
      [
        { id: 'seguro', signedCents: -31_240, dueDate: '2026-10-02' },
        { id: 'mercado', signedCents: -48_000, dueDate: '2026-10-04' },
      ],
      new Set(['9']),
    );
    expect(results.map((r) => r.match)).toEqual(['auto', 'suggest', 'new', 'dup', 'dup', 'new']);
    expect(results[0]).toMatchObject({ transactionId: 'seguro', score: 100 });
    expect(results[1]?.transactionId).toBe('mercado');
  });
});
