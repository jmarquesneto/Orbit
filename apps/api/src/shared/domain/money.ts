/** Teto de qualquer valor: R$ 100 bilhões em centavos — bem abaixo do limite seguro do JS. */
export const MAX_CENTS = 10_000_000_000_000;

export function isValidCents(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_CENTS;
}

/**
 * Divide um total em N parcelas inteiras cuja soma é EXATAMENTE o total.
 * Os centavos que sobram vão para as primeiras parcelas: R$ 100,00 em 3x → 33,34 + 33,33 + 33,33.
 */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new RangeError('Total inválido');
  if (!Number.isInteger(count) || count < 1) throw new RangeError('Número de parcelas inválido');
  if (count > totalCents) throw new RangeError('Mais parcelas do que centavos');
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}
