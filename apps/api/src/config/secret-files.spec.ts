import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from './env.schema.js';
import { ensureSecretFiles, SECRET_NAMES, withSecretFiles } from './secret-files.js';

describe('segredos gerados na 1ª subida', () => {
  it('cria todos, nunca sobrescreve e o ambiente fica válido só com SECRETS_DIR', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'orbit-')), 'segredos');
    expect(ensureSecretFiles(dir)).toEqual([...SECRET_NAMES]);
    const before = readFileSync(join(dir, 'jwt_access_secret'), 'utf8');
    expect(ensureSecretFiles(dir)).toEqual([]);
    expect(readFileSync(join(dir, 'jwt_access_secret'), 'utf8')).toBe(before);
    expect(statSync(join(dir, 'redis_password')).mode & 0o777).toBe(0o444);
    expect(Buffer.from(readFileSync(join(dir, 'data_encryption_key'), 'utf8').trim(), 'base64')).toHaveLength(32);

    const env = parseEnv({
      SECRETS_DIR: dir,
      DB_HOST: 'db',
      DB_NAME: 'orbit',
      DB_APP_USER: 'app_runtime',
      REDIS_HOST: 'redis',
    } as NodeJS.ProcessEnv);
    expect(env.WEB_ORIGIN).toBe('http://localhost:3010');
    expect(env.JWT_ACCESS_SECRET).toBe(before.trim());
  });

  it('variável de ambiente tem prioridade sobre o arquivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-'));
    writeFileSync(join(dir, 'redis_password'), 'do-arquivo\n');
    expect(withSecretFiles({ SECRETS_DIR: dir, REDIS_PASSWORD: 'da-env' }).REDIS_PASSWORD).toBe('da-env');
    expect(withSecretFiles({ SECRETS_DIR: dir }).REDIS_PASSWORD).toBe('do-arquivo');
  });
});
