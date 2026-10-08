import { randomBytes } from 'node:crypto';
import { parseEnv } from './env.schema.js';

const rand = () => randomBytes(32).toString('base64url');

function validEnv(): NodeJS.ProcessEnv {
  return {
    WEB_ORIGIN: 'http://localhost:3000',
    DB_HOST: 'db',
    DB_NAME: 'finance',
    DB_APP_USER: 'app_runtime',
    DB_APP_PASSWORD: rand(),
    REDIS_HOST: 'redis',
    REDIS_PASSWORD: rand(),
    JWT_ACCESS_SECRET: rand(),
    JWT_REFRESH_SECRET: rand(),
    SESSION_SECRET: rand(),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
}

describe('parseEnv', () => {
  it('aceita um ambiente válido e aplica os padrões', () => {
    const env = parseEnv(validEnv());
    expect(env.NODE_ENV).toBe('production');
    expect(env.API_PORT).toBe(4000);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
  });

  it('rejeita segredo JWT ausente', () => {
    const source = validEnv();
    delete source.JWT_ACCESS_SECRET;
    expect(() => parseEnv(source)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejeita segredo curto demais', () => {
    expect(() => parseEnv({ ...validEnv(), SESSION_SECRET: 'curto' })).toThrow(/SESSION_SECRET/);
  });

  it('rejeita valores de exemplo esquecidos', () => {
    const placeholder = 'change-me-'.padEnd(50, 'x');
    expect(() => parseEnv({ ...validEnv(), JWT_REFRESH_SECRET: placeholder })).toThrow(
      /valor de exemplo/,
    );
  });

  it('exige segredos distintos para access e refresh', () => {
    const same = rand();
    expect(() =>
      parseEnv({ ...validEnv(), JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same }),
    ).toThrow(/distintos/);
  });

  it('exige chave de criptografia de exatamente 32 bytes', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => parseEnv({ ...validEnv(), DATA_ENCRYPTION_KEY: short })).toThrow(
      /DATA_ENCRYPTION_KEY/,
    );
  });

  it('não vaza o valor do segredo na mensagem de erro', () => {
    const leaked = 'valor-que-nao-pode-aparecer';
    try {
      parseEnv({ ...validEnv(), SESSION_SECRET: leaked });
      expect.unreachable('deveria lançar');
    } catch (err) {
      expect((err as Error).message).not.toContain(leaked);
    }
  });
});
