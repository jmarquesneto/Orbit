/** O Drizzle embrulha o erro do driver em `cause`; procura o código SQLSTATE nos dois níveis. */
function pgCode(err: unknown): { code?: string; constraint?: string } {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return e?.code ? e : (e?.cause ?? {});
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const { code, constraint: c } = pgCode(err);
  return code === '23505' && (!constraint || c === constraint);
}

/** Violação de política de RLS: o usuário tentou gravar algo que não pode. */
export function isRlsViolation(err: unknown): boolean {
  return pgCode(err).code === '42501';
}
