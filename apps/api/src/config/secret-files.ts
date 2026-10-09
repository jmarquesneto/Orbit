import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Segredos internos (senhas entre os contêineres e chaves de criptografia). Ninguém
 * precisa digitá-los: o serviço "secrets" gera cada um na primeira subida, numa pasta do
 * disco, e os outros contêineres leem de lá (SECRETS_DIR). Variáveis de ambiente com o
 * mesmo nome continuam valendo e têm prioridade (instalações antigas com .env).
 */
export const SECRET_NAMES = [
  'DB_SUPERUSER_PASSWORD',
  'DB_MIGRATOR_PASSWORD',
  'DB_APP_PASSWORD',
  'REDIS_PASSWORD',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'SESSION_SECRET',
  'DATA_ENCRYPTION_KEY',
] as const;

const fileName = (name: string) => name.toLowerCase();

/** Valor novo: 32 bytes em base64 para a chave AES; 36 bytes em base64url para o resto. */
function generate(name: string): string {
  return name === 'DATA_ENCRYPTION_KEY'
    ? randomBytes(32).toString('base64')
    : randomBytes(36).toString('base64url');
}

/** Cria os segredos que faltam (nunca sobrescreve). Devolve os nomes criados. */
export function ensureSecretFiles(dir: string): string[] {
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  const created: string[] = [];
  for (const name of SECRET_NAMES) {
    const path = join(dir, fileName(name));
    if (existsSync(path) && readFileSync(path, 'utf8').trim()) continue;
    writeFileSync(path, `${generate(name)}\n`, { mode: 0o444 });
    chmodSync(path, 0o444); // leitura para postgres, redis e node (usuários diferentes)
    created.push(name);
  }
  return created;
}

/** Completa o ambiente com os segredos da pasta SECRETS_DIR (sem sobrescrever o que já existe). */
export function withSecretFiles(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dir = source.SECRETS_DIR;
  if (!dir) return source;
  const env = { ...source };
  for (const name of SECRET_NAMES) {
    if (env[name]) continue;
    const path = join(dir, fileName(name));
    if (existsSync(path)) env[name] = readFileSync(path, 'utf8').trim();
  }
  return env;
}
