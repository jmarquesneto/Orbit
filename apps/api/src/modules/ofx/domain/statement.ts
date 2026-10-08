import { formatIsoDate, type IsoDate, isValidIsoDate } from '../../../shared/domain/calendar.js';
import { MAX_CENTS } from '../../../shared/domain/money.js';

/** JSON padronizado de um extrato OFX — o mesmo formato para qualquer banco. */
export interface OfxStatement {
  kind: 'bank' | 'creditcard';
  bankId: string | null;
  /** Só os 4 últimos dígitos: o número completo da conta nunca é guardado. */
  accountMask: string | null;
  currency: string;
  period: { start: IsoDate | null; end: IsoDate | null };
  ledgerBalance: { amountCents: number; date: IsoDate | null } | null;
  transactions: OfxTransaction[];
}

export interface OfxTransaction {
  fitId: string;
  postedAt: IsoDate;
  /** Com sinal: negativo = saída da conta. */
  amountCents: number;
  type: string;
  memo: string;
}

export class OfxFormatError extends Error {}

const MAX_TEXT = 255;

/** Remove caracteres de controle e marcação; o texto vira dado inerte. */
export function sanitizeText(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&lt;|&gt;|&amp;/g, ' ')
    // eslint-disable-next-line no-control-regex -- remover controles é o objetivo
    .replace(/[\u0000-\u001F\u007F<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * "-1234.56", "1234,56", "+10" → centavos inteiros. Aceita vírgula decimal (bancos brasileiros)
 * e nunca passa por float: a conversão é feita por texto, sem erro de arredondamento.
 */
export function parseAmountCents(raw: unknown): number {
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new OfxFormatError('Valor ausente');
  const text = String(raw).trim().replace(/\s/g, '');
  const m = /^([+-]?)(\d{1,13})(?:[.,](\d{1,2}))?$/.exec(text);
  if (!m) throw new OfxFormatError(`Valor inválido: ${text.slice(0, 20)}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '0').padEnd(2, '0'));
  if (cents > MAX_CENTS) throw new OfxFormatError('Valor fora do limite');
  return m[1] === '-' ? -cents : cents;
}

/** "20261007120000[-3:BRT]" → "2026-10-07". O OFX sempre começa com AAAAMMDD. */
export function parseOfxDate(raw: unknown): IsoDate {
  const m = typeof raw === 'string' ? /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim()) : null;
  const iso = m ? formatIsoDate(Number(m[1]), Number(m[2]), Number(m[3])) : '';
  if (!isValidIsoDate(iso)) throw new OfxFormatError('Data inválida no extrato');
  return iso;
}

function optionalDate(raw: unknown): IsoDate | null {
  try {
    return raw ? parseOfxDate(raw) : null;
  } catch {
    return null;
  }
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function mask(account: unknown): string | null {
  const digits = typeof account === 'string' ? account.replace(/\D/g, '') : '';
  return digits.length >= 4 ? digits.slice(-4) : null;
}

type Tree = Record<string, unknown>;
const node = (v: unknown): Tree => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Tree) : {});

/** Converte a árvore crua da biblioteca no JSON padronizado, validando cada campo. */
export function normalizeStatement(ofx: Tree, maxTransactions = 5_000): OfxStatement {
  const bankRs = node(node(node(ofx.BANKMSGSRSV1).STMTTRNRS).STMTRS);
  const cardRs = node(node(node(ofx.CREDITCARDMSGSRSV1).CCSTMTTRNRS).CCSTMTRS);
  const isBank = Object.keys(bankRs).length > 0;
  const rs = isBank ? bankRs : cardRs;
  if (!Object.keys(rs).length) throw new OfxFormatError('Extrato sem dados de conta (STMTRS)');

  const account = isBank ? node(rs.BANKACCTFROM) : node(rs.CCACCTFROM);
  const list = node(rs.BANKTRANLIST);
  const rawTransactions = asArray(list.STMTTRN as Tree | Tree[] | undefined);
  if (rawTransactions.length > maxTransactions) {
    throw new OfxFormatError(`Extrato com mais de ${maxTransactions} transações`);
  }

  const transactions = rawTransactions.map((t, i): OfxTransaction => {
    const tx = node(t);
    const amountCents = parseAmountCents(tx.TRNAMT);
    const fitId = sanitizeText(tx.FITID, 255);
    return {
      // Sem FITID (bancos antigos): usamos uma chave estável derivada dos próprios dados.
      fitId: fitId || `sem-fitid:${String(tx.DTPOSTED)}:${amountCents}:${i}`,
      postedAt: parseOfxDate(tx.DTPOSTED),
      amountCents,
      type: sanitizeText(tx.TRNTYPE, 20).toUpperCase(),
      memo: sanitizeText([tx.NAME, tx.MEMO].filter((v) => typeof v === 'string' && v).join(' · ')) || 'Sem descrição',
    };
  });

  const ledger = node(rs.LEDGERBAL);
  let ledgerBalance: OfxStatement['ledgerBalance'] = null;
  if (ledger.BALAMT !== undefined) {
    ledgerBalance = { amountCents: parseAmountCents(ledger.BALAMT), date: optionalDate(ledger.DTASOF) };
  }

  return {
    kind: isBank ? 'bank' : 'creditcard',
    bankId: sanitizeText(account.BANKID, 20) || null,
    accountMask: mask(account.ACCTID),
    currency: sanitizeText(rs.CURDEF, 3).toUpperCase() || 'BRL',
    period: { start: optionalDate(list.DTSTART), end: optionalDate(list.DTEND) },
    ledgerBalance,
    transactions,
  };
}
