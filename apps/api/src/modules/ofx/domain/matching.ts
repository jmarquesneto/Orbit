import type { IsoDate } from '../../../shared/domain/calendar.js';

export type MatchKind = 'auto' | 'suggest' | 'new' | 'dup';

export interface MatchCandidate {
  id: string;
  /** Com sinal, no mesmo sentido do extrato: receita positiva, despesa negativa. */
  signedCents: number;
  dueDate: IsoDate;
}

export interface MatchResult {
  match: MatchKind;
  score: number;
  transactionId: string | null;
}

const DAY_MS = 86_400_000;
const MAX_DAYS = 10;
const MAX_AMOUNT_DIFF = 0.05; // 5%
export const SUGGEST_THRESHOLD = 50;

function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

/**
 * Nota de 0 a 100: 60 pontos pelo valor (cheio se idêntico, caindo até 5% de diferença)
 * e 40 pela data (cheio no mesmo dia, caindo até 10 dias). Sentidos opostos nunca casam.
 */
export function matchScore(entry: { amountCents: number; postedAt: IsoDate }, c: MatchCandidate): number {
  if (Math.sign(entry.amountCents) !== Math.sign(c.signedCents)) return 0;
  const diff = Math.abs(Math.abs(entry.amountCents) - Math.abs(c.signedCents)) / Math.abs(c.signedCents);
  const days = daysBetween(entry.postedAt, c.dueDate);
  if (diff > MAX_AMOUNT_DIFF || days > MAX_DAYS) return 0;
  const amountPts = 60 * (1 - diff / MAX_AMOUNT_DIFF);
  const datePts = 40 * (1 - days / MAX_DAYS);
  return Math.round(amountPts + datePts);
}

/**
 * Concilia um extrato inteiro: cada lançamento do sistema casa com no máximo uma linha
 * do extrato, sempre a de maior nota (guloso pela melhor nota global).
 *  - dup:     FITID já importado nesta carteira (ou repetido no próprio arquivo);
 *  - auto:    valor idêntico e mesma data (nota 100) — aplicado sozinho;
 *  - suggest: nota ≥ 50 — a pessoa confirma ou escolhe outro;
 *  - new:     sem correspondência — vira lançamento novo, se a pessoa quiser.
 */
export function reconcile(
  entries: { fitId: string; amountCents: number; postedAt: IsoDate }[],
  candidates: MatchCandidate[],
  alreadyImportedFitIds: Set<string>,
): MatchResult[] {
  const results: MatchResult[] = entries.map(() => ({ match: 'new', score: 0, transactionId: null }));
  const seen = new Set<string>();
  const open: number[] = [];
  entries.forEach((e, i) => {
    if (alreadyImportedFitIds.has(e.fitId) || seen.has(e.fitId)) results[i] = { match: 'dup', score: 0, transactionId: null };
    else open.push(i);
    seen.add(e.fitId);
  });

  const pairs: { entry: number; candidate: number; score: number }[] = [];
  for (const i of open) {
    candidates.forEach((c, j) => {
      const score = matchScore(entries[i]!, c);
      if (score >= SUGGEST_THRESHOLD) pairs.push({ entry: i, candidate: j, score });
    });
  }
  pairs.sort((a, b) => b.score - a.score || a.entry - b.entry);

  const usedEntries = new Set<number>();
  const usedCandidates = new Set<number>();
  for (const p of pairs) {
    if (usedEntries.has(p.entry) || usedCandidates.has(p.candidate)) continue;
    usedEntries.add(p.entry);
    usedCandidates.add(p.candidate);
    results[p.entry] = {
      match: p.score === 100 ? 'auto' : 'suggest',
      score: p.score,
      transactionId: candidates[p.candidate]!.id,
    };
  }
  return results;
}
