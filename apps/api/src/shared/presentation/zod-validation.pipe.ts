import { type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ValidationError } from '../domain/errors.js';

/**
 * Toda entrada HTTP passa por um schema Zod estrito: tipos, tamanhos e formatos são checados
 * e campos desconhecidos são rejeitados antes de chegar a qualquer caso de uso.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(
        'Dados inválidos.',
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  }
}
