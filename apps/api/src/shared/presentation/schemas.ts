import { z } from 'zod';
import { isValidIsoDate } from '../domain/calendar.js';
import { MAX_CENTS } from '../domain/money.js';

/** Valores sempre em centavos inteiros: R$ 12,34 → 1234. Nunca float. */
export const CentsSchema = z.number().int().positive().max(MAX_CENTS);
export const NonNegativeCentsSchema = z.number().int().min(0).max(MAX_CENTS);

export const IsoDateSchema = z.string().refine(isValidIsoDate, 'Use uma data válida no formato AAAA-MM-DD.');
export const YearMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o formato AAAA-MM.');

/** Textos livres: sem caracteres de controle; o frontend sempre os exibe como texto. */
export const LabelSchema = (max = 80) =>
  z
    .string()
    .trim()
    .min(1, 'Campo obrigatório.')
    .max(max)
    // eslint-disable-next-line no-control-regex -- é exatamente o que queremos barrar
    .refine((v) => !/[\u0000-\u001F\u007F]/.test(v), 'Caracteres inválidos.');

export const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use uma cor hexadecimal, ex.: #3DD6C3.');
export const DayOfMonthSchema = z.number().int().min(1).max(31);
