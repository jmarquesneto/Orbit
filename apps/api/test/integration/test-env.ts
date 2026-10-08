import { randomBytes } from 'node:crypto';

/** Aponta para o docker-compose.test.yml, a menos que o ambiente já defina outro destino. */
export function applyTestEnv(): void {
  const defaults: Record<string, string> = {
    NODE_ENV: 'test',
    WEB_ORIGIN: 'http://localhost:3000',
    DB_HOST: '127.0.0.1',
    DB_PORT: '55432',
    DB_NAME: 'finance_test',
    DB_APP_USER: 'test_runtime',
    DB_APP_PASSWORD: 'test-runtime-password-not-a-secret-000000000',
    DB_MIGRATOR_USER: 'test_migrator',
    DB_MIGRATOR_PASSWORD: 'test-migrator-password-not-a-secret-00000000',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '56379',
    REDIS_PASSWORD: 'test-redis-password-not-a-secret-0000000000000',
    JWT_ACCESS_SECRET: randomBytes(32).toString('base64url'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('base64url'),
    SESSION_SECRET: randomBytes(32).toString('base64url'),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
  for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
}
