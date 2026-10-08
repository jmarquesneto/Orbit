import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Formato básico, usado na validação da requisição HTTP. */
export const PasswordInputSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

/**
 * Regras da senha nova (Flow, etapa 7). Comprimento pesa mais que "complexidade":
 * seguimos o NIST SP 800-63B — mínimo de 12, sem exigir símbolos, barrando o óbvio.
 * A checagem de vazamento (HIBP) entra quando a API tiver saída para a internet.
 */
export function checkPasswordPolicy(password: string, email: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`);
  }
  if (/^(.)\1+$/u.test(password)) {
    problems.push('A senha não pode ser um único caractere repetido.');
  }
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length >= 4 && password.toLowerCase().includes(localPart)) {
    problems.push('A senha não pode conter o seu e-mail.');
  }
  if (new Set(password).size < 5) {
    problems.push('A senha precisa de mais variedade de caracteres.');
  }
  return problems;
}
